import type { EventEnvelope, FormInfo, OpenCodeClient, PermissionRequest, SessionInfo, SlimModel } from "./api"
import { initialTarget, planNewSession, type ViewTarget } from "./draft"
import { primaryAgents, type ModelSelection } from "./models"
import {
  defaultViewSettings,
  type Action,
  type AgentSummary,
  type AppState,
  type ConnectionState,
  type ViewSettings,
} from "./protocol"
import { isRoot, upsertSession } from "./sessions"
import { applyEvent, viewFromMessages } from "./transcript/reducer"
import { emptyView, type SessionView } from "./transcript/types"

export type ControllerOptions = {
  directory: string
  folderName: string
  displayPath: string
  /** Persist small values (last open session). Optional. */
  storage?: { get(key: string): unknown; set(key: string, value: unknown): void }
  /** Called with every event after state has been updated (host feeds the notification engine). */
  onEvent?: (ev: EventEnvelope) => void
}

const HISTORY_PAGE = 200
const HISTORY_MAX = 1000
const EMIT_MS = 30
const LAST_SESSION_KEY = "lastSession"

const isDelta = (type: string) => type === "session.text.delta" || type === "session.reasoning.delta" || type === "session.tool.input.delta"

const message = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "Request failed")

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
  private target: ViewTarget = { kind: "draft" }
  private sessions: SessionInfo[] = []
  private archived: SessionInfo[] = []
  private showArchived = false
  private sessionsLoaded = false
  private running = new Set<string>()
  private permissions = new Map<string, PermissionRequest[]>()
  private forms = new Map<string, FormInfo[]>()
  private view: SessionView = emptyView()
  private loadingView = false
  private buffered: EventEnvelope[] = []
  private loadToken = 0
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

  constructor(private readonly opts: ControllerOptions) {}

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
      directory: this.opts.directory,
      folderName: this.opts.folderName,
      displayPath: this.opts.displayPath,
      target: this.target,
      sessions: this.sessions,
      archived: this.archived,
      showArchived: this.showArchived,
      sessionsLoaded: this.sessionsLoaded,
      running: [...this.running],
      waiting: [...waiting],
      view: this.view,
      loadingView: this.loadingView,
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
    }
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
      const res = await this.client.shell.get({ id: shellID, location: { directory: this.opts.directory } })
      const id = res.data.metadata?.sessionID
      return typeof id === "string" ? id : undefined
    } catch {
      return undefined
    }
  }

  /** Captured output of a shell, for "Show terminal". */
  async shellOutput(shellID: string): Promise<string> {
    const res = await this.need().shell.output({ id: shellID, location: { directory: this.opts.directory } })
    return res.data.output
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
    if (dir && dir !== this.opts.directory) return
    await this.apply(ev)
    this.opts.onEvent?.(ev)
  }

  private async apply(ev: EventEnvelope): Promise<void> {
    const d = ev.data ?? {}
    const sessionID: string | undefined = d.sessionID ?? d.form?.sessionID
    switch (ev.type) {
      case "session.created": {
        if (d.parentID || !this.client) return
        const s = await this.client.session.get({ sessionID: d.sessionID }).catch(() => undefined)
        if (s && isRoot(s) && s.location?.directory === this.opts.directory) this.sessions = this.sort(upsertSession(this.sessions, s))
        break
      }
      case "session.renamed":
        this.sessions = this.sessions.map((s) => (s.id === d.sessionID ? { ...s, title: d.title } : s))
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
      case "session.execution.interrupted":
        this.running.delete(d.sessionID)
        this.touch(d.sessionID, ev.created)
        break
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
    if (sessionID && sessionID === this.currentSessionID && ev.type.startsWith("session.")) {
      if (this.loadingView) this.buffered.push(ev)
      else {
        const next = applyEvent(this.view, ev)
        if (next !== this.view) this.view = next
      }
    }
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
    const loc = { directory: this.opts.directory }
    try {
      await Promise.all([this.loadSessions(), this.loadPending(client), this.loadCatalog(client)])
      const first = !this.synced
      this.synced = true
      if (first) {
        const remembered = this.opts.storage?.get(LAST_SESSION_KEY)
        this.target = initialTarget(this.sessions.map((s) => s.id), typeof remembered === "string" ? remembered : undefined)
      }
      if (this.target.kind === "session") await this.loadView(this.target.id)
      this.error = undefined
    } catch (e) {
      this.setConnection({ ...this.connection, status: "error", message: message(e) })
    }
    void loc
    this.emitNow()
  }

  private async loadSessions(): Promise<void> {
    const client = this.client
    if (!client) return
    const directory = this.opts.directory
    const [roots, active] = await Promise.all([
      client.session.list({ directory, parentID: null, limit: 200 }),
      client.session.active(),
    ])
    this.sessions = this.sort(roots.data.filter((s) => isRoot(s) && s.location.directory === directory))
    this.running = new Set(Object.keys(active).filter((id) => this.sessions.some((s) => s.id === id) || this.running.has(id) || id === this.currentSessionID))
    this.sessionsLoaded = true
    if (this.showArchived) await this.loadArchived()
    this.emit()
  }

  private async loadArchived(): Promise<void> {
    const client = this.client
    if (!client) return
    const directory = this.opts.directory
    const res = await client.session.list({ directory, parentID: null, archived: true, limit: 200 })
    this.archived = this.sort(res.data.filter((s) => isRoot(s) && s.location.directory === directory))
  }

  private async loadPending(client: OpenCodeClient): Promise<void> {
    const location = { directory: this.opts.directory }
    const [perms, forms] = await Promise.all([client.permission.request.list({ location }), client.form.list({ location })])
    this.permissions = new Map()
    for (const p of perms.data) this.permissions.set(p.sessionID, [...(this.permissions.get(p.sessionID) ?? []), p])
    this.forms = new Map()
    for (const f of forms.data) this.forms.set(f.sessionID, [...(this.forms.get(f.sessionID) ?? []), f])
  }

  private async loadCatalog(client: OpenCodeClient): Promise<void> {
    const location = { directory: this.opts.directory }
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
    }))
    this.providers = providers.data.map((p) => ({ id: p.id, name: p.name }))
    const dm = def?.data
    this.defaultModel = dm ? { id: dm.id, providerID: dm.providerID } : undefined
    this.defaultAgent = readDefaultAgent(config) ?? this.agents.find((a) => a.id === "build")?.id ?? this.agents[0]?.id
  }

  /** Load the transcript for a session. Events that arrive meanwhile are buffered, then replayed minus deltas. */
  private async loadView(id: string): Promise<void> {
    const client = this.client
    if (!client) return
    const token = ++this.loadToken
    this.loadingView = true
    this.buffered = []
    this.view = emptyView()
    this.emitNow()
    try {
      const all: any[] = []
      let cursor: string | undefined
      while (all.length < HISTORY_MAX) {
        const page = await client.message.list({ sessionID: id, order: "desc", limit: HISTORY_PAGE, cursor })
        all.push(...page.data)
        cursor = page.cursor.next ?? undefined
        if (!cursor || page.data.length < HISTORY_PAGE) break
      }
      if (token !== this.loadToken) return
      let view = viewFromMessages(all.reverse())
      for (const ev of this.buffered) if (!isDelta(ev.type)) view = applyEvent(view, ev)
      this.view = view
    } catch (e) {
      if (token !== this.loadToken) return
      this.view = { ...emptyView(), loaded: true }
      this.error = `Could not load the session: ${message(e)}`
    } finally {
      if (token === this.loadToken) {
        this.loadingView = false
        this.buffered = []
        this.emitNow()
      }
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
          return await this.send(action.text)
        case "stop":
          return await this.stop()
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
    if (this.target.kind === "session" && this.target.id === id && this.view.loaded) return
    this.target = { kind: "session", id }
    this.opts.storage?.set(LAST_SESSION_KEY, id)
    await this.loadView(id)
  }

  private openDraft() {
    this.target = { kind: "draft" }
    this.draftAgent = undefined
    this.draftModel = undefined
    this.view = emptyView()
    this.loadToken++
    this.loadingView = false
    this.draftEpoch++
    this.emitNow()
  }

  /** `+` never creates a server session. It opens a local draft, or focuses the input if one is already open. */
  newDraft(hasText: boolean) {
    const plan = planNewSession(this.target, hasText)
    if (plan.action === "focus") {
      this.focusTick++
      this.emitNow()
    } else this.openDraft()
  }

  private async send(text: string): Promise<void> {
    const body = text.trim()
    if (!body) return
    const client = this.need()
    if (this.target.kind === "draft") {
      // First prompt of a draft: create the session, then prompt. This is the only place a session is created.
      this.sending = true
      this.emitNow()
      const created = await client.session.create({
        location: { directory: this.opts.directory },
        agent: this.draftAgent ?? null,
        model: this.draftModel ?? null,
      })
      this.sessions = this.sort(upsertSession(this.sessions, { ...created, location: created.location ?? { directory: this.opts.directory } } as SessionInfo))
      this.target = { kind: "session", id: created.id }
      this.opts.storage?.set(LAST_SESSION_KEY, created.id)
      this.view = { ...emptyView(), loaded: true }
      this.loadToken++
      this.loadingView = false
      try {
        await client.session.prompt({ sessionID: created.id, text: body })
      } finally {
        this.sending = false
        this.emitNow()
      }
      return
    }
    await client.session.prompt({ sessionID: this.target.id, text: body })
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

/** `config.get` returns an array of documents; the first document that sets `default_agent` wins. */
function readDefaultAgent(config: unknown): string | undefined {
  const docs: unknown[] = Array.isArray(config) ? config : []
  for (const doc of docs) {
    const v = (doc as { info?: { default_agent?: unknown } } | undefined)?.info?.default_agent
    if (typeof v === "string" && v) return v
  }
  return undefined
}
