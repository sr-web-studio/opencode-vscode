import type { EventEnvelope, FormInfo, OpenCodeClient, PermissionRequest, SessionInfo, SlimModel } from "./api"
import { initialTarget, planNewSession, type ViewTarget } from "./draft"
import { SessionFeed } from "./feed"
import { detectFeatures, isUnsupported } from "./features"
import { primaryAgents, type ModelSelection } from "./models"
import { normalizePins, togglePin } from "./pins"
import {
  defaultViewSettings,
  type Action,
  type AgentSummary,
  type AppState,
  type ConnectionState,
  type PromptRestore,
  type ViewSettings,
} from "./protocol"
import { isRoot, upsertSession } from "./sessions"
import { isWindowsPath, sameDirectory } from "./paths"
import { isRunning } from "./transcript/reducer"
import { applyRevertEvent, revertFromServer, revertedPrompt } from "./transcript/revert"
import { toPromptFiles, type PromptFile } from "./attachments"
import { deriveWorkers, type ChildSession } from "./workers"

export type ControllerOptions = {
  directory: string
  folderName: string
  displayPath: string
  /** Persist small values (last open session). Optional. */
  storage?: { get(key: string): unknown; set(key: string, value: unknown): void }
  /** Called with every event after state has been updated (host feeds the notification engine). */
  onEvent?: (ev: EventEnvelope) => void
  /** Pinned models. The host keeps them in `globalState`; they are never written to OpenCode config. */
  pins?: { get(): string[]; set(pins: string[]): void }
  /** Diagnostics for the output channel. Never given secrets or message text. */
  log?: (line: string) => void
}

/** Something that follows the event stream: worker tabs, the terminal mirror. */
export type Observer = {
  event?(ev: EventEnvelope): void
  /** The stream (re)connected and state was refetched: anything that mirrors server state should refetch too. */
  resync?(): void
}

const EMIT_MS = 30
const LAST_SESSION_KEY = "lastSession"

const message = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "Request failed")

/** `queue` while the session works, so a new prompt waits for the current work; otherwise the server default. */
export function sendDelivery(running: boolean): "queue" | undefined {
  return running ? "queue" : undefined
}

/**
 * State for one project. It talks to the server only through the root `@opencode/client` API and keeps no
 * reference to VS Code, Node or the DOM, so the same class can run in the extension host today and in a
 * browser (mobile) later. Every call is scoped to `{ directory }`.
 */
export class Controller {
  private client?: OpenCodeClient
  private listeners = new Set<(s: AppState) => void>()
  private timer?: ReturnType<typeof setTimeout>

  private connection: ConnectionState = { status: "connecting" }
  private settings: ViewSettings = defaultViewSettings
  private voice: AppState["voice"] = { keySet: false, capture: false }
  private target: ViewTarget = { kind: "draft" }
  private sessions: SessionInfo[] = []
  private archived: SessionInfo[] = []
  private showArchived = false
  private sessionsLoaded = false
  private running = new Set<string>()
  private permissions = new Map<string, PermissionRequest[]>()
  private forms = new Map<string, FormInfo[]>()
  private readonly feed = new SessionFeed(
    (immediate) => (immediate ? this.emitNow() : this.emit()),
    (m) => {
      this.error = m
    },
  )
  private observers = new Set<Observer>()
  private shells = new Map<string, { sessionID?: string; running: boolean }>()
  private broken: { revert?: boolean; rename?: boolean } = {}
  private sentTick = 0
  private restoreTick = 0
  private restore?: PromptRestore
  private agents: AgentSummary[] = []
  private models: SlimModel[] = []
  private providers: { id: string; name: string }[] = []
  private defaultAgent?: string
  private defaultModel?: ModelSelection
  private draftAgent?: string
  private draftModel?: ModelSelection
  private error?: string
  private sending = false
  private focusTick = 0
  private draftEpoch = 0
  private abort?: AbortController
  private synced = false

  /** The server's spelling of the project folder (`location.get`), which can differ from VS Code's (e.g. `d:` vs `D:`). */
  private serverDirectory?: string

  constructor(private readonly opts: ControllerOptions) {}

