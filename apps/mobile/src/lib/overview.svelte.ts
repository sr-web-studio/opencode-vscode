/**
 * The reactive store behind the drawer: one snapshot and one event stream for the whole server.
 *
 * A controller per project would mean one stream and about nine requests per project; the drawer needs the opposite.
 * This store asks once for the project list, the root sessions and the running set, asks the pending requests only for
 * the folders that have sessions, and then follows one server-wide stream. The pure rules live in `overview.ts`.
 *
 * The stream runs while the app is in the foreground (with a server connected) or while the drawer is open, and stops
 * in the background or when the server changes. It reconnects with backoff and refetches the snapshot on every
 * reconnect, because events are live-only.
 */
import type { EventEnvelope, OpenCodeClient, SessionInfo } from "@occ/core/api"
import { errorMessage } from "@occ/core/errors"
import { applyOverviewEvent, emptyOverview, toOverviewSession, type OverviewChild, type OverviewData } from "./overview"
import type { ProjectLike } from "./projects"

/** UI redraws at most this often while events stream in (the same 200 ms the extension uses for background folders). */
export const OVERVIEW_PUBLISH_MS = 200
/** One page of root sessions; the live server had 112 roots in one page. */
export const ROOT_PAGE = 200
/** One page of children (workers); a running one is recent, and the drawer only counts them on the parent. */
export const CHILD_PAGE = 200
/** A hard cap so a server with a very long history cannot hold the drawer hostage. */
export const ROOT_CAP = 500
/** Pending requests are asked per folder, a few folders at a time. */
export const PENDING_CONCURRENCY = 4

