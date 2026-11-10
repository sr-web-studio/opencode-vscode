import type { EventEnvelope, OpenCodeClient } from "./api"
import { loadChunk, initialHistory, type Chunk, type FetchPage, type HistoryState, type RawMessage } from "./history"
import { applyEvent, prependView, queuedFromInbox, viewFromMessages } from "./transcript/reducer"
import { emptyView, type SessionView, type TurnView } from "./transcript/types"

const isDelta = (type: string) => type === "session.text.delta" || type === "session.reasoning.delta" || type === "session.tool.input.delta" || type === "session.compaction.delta"
const message = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "Request failed")

/**
 * One line for a failed request: name, message, the client's own `reason`/`status`, and the whole `cause` chain. The
 * client's transport errors wrap the real one (`ClientError: Transport` with a `TypeError` cause), and a status error
 * keeps `{ status }` as its cause, so both are worth keeping. Only these fields are read, never headers or a body, so
 * a token or message text can never reach the log through an unknown cause object.
 */
function errorDetail(e: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let cur: unknown = e
  for (let depth = 0; depth < 6 && cur !== undefined && cur !== null && !seen.has(cur); depth++) {
    seen.add(cur)
    if (cur instanceof Error) {
      const o = cur as Error & { reason?: unknown; status?: unknown; cause?: unknown }
      const extra: string[] = []
      if (typeof o.reason === "string") extra.push(`reason: ${o.reason}`)
      if (typeof o.status === "number") extra.push(`status: ${o.status}`)
      parts.push(`${o.name || "Error"}: ${o.message}${extra.length ? ` (${extra.join(", ")})` : ""}`)
      cur = o.cause
      continue
    }
    if (typeof cur === "object") {
      const o = cur as { status?: unknown; message?: unknown; cause?: unknown }
      if (typeof o.status === "number") parts.push(`status: ${o.status}`)
      else if (typeof o.message === "string") parts.push(o.message)
      else parts.push("[cause object]")
      cur = o.cause
      continue
    }
    parts.push(String(cur))
    cur = undefined
  }
  return parts.length ? parts.join(" <- ") : "unknown error"
}

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
  /** A live compaction ended and the turns before it are still shown: the owner trims them when the user is at the end. */
  trimPending = false
  /** Why the last load of this session failed, if it did. A view that failed to load is retried by the next open. */
  loadError?: string

  private history: HistoryState = initialHistory
  /** The session the view belongs to, so a failed reload can keep its transcript and another session's is never shown. */
  private sessionID?: string
  /** Whether the server has older messages than the loaded history (separate from turns that were only trimmed from the view). */
  private historyMore = false
  /** Turns trimmed after a live compaction, oldest first. "Show earlier messages" puts them back before it fetches anything. */
  private stash: TurnView[] = []
  private token = 0
  private buffered: EventEnvelope[] = []
  /** The session whose last load failed, so the load that finally succeeds says so in the log. */
  private failedSession?: string

  constructor(
    /** `immediate` asks for a prompt redraw (loading state changes); otherwise the owner may batch. */
    private readonly changed: (immediate: boolean) => void,
    private readonly failed: (message: string) => void,
    /** Diagnostics for the host's output channel: why a load failed, and when a retry or a later load worked. */
    private readonly log?: (line: string) => void,
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
    this.historyMore = false
    this.trimPending = false
    this.stash = []
    this.history = initialHistory
    this.buffered = []
    this.sessionID = undefined
    this.loadError = undefined
  }

  /** A session that was just created: nothing to load, events fill it. */
  startEmpty(): void {
    this.reset()
    this.view = { ...emptyView(), loaded: true }
  }

  /**
   * Load the transcript of a session, with one second attempt. A multi-root window syncs every folder at once, and a
   * single stalled request must not leave an empty transcript on screen for a session that has messages. An empty
   * answer is retried too: a session starts with the prompt that created it, so an empty history is never the whole
   * story.
   */
  async load(client: OpenCodeClient, sessionID: string): Promise<void> {
    // Reloading the session on screen keeps its transcript when the load fails; another session starts blank.
    const previous = this.sessionID === sessionID ? this.view : undefined
    this.reset()
    const token = this.token
    this.loading = true
    this.changed(true)
    const started = Date.now()
    let attempts = 0
    /** One attempt, with the time it took: a stalled request is what a failure log has to show. */
    const once = async () => {
      attempts++
      const at = Date.now()
      const result = await this.attempt(client, sessionID)
      return { result, ms: Date.now() - at }
    }
    try {
      let { result, ms } = await once()
      if (token !== this.token) return
      if ("error" in result) this.log?.(`Transcript of ${sessionID} failed on attempt ${attempts} after ${ms} ms: ${errorDetail(result.error)}`)
      if ("error" in result || (result.chunk.messages.length === 0 && !result.chunk.hasMore)) {
        const again = await once()
        if (token !== this.token) return
        if ("error" in again.result) this.log?.(`Transcript of ${sessionID} failed on attempt ${attempts} after ${again.ms} ms: ${errorDetail(again.result.error)}`)
        else {
          this.logLoaded(sessionID, attempts, Date.now() - started)
          result = again.result
        }
      } else {
        this.logLoaded(sessionID, attempts, Date.now() - started)
      }
      if ("error" in result) {
        // An empty transcript with no reason looks like an empty session: keep what was shown, and say what happened.
        this.failedSession = sessionID
        this.view = previous ? { ...previous, loaded: true } : { ...emptyView(), loaded: true }
        this.loadError = `Could not load the session: ${message(result.error)}`
        this.failed(this.loadError)
        return
      }
      let view: SessionView = { ...viewFromMessages(result.chunk.messages as never), queued: queuedFromInbox(result.inbox) }
      for (const ev of this.buffered) if (!isDelta(ev.type)) view = applyEvent(view, ev)
      this.view = view
      this.sessionID = sessionID
      this.loadError = undefined
      this.failedSession = undefined
      this.history = result.chunk.state
      this.historyMore = result.chunk.hasMore
      this.hasEarlier = result.chunk.hasMore
    } finally {
      if (token === this.token) {
        this.loading = false
        this.buffered = []
        this.changed(true)
      }
    }
  }

  /** A successful load is only worth a line when it was not the first try (a retry, or a later load after a failure). */
  private logLoaded(sessionID: string, attempts: number, ms: number): void {
    if (attempts === 1 && this.failedSession !== sessionID) return
    this.log?.(`Transcript of ${sessionID} loaded on attempt ${attempts} after ${ms} ms`)
  }

  /** One attempt at the first chunk and the inbox. Never throws: the caller decides whether to try again. */
  private async attempt(client: OpenCodeClient, sessionID: string): Promise<{ chunk: Chunk; inbox: unknown[] } | { error: unknown }> {
    try {
      // Queued prompts live in the session inbox, not in the message list, until they are delivered.
      const [chunk, inbox] = await Promise.all([
        loadChunk(this.fetcher(client, sessionID)),
        Promise.resolve()
          .then(() => client.session.inbox.list({ sessionID }))
          .catch(() => []),
      ])
      return { chunk, inbox: inbox as unknown[] }
    } catch (e) {
      return { error: e }
    }
  }

  /** The previous chunk (back to the next earlier compaction, or the size cap). */
  async loadEarlier(client: OpenCodeClient, sessionID: string): Promise<void> {
    if (this.loadingEarlier || this.loading || !this.hasEarlier) return
    if (this.stash.length > 0) {
      // Turns that were trimmed from the view come back first, without asking the server.
      this.view = prependView(this.view, { turns: this.stash, queued: [], loaded: true })
      this.stash = []
      this.hasEarlier = this.historyMore
      this.earlierTick++
      this.changed(true)
      return
    }
    const token = this.token
    this.loadingEarlier = true
    this.changed(true)
    const started = Date.now()
    try {
      const chunk = await loadChunk(this.fetcher(client, sessionID), this.history)
      if (token !== this.token) return
      this.view = prependView(this.view, viewFromMessages(chunk.messages as never))
      this.history = chunk.state
      this.historyMore = chunk.hasMore
      this.hasEarlier = chunk.hasMore
      this.earlierTick++
    } catch (e) {
      this.log?.(`Transcript of ${sessionID} failed to load earlier messages after ${Date.now() - started} ms: ${errorDetail(e)}`)
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
    if (ev.type === "session.compaction.ended" && next.turns.length > 1) this.trimPending = true
    return true
  }

  /**
   * After a live compaction, drop the turns before the one it happened in: the summary replaced them. They are kept
   * aside, so "Show earlier messages" still shows them. Returns true when the view changed.
   */
  trim(): boolean {
    this.trimPending = false
    const turns = this.view.turns
    let at = -1
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]!.compaction || turns[i]!.compacted) {
        at = i
        break
      }
    }
    if (at <= 0) return false
    this.stash = [...this.stash, ...turns.slice(0, at)]
    this.view = { ...this.view, turns: turns.slice(at) }
    this.hasEarlier = true
    return true
  }
}