  /** The project folder as the server spells it, once known; the workspace folder until then. */
  private get dir(): string {
    return this.serverDirectory ?? this.opts.directory
  }

  /* ------------------------------------------------------------ observation */

  subscribe(listener: (s: AppState) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): AppState {
    const id = this.target.kind === "session" ? this.target.id : undefined
    const current = id ? this.sessions.find((s) => s.id === id) ?? this.archived.find((s) => s.id === id) : undefined
    const waiting = new Set([...this.permissions.entries(), ...this.forms.entries()].filter(([, v]) => v.length > 0).map(([k]) => k))
    return {
      connection: this.connection,
      settings: this.settings,
      directory: this.dir,
      folderName: this.opts.folderName,
      displayPath: this.opts.displayPath,
      target: this.target,
      sessions: this.sessions,
      archived: this.archived,
      showArchived: this.showArchived,
      sessionsLoaded: this.sessionsLoaded,
      running: [...this.running],
      waiting: [...waiting],
      view: this.feed.view,
      loadingView: this.feed.loading,
      permissions: id ? (this.permissions.get(id) ?? []) : [],
      form: id ? this.forms.get(id)?.[0] : undefined,
      agents: this.agents,
      models: this.models,
      providers: this.providers,
      agent: id ? (current?.agent ?? this.defaultAgent) : (this.draftAgent ?? this.defaultAgent),
      model: id ? (current?.model ?? this.defaultModel) : (this.draftModel ?? this.defaultModel),
      error: this.error,
      sending: this.sending,
      focusTick: this.focusTick,
      draftEpoch: this.draftEpoch,
      readOnly: false,
      workers: this.workers(),
      runningShells: this.runningShells(),
      pins: this.pins(),
      features: detectFeatures(this.client, this.connection.version, this.broken),
      hasEarlier: this.feed.hasEarlier,
      loadingEarlier: this.feed.loadingEarlier,
      earlierTick: this.feed.earlierTick,
      trimPending: this.feed.trimPending,
      sentTick: this.sentTick,
      restore: this.restore,
      voice: this.voice,
    }
  }

  private pins(): string[] {
    return normalizePins(this.opts.pins?.get())
  }

  private childList(): ChildSession[] {
    const id = this.currentSessionID
    return id ? [...this.children.values()].filter((c) => c.parentID === id) : []
  }

  private workers() {
    return deriveWorkers({ view: this.feed.view, children: this.childList(), running: this.running })
  }

  private runningShells(): number {
    const id = this.currentSessionID
    if (!id) return 0
    let n = 0
    for (const sh of this.shells.values()) if (sh.running && sh.sessionID === id) n++
    return n
  }

  /** Follow the event stream and resyncs (worker tabs, the terminal mirror). */
  observe(o: Observer): () => void {
    this.observers.add(o)
    return () => this.observers.delete(o)
  }

  /** The ready client, or undefined while disconnected. For host features that talk to the server themselves. */
  get api(): OpenCodeClient | undefined {
    return this.client
  }

  /** Directory a session lives in. Shell calls use the session's own location. */
  locationOf(sessionID: string): { directory: string } {
    return { directory: this.sessionMeta(sessionID)?.directory ?? this.dir }
  }

  /** Pending permission requests of any session (worker tabs answer their own). */
  permissionsOf(sessionID: string): PermissionRequest[] {
    return this.permissions.get(sessionID) ?? []
  }

  get directory(): string {
    return this.dir
  }

  /** The agent of a worker (child) session, for terminal names. Undefined for the session on screen and other roots. */
  agentOf(sessionID: string): string | undefined {
    const child = this.children.get(sessionID)
    return child ? (child.agent ?? "worker") : undefined
  }