type Hooks = { onProjects?: (projects: ProjectLike[]) => void }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class OverviewStore {
  /** The last published snapshot; the drawer derives its rows from it. */
  data = $state.raw<OverviewData | undefined>()
  loading = $state(false)
  error = $state<string | undefined>()
  /** True while the event stream is open. */
  live = $state(false)

  private client: OpenCodeClient | undefined
  private hooks: Hooks = {}
  private current: OverviewData | undefined
  private foreground = true
  private drawerOpen = false
  private running = false
  private abort: AbortController | undefined
  private streamGeneration = 0
  private loadGeneration = 0
  private refreshing: Promise<void> | undefined
  private publishTimer: ReturnType<typeof setTimeout> | undefined

  /** Point the store at a server. Resets everything and starts the snapshot and the stream. */
  connect(client: OpenCodeClient, hooks: Hooks = {}): void {
    this.disconnect()
    this.client = client
    this.hooks = hooks
    this.foreground = true
    this.current = undefined
    this.data = undefined
    this.error = undefined
    this.loading = true
    void this.refresh()
    this.syncStream()
  }

  /** Leave the server: stop the stream and forget its rows. */
  disconnect(): void {
    this.loadGeneration++
    this.refreshing = undefined
    this.stopStream()
    this.client = undefined
    this.hooks = {}
    this.current = undefined
    this.data = undefined
    this.loading = false
    this.error = undefined
    this.live = false
    if (this.publishTimer) clearTimeout(this.publishTimer)
    this.publishTimer = undefined
  }

  /** The app went to the background. */
  pause(): void {
    this.foreground = false
    this.syncStream()
  }

  /** The app is back in front: refetch, because the stream was suspended. */
  resume(): void {
    if (!this.client) return
    this.foreground = true
    void this.refresh()
    this.syncStream()
  }

  /** The drawer opened or closed. While it is open the stream stays on even if a pause arrives late. */
  setDrawerOpen(open: boolean): void {
    this.drawerOpen = open
    if (open && this.client && !this.current) void this.refresh()
    this.syncStream()
  }

  /** Ask again after an error (the drawer's "Try again"). */
  retry(): void {
    void this.refresh()
  }

  private syncStream(): void {
    const wanted = this.foreground || this.drawerOpen
    if (wanted && this.client) this.startStream()
    else this.stopStream()
  }

  private startStream(): void {
    if (this.running || !this.client) return
    this.running = true
    const generation = ++this.streamGeneration
    void this.follow(this.client, generation)
  }

  private stopStream(): void {
    this.streamGeneration++
    this.running = false
    this.live = false
    this.abort?.abort()
    this.abort = undefined
  }

  private async follow(client: OpenCodeClient, generation: number): Promise<void> {
    let delay = 500
    while (this.running && generation === this.streamGeneration && this.client === client) {
      const abort = new AbortController()
      this.abort = abort
      try {
        for await (const ev of client.event.subscribe({ signal: abort.signal })) {
          if (generation !== this.streamGeneration) return
          delay = 500
          this.live = true
          if (ev.type === "server.connected") {
            await this.refresh()
            continue
          }
          this.apply(ev as EventEnvelope)
        }
      } catch {
        // The loop below reconnects; a quiet stream during a pause is expected.
      } finally {
        this.abort = undefined
      }
      this.live = false
      if (!this.running || generation !== this.streamGeneration) return
      await sleep(delay)
      if (!this.running || generation !== this.streamGeneration) return
      delay = Math.min(delay * 2, 15_000)
      await this.refresh()
    }
  }

  private apply(ev: EventEnvelope): void {
    if (!this.current) return
    const result = applyOverviewEvent(this.current, ev)
    if (result.state !== this.current) {
      this.current = result.state
      this.schedulePublish()
    }
    if (result.refetch) void this.refresh()
  }

  /** Fetch the whole snapshot once; overlapping calls share one request. */
  refresh(): Promise<void> {
    if (!this.client) return Promise.resolve()
    if (this.refreshing) return this.refreshing
    let tracked: Promise<void>
    tracked = this.load().finally(() => {
      if (this.refreshing === tracked) this.refreshing = undefined
    })
    this.refreshing = tracked
    return tracked
  }

  private async load(): Promise<void> {
    const client = this.client
    if (!client) return
    const generation = ++this.loadGeneration
    const first = !this.current
    if (first) this.loading = true
    try {
      const [projects, sessions, active, children] = await Promise.all([
        client.project.list().catch(() => [] as ProjectLike[]),
        this.loadRootSessions(client),
        client.session.active().catch(() => ({})),
        this.loadChildren(client),
      ])
      if (generation !== this.loadGeneration || this.client !== client) return
      const pending = await this.loadPending(client, sessions)
      if (generation !== this.loadGeneration || this.client !== client) return
      this.hooks.onProjects?.(projects)
      this.current = {
        projects,
        // Archived sessions stay in the snapshot: the drawer's archive switch decides whether to show them.
        sessions: sessions.map(toOverviewSession),
        // A failed children call keeps the previous list, so the indicator does not blink out on a transient error.
        children: children ?? this.current?.children ?? [],
        running: Object.keys(active),
        permissions: pending.permissions,
        forms: pending.forms,
      }
      this.error = undefined
      this.publishNow()
    } catch (e) {
      if (generation !== this.loadGeneration || this.client !== client) return
      this.error = errorMessage(e)
      if (first) this.data = this.current
    } finally {
      if (generation === this.loadGeneration) this.loading = false
    }
  }

  /** Every root session, one page at a time up to `ROOT_CAP`. Children are not drawer rows. */
  private async loadRootSessions(client: OpenCodeClient): Promise<SessionInfo[]> {
    const all: SessionInfo[] = []
    let cursor: string | undefined
    do {
      const page = await client.session.list({ parentID: null, limit: ROOT_PAGE, ...(cursor ? { cursor } : {}) })
      all.push(...page.data)
      cursor = page.cursor?.next ?? undefined
    } while (cursor && all.length < ROOT_CAP)
    return all.slice(0, ROOT_CAP)
  }

  /**
   * Children (workers) of the root sessions. `session.list` without `parentID` answers roots and children together, so
   * one page is enough: a running worker is recent. `undefined` on a failed call keeps the previous list.
   */
  private async loadChildren(client: OpenCodeClient): Promise<OverviewChild[] | undefined> {
    try {
      const page = await client.session.list({ limit: CHILD_PAGE })
      return page.data.filter((session): session is SessionInfo & { parentID: string } => typeof session.parentID === "string").map((session) => ({ id: session.id, parentID: session.parentID }))
    } catch {
      return undefined
    }
  }

  /**
   * Pending requests per folder. Only folders that have a root session are asked, because the server has no
   * server-wide pending endpoint; a stale folder answers HTTP 500 and must not break the snapshot.
   */
  private async loadPending(client: OpenCodeClient, sessions: ReadonlyArray<SessionInfo>): Promise<Pick<OverviewData, "permissions" | "forms">> {
    const directories = [...new Set(sessions.map((session) => session.location?.directory).filter((directory): directory is string => !!directory))]
    const permissions: Record<string, string[]> = {}
    const forms: Record<string, string[]> = {}
    let next = 0
    const run = async (): Promise<void> => {
      while (next < directories.length) {
        const directory = directories[next++]!
        const location = { directory }
        try {
          const res = await client.permission.request.list({ location })
          for (const request of res.data) (permissions[request.sessionID] ??= []).push(request.id)
        } catch {
          // A folder that no longer exists: nothing to ask there.
        }
        try {
          const res = await client.form.list({ location })
          for (const form of res.data) (forms[form.sessionID] ??= []).push(form.id)
        } catch {
          // Same.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PENDING_CONCURRENCY, directories.length) }, run))
    return { permissions, forms }
  }

  private schedulePublish(): void {
    if (this.publishTimer) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined
      this.data = this.current
    }, OVERVIEW_PUBLISH_MS)
  }

  private publishNow(): void {
    if (this.publishTimer) clearTimeout(this.publishTimer)
    this.publishTimer = undefined
    this.data = this.current
  }
}

/** The empty data a test or a not-yet-connected drawer can read. */
export const emptyOverviewData = emptyOverview
