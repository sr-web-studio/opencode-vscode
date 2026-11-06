import type { EventEnvelope, OpenCodeClient } from "./api"
import { loadChunk, initialHistory, type FetchPage, type HistoryState, type RawMessage } from "./history"
import { applyEvent, prependView, viewFromMessages } from "./transcript/reducer"
import { emptyView, type SessionView } from "./transcript/types"

const isDelta = (type: string) => type === "session.text.delta" || type === "session.reasoning.delta" || type === "session.tool.input.delta"
const message = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "Request failed")

/**
 * The transcript of one session: loaded from history (since the last compaction), then kept current by live events.
 * Used for the main session of a window and for read-only worker tabs, so both load and stream the same way.
 *
 * Events that arrive while history loads are buffered and replayed afterwards (without text deltas, which the
 * loaded text already contains).
 */
export class SessionFeed {
  view: SessionView = emptyView()
  loading = false
  loadingEarlier = false
  /** Older messages exist ("Show earlier messages"). */
  hasEarlier = false
  /** Bumped whenever older messages were added above, so the UI can keep its scroll position. */
  earlierTick = 0

  private history: HistoryState = initialHistory
  private token = 0
  private buffered: EventEnvelope[] = []

  constructor(
    /** `immediate` asks for a prompt redraw (loading state changes); otherwise the owner may batch. */
    private readonly changed: (immediate: boolean) => void,
    private readonly failed: (message: string) => void,
  ) {}

  private fetcher(client: OpenCodeClient, sessionID: string): FetchPage {
    return (input) => client.message.list({ sessionID, ...input }) as unknown as Promise<{ data: RawMessage[]; cursor?: { next?: string | null } }>
  }

  /** Forget everything (a different session or a draft is shown next). */
  reset(): void {
    this.token++
    this.view = emptyView()
    this.loading = false
    this.loadingEarlier = false
    this.hasEarlier = false
    this.history = initialHistory
    this.buffered = []
  }

  /** A session that was just created: nothing to load, events fill it. */
  startEmpty(): void {
    this.reset()
    this.view = { ...emptyView(), loaded: true }
  }

  async load(client: OpenCodeClient, sessionID: string): Promise<void> {
    this.reset()
    const token = this.token
    this.loading = true
    this.changed(true)
    try {
      const chunk = await loadChunk(this.fetcher(client, sessionID))
      if (token !== this.token) return
      let view = viewFromMessages(chunk.messages as never)
      for (const ev of this.buffered) if (!isDelta(ev.type)) view = applyEvent(view, ev)
      this.view = view
      this.history = chunk.state
      this.hasEarlier = chunk.hasMore
    } catch (e) {
      if (token !== this.token) return
      this.view = { ...emptyView(), loaded: true }
      this.failed(`Could not load the session: ${message(e)}`)
    } finally {
      if (token === this.token) {
        this.loading = false
        this.buffered = []
        this.changed(true)
      }
    }
  }

  /** The previous chunk (back to the next earlier compaction, or the size cap). */
  async loadEarlier(client: OpenCodeClient, sessionID: string): Promise<void> {
    if (this.loadingEarlier || this.loading || !this.hasEarlier) return
    const token = this.token
    this.loadingEarlier = true
    this.changed(true)
    try {
      const chunk = await loadChunk(this.fetcher(client, sessionID), this.history)
      if (token !== this.token) return
      this.view = prependView(this.view, viewFromMessages(chunk.messages as never))
      this.history = chunk.state
      this.hasEarlier = chunk.hasMore
      this.earlierTick++
    } catch (e) {
      if (token === this.token) this.failed(`Could not load earlier messages: ${message(e)}`)
    } finally {
      if (token === this.token) {
        this.loadingEarlier = false
        this.changed(true)
      }
    }
  }

  /** Apply a live event of this session. Returns true when the view changed. */
  apply(ev: EventEnvelope): boolean {
    if (this.loading) {
      this.buffered.push(ev)
      return false
    }
    const next = applyEvent(this.view, ev)
    if (next === this.view) return false
    this.view = next
    return true
  }
}