  private emit() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const s = this.snapshot()
      for (const l of this.listeners) l(s)
    }, EMIT_MS)
  }

  /** Emit right away (user-visible transitions where a 30 ms delay would feel laggy). */
  private emitNow() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const s = this.snapshot()
    for (const l of this.listeners) l(s)
  }

  /* -------------------------------------------------------------- host input */

  setConnection(c: ConnectionState) {
    this.connection = c
    this.emitNow()
  }

  /** The host tells whether a voice key is saved and whether it can record. */
  setVoice(v: AppState["voice"]) {
    this.voice = v
    this.emitNow()
  }

  setSettings(s: ViewSettings) {
    this.settings = s
    this.emitNow()
  }

  /** The id of the session on screen, if any. */
  get currentSessionID(): string | undefined {
    return this.target.kind === "session" ? this.target.id : undefined
  }

  /** Known facts about a session (for notifications). */
  sessionMeta(id: string): { title?: string; parentID?: string; directory?: string } | undefined {
    const s = this.sessions.find((x) => x.id === id) ?? this.archived.find((x) => x.id === id) ?? this.children.get(id)
    return s ? { title: s.title, parentID: s.parentID, directory: s.location?.directory } : undefined
  }

  private children = new Map<string, SessionInfo>()

  /** Fetch a session we do not list (child sessions) so notifications know their parent. */
  async lookupSession(id: string): Promise<{ title?: string; parentID?: string; directory?: string } | undefined> {
    const known = this.sessionMeta(id)
    if (known || !this.client) return known
    try {
      const s = await this.client.session.get({ sessionID: id })
      if (s.parentID) this.children.set(s.id, s)
      return { title: s.title, parentID: s.parentID, directory: s.location?.directory }
    } catch {
      return undefined
    }
  }

  /** The session a background shell belongs to (`metadata.sessionID` on the shell). */
  async shellSessionID(shellID: string): Promise<string | undefined> {
    if (!this.client) return undefined
    try {
      const res = await this.client.shell.get({ id: shellID, location: { directory: this.dir } })
      const id = res.data.metadata?.sessionID
      return typeof id === "string" ? id : undefined
    } catch {
      return undefined
    }
  }


  /** Attach a ready client and start following events. Replaces any previous attachment. */
  attach(client: OpenCodeClient) {
    this.detach()
    this.client = client
    this.synced = false
    this.abort = new AbortController()
    void this.follow(client, this.abort.signal)
  }

  detach() {
    this.abort?.abort()
    this.abort = undefined
    this.client = undefined
  }

  /* -------------------------------------------------------- event stream */

  private async follow(client: OpenCodeClient, signal: AbortSignal) {
    let delay = 500
    let lastActivity = Date.now()
    // Keepalives arrive about every 15 s. Silence for 45 s means the connection is stale.
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > 45_000 && this.abort && !signal.aborted) this.restartStream(client)
    }, 5_000)
    try {
      while (!signal.aborted) {
        const streamAbort = new AbortController()
        this.streamAbort = streamAbort
        const stop = () => streamAbort.abort()
        signal.addEventListener("abort", stop, { once: true })
        try {
          for await (const ev of client.event.subscribe({ signal: streamAbort.signal, onActivity: () => (lastActivity = Date.now()) })) {
            lastActivity = Date.now()
            delay = 500
            await this.onEvent(ev as EventEnvelope)
          }
        } catch (e) {
          if (signal.aborted) return
          this.setConnection({ ...this.connection, status: "disconnected", message: message(e) })
        } finally {
          signal.removeEventListener("abort", stop)
        }
        if (signal.aborted) return
        this.setConnection({ ...this.connection, status: "disconnected", message: this.connection.message ?? "Event stream closed" })
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 15_000)
      }
    } finally {
      clearInterval(watchdog)
    }
  }

  private streamAbort?: AbortController
  private restartStream(client: OpenCodeClient) {
    if (this.client === client) this.streamAbort?.abort()
  }

  async onEvent(ev: EventEnvelope): Promise<void> {
    if (ev.type === "server.connected") {
      this.setConnection({ ...this.connection, status: "connected", message: undefined })
      await this.sync()
      return
    }
    const dir = ev.location?.directory
    if (dir && !this.isOurs(dir)) return
    await this.apply(ev)
    this.opts.onEvent?.(ev)
    for (const o of this.observers) o.event?.(ev)
  }

  private async apply(ev: EventEnvelope): Promise<void> {
    const d = ev.data ?? {}
    const sessionID: string | undefined = d.sessionID ?? d.form?.sessionID
    switch (ev.type) {
      case "session.created": {
        if (!this.client) return
        const s = await this.client.session.get({ sessionID: d.sessionID }).catch(() => undefined)
        if (!s || !this.isOurs(s.location?.directory)) return
        if (isRoot(s)) this.sessions = this.sort(upsertSession(this.sessions, s))
        else this.children.set(s.id, s)
        break
      }
      case "session.renamed":
        this.sessions = this.sessions.map((s) => (s.id === d.sessionID ? { ...s, title: d.title } : s))
        if (this.children.has(d.sessionID)) this.children.set(d.sessionID, { ...this.children.get(d.sessionID)!, title: d.title })
        break
      case "shell.created": {
        const info = d.info
        if (info?.id) this.shells.set(info.id, { sessionID: typeof info.metadata?.sessionID === "string" ? info.metadata.sessionID : undefined, running: info.status === "running" })
        break
      }
      case "shell.exited": {
        const sh = this.shells.get(d.id)
        if (sh) this.shells.set(d.id, { ...sh, running: false })
        break
      }
      case "shell.deleted":
        this.shells.delete(d.id)
        break
      case "session.deleted":
        this.sessions = this.sessions.filter((s) => s.id !== d.sessionID)
        this.archived = this.archived.filter((s) => s.id !== d.sessionID)
        this.running.delete(d.sessionID)
        this.permissions.delete(d.sessionID)
        this.forms.delete(d.sessionID)
        if (this.currentSessionID === d.sessionID) await this.showDefaultTarget()
        break
      case "session.archived":
      case "session.unarchived":
        await this.loadSessions()
        break
      case "session.agent.selected":
        this.sessions = this.sessions.map((s) => (s.id === d.sessionID ? { ...s, agent: d.agent } : s))
        break
      case "session.model.selected":
        this.sessions = this.sessions.map((s) => (s.id === d.sessionID ? { ...s, model: d.model } : s))
        break
      case "session.execution.started":
        this.running.add(d.sessionID)
        this.touch(d.sessionID, ev.created)
        break
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        this.running.delete(d.sessionID)
        this.touch(d.sessionID, ev.created)
        const child = this.children.get(d.sessionID)
        if (child) {
          const outcome = ev.type === "session.execution.succeeded" ? "succeeded" : ev.type === "session.execution.failed" ? "failed" : "interrupted"
          this.children.set(child.id, { ...child, outcome })
        }
        break
      }
      case "permission.asked":
        this.permissions.set(d.sessionID, [...(this.permissions.get(d.sessionID) ?? []).filter((p) => p.id !== d.id), d as PermissionRequest])
        break
      case "permission.replied":
        this.permissions.set(d.sessionID, (this.permissions.get(d.sessionID) ?? []).filter((p) => p.id !== d.requestID))
        break
      case "form.created":
        if (d.form) this.forms.set(d.form.sessionID, [...(this.forms.get(d.form.sessionID) ?? []).filter((f) => f.id !== d.form.id), d.form as FormInfo])
        break
      case "form.replied":
      case "form.cancelled":
        this.forms.set(d.sessionID, (this.forms.get(d.sessionID) ?? []).filter((f) => f.id !== d.id))
        break
    }
    if (sessionID && sessionID === this.currentSessionID && ev.type.startsWith("session.")) this.feed.apply(ev)
    this.emit()
  }

  private touch(id: string, at: number | undefined) {
    if (!at) return
    this.sessions = this.sort(this.sessions.map((s) => (s.id === id ? { ...s, time: { ...s.time, updated: at } } : s)))
  }

  private sort(list: SessionInfo[]) {
    return [...list].sort((a, b) => b.time.updated - a.time.updated)
  }

  /* ----------------------------------------------------------------- sync */

  /** Events are live-only, so everything that can change while disconnected is refetched. */
  async sync(): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      await this.resolveDirectory(client)
      await Promise.all([this.loadSessions(), this.loadPending(client), this.loadCatalog(client), this.loadShells(client)])
      const first = !this.synced
      this.synced = true
      if (first) {
        const remembered = this.opts.storage?.get(LAST_SESSION_KEY)
        this.target = initialTarget(this.sessions.map((s) => s.id), typeof remembered === "string" ? remembered : undefined)
      }
      if (this.target.kind === "session") await this.loadView(this.target.id)
      else this.children.clear()
      this.error = undefined
    } catch (e) {
      this.setConnection({ ...this.connection, status: "error", message: message(e) })
    }
    this.emitNow()
    for (const o of this.observers) o.resync?.()
  }

  /**
   * Ask the server how it spells this folder. Session lists filter on the exact stored path, so on Windows a
   * `d:\\Work` from VS Code would miss sessions stored under `D:\\Work`. Older servers without `location.get` keep the
   * workspace path.
   */
  private async resolveDirectory(client: OpenCodeClient): Promise<void> {
    if (!this.opts.directory || this.serverDirectory) return
    try {
      const info = await client.location.get({ location: { directory: this.opts.directory } })
      if (typeof info?.directory === "string" && sameDirectory(info.directory, this.opts.directory)) {
        this.serverDirectory = info.directory
      }
      this.opts.log?.(`Folder ${this.opts.directory} → server location ${info?.directory ?? "?"} (project ${info?.project?.id ?? "?"} at ${info?.project?.directory ?? "?"})`)
    } catch (e) {
      this.opts.log?.(`location.get failed for ${this.opts.directory}: ${message(e)}. Using the folder path as is.`)
    }
  }

  /** Background shells of this project (`shell.list`). A server without it just has none to show. */
  private async loadShells(client: OpenCodeClient): Promise<void> {
    try {
      const res = await client.shell.list({ location: { directory: this.dir } })
      this.shells = new Map(res.data.map((i) => [i.id, { sessionID: typeof i.metadata?.sessionID === "string" ? i.metadata.sessionID : undefined, running: i.status === "running" }]))
    } catch {
      this.shells = new Map()
    }
  }

  /** Children of a session: `session.list({ parentID })`. Live `session.created` events keep the map current afterwards. */
  private async loadChildren(client: OpenCodeClient, parentID: string): Promise<void> {
    try {
      // The parent id alone picks the children; no folder filter, so a differently spelled path cannot hide them.
      const res = await client.session.list({ parentID, limit: 200 })
      for (const [id, c] of this.children) if (c.parentID === parentID) this.children.delete(id)
      for (const c of res.data) if (c.parentID === parentID) this.children.set(c.id, c)
    } catch {
      // Older server or a transient error: the Background row then relies on the tool lines alone.
    }
  }

  /** Children that are executing now (so a background worker shows as running after its tool call returned). */
  private async refreshChildRunning(client: OpenCodeClient): Promise<void> {
    try {
      const active = await client.session.active()
      for (const id of this.children.keys()) {
        if (active[id]) this.running.add(id)
        else this.running.delete(id)
      }
    } catch {
      // keep what events told us
    }
  }

  /** A directory from the server is this window's folder, in either spelling. */
  private isOurs(directory: string | undefined): boolean {
    return sameDirectory(directory, this.dir) || sameDirectory(directory, this.opts.directory)
  }

  private async loadSessions(): Promise<void> {
    const client = this.client
    if (!client) return
    const [scoped, active] = await Promise.all([
      client.session.list({ directory: this.dir, parentID: null, limit: 200 }),
      client.session.active(),
    ])
    let roots = scoped
    // The server filters on the exact stored path. On Windows its spelling can still differ (drive letter case, an
    // older server without `location.get`), so look through the newest sessions of every folder instead.
    if (roots.data.length === 0 && isWindowsPath(this.dir)) roots = await client.session.list({ parentID: null, limit: 200 })
    this.sessions = this.sort(roots.data.filter((s) => isRoot(s) && this.isOurs(s.location.directory)))
    const others = [...new Set(roots.data.filter((s) => !this.isOurs(s.location?.directory)).map((s) => s.location?.directory))]
    this.opts.log?.(`Sessions: ${this.sessions.length} for this folder of ${roots.data.length} listed for ${this.dir}${others.length ? `; other folders: ${others.slice(0, 5).join(", ")}` : ""}`)
    this.running = new Set(Object.keys(active).filter((id) => this.sessions.some((s) => s.id === id) || this.children.has(id) || this.running.has(id) || id === this.currentSessionID))
    this.sessionsLoaded = true
    if (this.showArchived) await this.loadArchived()
    this.emit()
  }

  private async loadArchived(): Promise<void> {
    const client = this.client
    if (!client) return
    const res = await client.session.list({ directory: this.dir, parentID: null, archived: true, limit: 200 })
    this.archived = this.sort(res.data.filter((s) => isRoot(s) && this.isOurs(s.location.directory)))
  }

  private async loadPending(client: OpenCodeClient): Promise<void> {
    const location = { directory: this.dir }
    const [perms, forms] = await Promise.all([client.permission.request.list({ location }), client.form.list({ location })])
    this.permissions = new Map()
    for (const p of perms.data) this.permissions.set(p.sessionID, [...(this.permissions.get(p.sessionID) ?? []), p])
    this.forms = new Map()
    for (const f of forms.data) this.forms.set(f.sessionID, [...(this.forms.get(f.sessionID) ?? []), f])
  }

  private async loadCatalog(client: OpenCodeClient): Promise<void> {
    const location = { directory: this.dir }
    const [agents, models, providers, def, config] = await Promise.all([
      client.agent.list({ location }),
      client.model.list({ location }),
      client.provider.list({ location }),
      client.model.default({ location }).catch(() => undefined),
      client.config.get({ location }).catch(() => undefined),
    ])
    this.agents = primaryAgents(agents.data).map((a) => ({ id: a.id, name: a.name, description: a.description }))
    // Only what the pickers need. Provider settings, headers and keys never leave this method.
    this.models = models.data.map((m) => ({
      id: m.id, modelID: m.modelID, providerID: m.providerID, name: m.name, enabled: m.enabled, status: m.status,
      variants: m.variants.map((v) => ({ id: v.id })),
      input: m.capabilities?.input,
    }))
    this.providers = providers.data.map((p) => ({ id: p.id, name: p.name }))
    const dm = def?.data
    this.defaultModel = dm ? { id: dm.id, providerID: dm.providerID } : undefined
    this.defaultAgent = readDefaultAgent(config) ?? this.agents.find((a) => a.id === "build")?.id ?? this.agents[0]?.id
  }

  /** Load the transcript since the last compaction, the children (workers) and any staged revert. */
  private async loadView(id: string): Promise<void> {
    const client = this.client
    if (!client) return
    this.restore = undefined
    this.children.clear()
    await this.feed.load(client, id)
    if (this.currentSessionID !== id) return
    await Promise.all([this.loadChildren(client, id), this.loadRevert(client, id)])
    await this.refreshChildRunning(client)
    this.emitNow()
  }

  /** A session that was left with a staged rollback shows its bar again (`Session.Info.revert`). */
  private async loadRevert(client: OpenCodeClient, id: string): Promise<void> {
    try {
      const info = await client.session.get({ sessionID: id })
      const revert = revertFromServer(info.revert as never)
      if (revert) this.feed.view = { ...this.feed.view, revert }
    } catch {
      // No revert info: the transcript is shown as is.
    }
  }

  private async showDefaultTarget() {
    const first = this.sessions[0]
    if (first) await this.open(first.id)
    else this.openDraft()
  }

  /* -------------------------------------------------------------- actions */

  async dispatch(action: Action): Promise<void> {
    if (action.type !== "dismissError" && action.type !== "ready") this.error = undefined
    try {
      switch (action.type) {
        case "ready":
          this.emitNow()
          return
        case "openSession":
          return await this.open(action.id)
        case "newDraft":
          return this.newDraft(action.hasText)
        case "send":
          return await this.send(action.text, action.files)
        case "stop":
          return await this.stop()
        case "queued":
          return await this.queuedAction(action.inboxID, action.op)
        case "rename":
          return await this.rename(action.id, action.title)
        case "togglePin":
          return this.togglePin(action.key)
        case "revert":
          return await this.revert(action.messageID)
        case "redo":
          return await this.redo()
        case "loadEarlier":
          return await this.loadEarlier()
        case "trimCompacted":
          this.feed.trim()
          this.emitNow()
          return
        case "pickAgent":
          return await this.pickAgent(action.id)
        case "pickModel":
          return await this.pickModel(action.model)
        case "permission":
          await this.need().permission.reply({ sessionID: action.sessionID, requestID: action.requestID, decision: action.decision })
          return
        case "formReply": {
          const form = this.currentForm()
          if (form) await this.need().session.form.reply({ sessionID: form.sessionID, formID: form.id, answer: action.answer })
          return
        }
        case "formCancel": {
          const form = this.currentForm()
          if (form) await this.need().session.form.cancel({ sessionID: form.sessionID, formID: form.id })
          return
        }
        case "toggleArchived":
          this.showArchived = !this.showArchived
          if (this.showArchived) await this.loadArchived()
          this.emitNow()
          return
        case "refresh":
          return await this.sync()
        case "dismissError":
          this.emitNow()
          return
      }
    } catch (e) {
      this.sending = false
      this.error = message(e)
      this.emitNow()
    }
  }

  private need(): OpenCodeClient {
    if (!this.client) throw new Error("Not connected to OpenCode")
    return this.client
  }

  private currentForm(): FormInfo | undefined {
    const id = this.currentSessionID
    return id ? this.forms.get(id)?.[0] : undefined
  }

  async open(id: string): Promise<void> {
    if (this.target.kind === "session" && this.target.id === id && this.feed.view.loaded) return
    this.target = { kind: "session", id }
    this.opts.storage?.set(LAST_SESSION_KEY, id)
    await this.loadView(id)
  }

  private openDraft() {
    this.target = { kind: "draft" }
    this.draftAgent = undefined
    this.draftModel = undefined
    this.feed.reset()
    this.children.clear()
    this.restore = undefined
    this.draftEpoch++
    this.emitNow()
  }

  /** `+` never creates a server session. It opens a local draft, or focuses the input if one is already open. */
  newDraft(hasText: boolean) {
    const plan = planNewSession(this.target, hasText)
    if (plan.action === "focus") {
      this.focusTick++
      this.emitNow()
    } else {
      this.openDraft()
      // `+` is a user action: the new draft's prompt box may take focus. Other paths into a draft (a session deleted
      // elsewhere) go through openDraft() alone and never ask for focus.
      this.focusTick++
      this.emitNow()
    }
  }

  private async send(text: string, files: PromptFile[] = []): Promise<void> {
    const body = text.trim()
    if (!body && files.length === 0) return
    const client = this.need()
    if (this.target.kind === "draft") {
      // First prompt of a draft: create the session, then prompt. This is the only place a session is created.
      this.sending = true
      this.emitNow()
      const created = await client.session.create({
        location: { directory: this.dir },
        agent: this.draftAgent ?? null,
        model: this.draftModel ?? null,
      })
      this.sessions = this.sort(upsertSession(this.sessions, { ...created, location: created.location ?? { directory: this.dir } } as SessionInfo))
      this.target = { kind: "session", id: created.id }
      this.opts.storage?.set(LAST_SESSION_KEY, created.id)
      this.feed.startEmpty()
      this.children.clear()
      this.sentTick++
      try {
        await client.session.prompt({ sessionID: created.id, text: body, ...filesInput(files) })
      } finally {
        this.sending = false
        this.emitNow()
      }
      return
    }
    // The server commits a staged revert by itself when a prompt arrives (live-checked on 2.2.5): no commit call here.
    const id = this.target.id
    this.restore = undefined
    this.feed.trim()
    this.sentTick++
    this.emitNow()
    // The server's default delivery is `steer`: the prompt joins the running turn at its next step. While the agent
    // works, a prompt waits in the inbox until the work is done instead, like the OpenCode apps (`queue`).
    const delivery = sendDelivery(this.running.has(id) || isRunning(this.feed.view))
    await client.session.prompt({ sessionID: id, text: body, ...filesInput(files), ...(delivery ? { delivery } : {}) })
  }

  /** Send a queued prompt now (it joins the running turn at the next step) or remove it from the queue. */
  private async queuedAction(inboxID: string, op: "steer" | "cancel"): Promise<void> {
    const id = this.currentSessionID
    if (!id) return
    const client = this.need()
    if (op === "steer") await client.session.inbox.update({ sessionID: id, inboxID, delivery: "steer" })
    else await client.session.inbox.cancel({ sessionID: id, inboxID })
  }

  /* ----------------------------------------------------------- title, pins */

  private async rename(id: string, title: string): Promise<void> {
    const next = title.trim()
    const known = this.sessions.find((s) => s.id === id) ?? this.archived.find((s) => s.id === id)
    if (!next || !known || next === (known.title ?? "")) return
    const client = this.need()
    try {
      await client.session.update({ sessionID: id, title: next })
    } catch (e) {
      if (isUnsupported(e)) this.broken.rename = true
      throw e
    }
    // `session.renamed` normally follows; apply it now so the title does not flicker back.
    this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, title: next } : s))
    this.archived = this.archived.map((s) => (s.id === id ? { ...s, title: next } : s))
    this.emitNow()
  }

  private togglePin(key: string): void {
    this.opts.pins?.set(togglePin(this.pins(), key))
    this.emitNow()
  }

  /* ---------------------------------------------------------------- revert */

  private canRevertNow(): boolean {
    return detectFeatures(this.client, this.connection.version, this.broken).revert
  }

  /** Stage a rollback to a prompt: files restored by the server, the prompt text goes back to the prompt box. */
  private async revert(messageID: string): Promise<void> {
    const id = this.currentSessionID
    if (!id || !this.canRevertNow()) return
    if (this.running.has(id) || isRunning(this.feed.view)) throw new Error("Stop the session first, then revert.")
    const view = this.feed.view
    const prompt = view.turns.find((t) => t.user?.id === messageID)?.user?.text
    let staged: unknown
    try {
      staged = await this.need().session.revert.stage({ sessionID: id, messageID, files: true })
    } catch (e) {
      if (isUnsupported(e)) this.broken.revert = true
      throw e
    }
    // The `session.revert.staged` event follows. Apply the answer now so the bar and the hidden turns appear at once.
    this.feed.view = applyRevertEvent(this.feed.view, "session.revert.staged", { revert: staged })
    const text = prompt ?? revertedPrompt(this.feed.view) ?? ""
    this.restore = { tick: ++this.restoreTick, text }
    this.focusTick++
    this.emitNow()
  }

  private async redo(): Promise<void> {
    const id = this.currentSessionID
    if (!id) return
    await this.need().session.revert.clear({ sessionID: id })
    this.feed.view = applyRevertEvent(this.feed.view, "session.revert.cleared", { sessionID: id })
    this.emitNow()
  }

  private async loadEarlier(): Promise<void> {
    const id = this.currentSessionID
    if (id) await this.feed.loadEarlier(this.need(), id)
  }

  private async stop(): Promise<void> {
    const id = this.currentSessionID
    if (id) await this.need().session.interrupt({ sessionID: id })
  }

  private async pickAgent(agent: string): Promise<void> {
    const id = this.currentSessionID
    if (!id) {
      this.draftAgent = agent
      this.emitNow()
      return
    }
    this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, agent } : s))
    this.emitNow()
    await this.need().session.switchAgent({ sessionID: id, agent })
  }

  private async pickModel(model: ModelSelection): Promise<void> {
    const id = this.currentSessionID
    if (!id) {
      this.draftModel = model
      this.emitNow()
      return
    }
    this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, model } : s))
    this.emitNow()
    await this.need().session.switchModel({ sessionID: id, model })
  }
}

const filesInput = (files: readonly PromptFile[]) => (files.length > 0 ? { files: toPromptFiles(files as never) } : {})

/** `config.get` returns an array of documents; the first document that sets `default_agent` wins. */
function readDefaultAgent(config: unknown): string | undefined {
  const docs: unknown[] = Array.isArray(config) ? config : []
  for (const doc of docs) {
    const v = (doc as { info?: { default_agent?: unknown } } | undefined)?.info?.default_agent
    if (typeof v === "string" && v) return v
  }
  return undefined
}
