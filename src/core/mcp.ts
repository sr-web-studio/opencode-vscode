/**
 * MCP servers of the project (`/mcps`): the list, runtime on/off, and OAuth sign-in and sign-out.
 *
 * Everything the server owns stays on the server. Connect and disconnect are runtime-only (they do not touch OpenCode
 * config and reset when the server restarts); sign-in creates or removes the integration's stored credential through
 * the server's own API. What needs the machine we run on (opening a browser, port forwarding, a dialog) goes through
 * `McpHost`, so this file has no `vscode`, no Node and no DOM.
 */
import type { OpenCodeClient } from "./api"
import { errorMessage as message } from "./errors"

export type McpStatusKind = "connected" | "pending" | "disabled" | "failed" | "needs_auth"

export type McpRow = {
  name: string
  title?: string
  integrationID?: string
  status: McpStatusKind
  /** Why it failed or what sign-in it needs. Never contains a token: the server reports a plain message. */
  error?: string
  /** A stored credential exists for this integration, so Sign out can remove it. */
  credential: boolean
}

export type SignInState = {
  server: string
  /** `starting`: asking the server. `waiting`: the browser is open and we poll. `code`: waiting for the pasted code. */
  phase: "starting" | "waiting" | "code"
  instructions?: string
}

export type McpState = {
  open: boolean
  loading: boolean
  loaded: boolean
  servers: McpRow[]
  /** Servers with a connect/disconnect/sign-out in flight. */
  busy: string[]
  signIn?: SignInState
  /** A line the panel keeps showing (the Remote SSH sign-in remark). */
  notice?: string
  /** The last failure of an action in the panel. Cleared by the next action. */
  error?: string
}

export const emptyMcp = (): McpState => ({ open: false, loading: false, loaded: false, servers: [], busy: [] })

/** What the host does for us. Every member is optional: a client without them reports the action as unavailable. */
export type McpHost = {
  /**
   * Open the authorization page in the user's browser. Returns a remark to show next to the sign-in (for example that
   * the callback port could not be forwarded), or nothing.
   */
  openSignIn?(url: string): Promise<string | undefined>
  /** Ask for the code the provider shows after sign-in (mode `code`). Undefined when the user cancels. */
  askCode?(prompt: string): Promise<string | undefined>
  /** A modal yes/no. */
  confirm?(message: string, action: string): Promise<boolean>
}

/* ----------------------------------------------------------------- pure */

export type McpActions = {
  /** `connect` turns a stopped server on, `disconnect` turns a running one off. Pending servers have neither. */
  toggle?: "connect" | "disconnect"
  signIn: boolean
  signOut: boolean
  /** The server is starting: show a spinner instead of buttons. */
  spinner: boolean
}

export function mcpActions(row: Pick<McpRow, "status" | "integrationID" | "credential">): McpActions {
  switch (row.status) {
    case "connected":
      return { toggle: "disconnect", signIn: false, signOut: row.credential, spinner: false }
    case "disabled":
    case "failed":
      return { toggle: "connect", signIn: false, signOut: row.credential, spinner: false }
    case "needs_auth":
      return { signIn: !!row.integrationID, signOut: false, spinner: false }
    case "pending":
      return { signIn: false, signOut: false, spinner: true }
  }
}

export type McpSummary = { total: number; connected: number; failed: number; needsAuth: number }

export function mcpSummary(rows: ReadonlyArray<Pick<McpRow, "status">>): McpSummary {
  const count = (s: McpStatusKind) => rows.filter((r) => r.status === s).length
  return { total: rows.length, connected: count("connected"), failed: count("failed"), needsAuth: count("needs_auth") }
}

export const STATUS_TEXT: Record<McpStatusKind, string> = {
  connected: "Connected",
  pending: "Starting…",
  disabled: "Off",
  failed: "Failed",
  needs_auth: "Needs sign-in",
}

/** What a runtime toggle means, for the tooltip. It must be clear that OpenCode's config is not changed. */
export const TOGGLE_NOTE = "Runtime only: this does not change your OpenCode config and resets when the OpenCode server restarts."

/**
 * The callback port of an authorization URL (`redirect_uri=http://127.0.0.1:35465/callback`), when it is a loopback
 * address. That port is on the machine where OpenCode runs, so a Remote SSH window must forward it before the browser
 * on the user's computer can reach it.
 */
export function redirectLoopbackPort(authorizationUrl: string): number | undefined {
  try {
    const redirect = new URL(authorizationUrl).searchParams.get("redirect_uri")
    if (!redirect) return undefined
    const target = new URL(redirect)
    if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) return undefined
    const port = Number(target.port)
    return Number.isInteger(port) && port > 0 ? port : undefined
  } catch {
    return undefined
  }
}

/** Where the browser is relative to the OpenCode server and the extension host, which decides what sign-in needs. */
export type SignInSetting = {
  /** The callback port from the authorization URL, when it is a loopback address. */
  port?: number
  /** The extension host runs in a remote window (Remote SSH, a container, WSL). */
  remoteHost: boolean
  /** The OpenCode server runs on the machine of the extension host (no `opencode.serverUrl` to another computer). */
  serverLocal: boolean
}

/**
 * What to do before opening the authorization page. A loopback callback lives on the machine where OpenCode runs:
 * - remote window, server beside it: VS Code must forward that port to the user's computer (`asExternalUri`);
 * - server on another computer: nothing we can forward, tell the user where the sign-in has to finish.
 */
export function signInAdvice(s: SignInSetting): { forward?: number; notice?: string } {
  if (!s.serverLocal) {
    return {
      notice: s.port
        ? `The OpenCode server runs on another computer. The sign-in page returns to it on port ${s.port}, so it only completes in a browser that can reach that computer.`
        : "The OpenCode server runs on another computer, so the sign-in only completes in a browser that can reach it.",
    }
  }
  if (s.remoteHost && s.port) return { forward: s.port }
  return {}
}

/** The port VS Code forwarded to, when it differs from the one the sign-in needs, as a line for the user. */
export function forwardMismatchNotice(wanted: number, got: number | undefined): string | undefined {
  if (got === undefined || got === wanted) return undefined
  return `VS Code forwarded the sign-in callback to port ${got}, but it needs port ${wanted}. Sign-in may not complete here. Sign in from the OpenCode terminal app on the server instead.`
}

const toKind = (s: string): McpStatusKind => (s === "connected" || s === "pending" || s === "disabled" || s === "failed" || s === "needs_auth" ? s : "failed")

/* -------------------------------------------------------------- manager */

export type McpDeps = {
  client(): OpenCodeClient | undefined
  directory(): string
  host(): McpHost
  /** The state changed; the controller emits. */
  changed(): void
  /** Show an error where the panel is not on screen. */
  fail(message: string): void
  log?(line: string): void
  /** Replaced in tests. */
  sleep?(ms: number): Promise<void>
}

const LIST_EVERY_MS = 3000
const POLL_EVERY_MS = 1000
/** After sign-in the server may need a moment to connect the MCP server. */
const RELIST_AFTER_SIGN_IN = 4

export class McpManager {
  state: McpState = emptyMcp()
  private credentials = new Map<string, string[]>()
  private timer?: ReturnType<typeof setTimeout>
  private attempt?: { integrationID: string; attemptID: string; cancelled: boolean }
  private listing?: Promise<void>
  private generation = 0

  constructor(private readonly deps: McpDeps) {}

  private sleep = (ms: number) => (this.deps.sleep ? this.deps.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms)))

  private location() {
    return { directory: this.deps.directory() }
  }

  private set(patch: Partial<McpState>) {
    this.state = { ...this.state, ...patch }
    this.deps.changed()
  }

  /** An error of an action: in the panel while it is open, else on the controller's error line. */
  private report(text: string) {
    this.deps.log?.(`mcp: ${text}`)
    if (this.state.open) this.set({ error: text })
    else this.deps.fail(text)
  }

  /** The connection went away or changed: forget the list and any sign-in. A panel the user opened stays open. */
  reset() {
    this.generation++
    this.stopTimer()
    if (this.attempt) this.attempt.cancelled = true
    this.attempt = undefined
    this.credentials.clear()
    this.state = { ...emptyMcp(), open: this.state.open }
    this.deps.changed()
    if (this.state.open) void this.refresh().then(() => this.scheduleList())
  }

  /* ----------------------------------------------------------- listing */

  /** Re-read the list. Concurrent calls share one request. */
  refresh(): Promise<void> {
    if (!this.listing) this.listing = this.load().finally(() => (this.listing = undefined))
    return this.listing
  }

  private async load(): Promise<void> {
    const client = this.deps.client()
    if (!client) return
    const gen = this.generation
    if (!this.state.loaded) this.set({ loading: true })
    try {
      const res = await client.mcp.list({ location: this.location() })
      if (gen !== this.generation) return
      await this.loadCredentials(client, res.data)
      if (gen !== this.generation) return
      const servers: McpRow[] = res.data.map((s) => ({
        name: s.name,
        title: s.title,
        integrationID: s.integrationID,
        status: toKind(s.status.status),
        error: "error" in s.status ? s.status.error : undefined,
        credential: !!s.integrationID && (this.credentials.get(s.integrationID)?.length ?? 0) > 0,
      }))
      this.set({ servers, loaded: true, loading: false })
    } catch (e) {
      if (gen !== this.generation) return
      // A server without `mcp.list` simply has nothing to show.
      this.state = { ...this.state, loading: false, loaded: true }
      this.deps.log?.(`mcp.list failed: ${message(e)}`)
      if (this.state.open) this.set({ error: message(e) })
      else this.deps.changed()
    }
  }

  /** Stored credentials per integration, fetched once per integration (not on every 3 s refresh). */
  private async loadCredentials(client: OpenCodeClient, servers: ReadonlyArray<{ integrationID?: string }>): Promise<void> {
    const wanted = [...new Set(servers.flatMap((s) => (s.integrationID && !this.credentials.has(s.integrationID) ? [s.integrationID] : [])))]
    await Promise.all(
      wanted.map(async (id) => {
        try {
          const res = await client.integration.get({ integrationID: id, location: this.location() })
          this.credentials.set(id, credentialIDs(res.data.connections))
        } catch {
          this.credentials.set(id, [])
        }
      }),
    )
  }

  /** The panel opens: list now and keep listing while it stays open. */
  open() {
    if (this.state.open) return
    this.set({ open: true, error: undefined })
    void this.refresh().then(() => this.scheduleList())
  }

  close() {
    if (!this.state.open) return
    this.stopTimer()
    this.set({ open: false, error: undefined, notice: this.state.signIn ? this.state.notice : undefined })
  }

  private scheduleList() {
    this.stopTimer()
    if (!this.state.open) return
    this.timer = setTimeout(() => void this.refresh().then(() => this.scheduleList()), LIST_EVERY_MS)
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** A `mcp.status.changed` event: refresh, but only when someone sees the list or the status chip needs it. */
  statusChanged() {
    void this.refresh()
  }

  /* ----------------------------------------------------------- toggle */

  async toggle(server: string): Promise<void> {
    const row = this.state.servers.find((s) => s.name === server)
    const client = this.deps.client()
    if (!row || !client || this.state.busy.includes(server)) return
    const action = mcpActions(row).toggle
    if (!action) return
    this.set({ busy: [...this.state.busy, server], error: undefined })
    try {
      if (action === "disconnect") await client.experimental.mcp.disconnect({ server, location: this.location() })
      else await client.experimental.mcp.connect({ server, location: this.location() })
    } catch (e) {
      this.report(`${server}: ${message(e)}`)
    } finally {
      this.set({ busy: this.state.busy.filter((n) => n !== server) })
    }
    await this.refresh()
  }

  /* --------------------------------------------------------- sign in */

  async signIn(server: string): Promise<void> {
    const row = this.state.servers.find((s) => s.name === server)
    const client = this.deps.client()
    if (!row?.integrationID || !client) return
    if (this.state.signIn) return
    const integrationID = row.integrationID
    const host = this.deps.host()
    if (!host.openSignIn) {
      this.report("This client cannot open a browser for sign-in.")
      return
    }
    this.set({ signIn: { server, phase: "starting" }, notice: undefined, error: undefined })
    const gen = this.generation
    try {
      const info = await client.integration.get({ integrationID, location: this.location() })
      const method = info.data.methods.find((m) => m.type === "oauth")
      if (!method || !("id" in method)) throw new Error(`${server} does not support signing in from here.`)
      const res = await client.integration.oauth.connect({ integrationID, methodID: method.id, location: this.location() })
      if (gen !== this.generation) return
      const { attemptID, url, instructions, mode } = res.data
      const attempt = { integrationID, attemptID, cancelled: false }
      this.attempt = attempt
      const notice = await host.openSignIn(url)
      if (attempt.cancelled) return
      this.set({ signIn: { server, phase: mode === "code" ? "code" : "waiting", instructions }, notice })
      // The wait runs on its own; the action that started it returns now.
      void this.finishSignIn(client, attempt, mode, server, gen)
    } catch (e) {
      this.attempt = undefined
      this.set({ signIn: undefined })
      this.report(message(e))
    }
  }

  private async finishSignIn(
    client: OpenCodeClient,
    attempt: NonNullable<McpManager["attempt"]>,
    mode: "auto" | "code",
    server: string,
    gen: number,
  ): Promise<void> {
    const { integrationID, attemptID } = attempt
    const location = this.location()
    const alive = () => gen === this.generation && !attempt.cancelled
    try {
      if (mode === "code") {
        const code = await this.deps.host().askCode?.(`Paste the code shown after signing in to ${server}`)
        if (!alive()) return
        if (!code?.trim()) {
          await this.cancelAttempt(client, attempt)
          return
        }
        await client.integration.oauth.complete({ integrationID, attemptID, code: code.trim(), location })
      } else {
        let outcome: "complete" | "failed" | "expired" | undefined
        let failure = ""
        while (alive() && !outcome) {
          await this.sleep(POLL_EVERY_MS)
          if (!alive()) return
          const res = await client.integration.oauth.status({ integrationID, attemptID, location })
          const s = res.data
          if (s.status === "complete") outcome = "complete"
          else if (s.status === "failed") {
            outcome = "failed"
            failure = s.message
          } else if (s.status === "expired") outcome = "expired"
        }
        if (!alive()) return
        if (outcome === "failed") throw new Error(failure ? `Sign-in failed: ${failure}` : "Sign-in failed.")
        if (outcome === "expired") throw new Error("Sign-in expired. Try again.")
      }
      this.attempt = undefined
      this.credentials.delete(integrationID)
      this.set({ signIn: undefined, notice: undefined })
      for (let i = 0; i < RELIST_AFTER_SIGN_IN && gen === this.generation; i++) {
        await this.refresh()
        if (this.state.servers.find((s) => s.name === server)?.status !== "needs_auth") break
        await this.sleep(POLL_EVERY_MS)
      }
    } catch (e) {
      if (gen !== this.generation) return
      this.attempt = undefined
      this.set({ signIn: undefined })
      this.report(message(e))
    }
  }

  async cancelSignIn(): Promise<void> {
    const client = this.deps.client()
    const attempt = this.attempt
    if (!attempt || !client) {
      this.set({ signIn: undefined })
      return
    }
    await this.cancelAttempt(client, attempt)
  }

  private async cancelAttempt(client: OpenCodeClient, attempt: NonNullable<McpManager["attempt"]>) {
    attempt.cancelled = true
    if (this.attempt === attempt) this.attempt = undefined
    this.set({ signIn: undefined, notice: undefined })
    try {
      await client.integration.oauth.cancel({ integrationID: attempt.integrationID, attemptID: attempt.attemptID, location: this.location() })
    } catch (e) {
      // Already finished or expired on the server: nothing left to cancel.
      this.deps.log?.(`oauth.cancel: ${message(e)}`)
    }
  }

  /* -------------------------------------------------------- sign out */

  async signOut(server: string): Promise<void> {
    const row = this.state.servers.find((s) => s.name === server)
    const client = this.deps.client()
    if (!row?.integrationID || !client || this.state.busy.includes(server)) return
    const host = this.deps.host()
    const ok = await host.confirm?.(`Sign out of ${row.title || row.name}? The stored credential is removed from OpenCode, and any other project or client using it signs out too.`, "Sign out")
    if (!ok) return
    this.set({ busy: [...this.state.busy, server], error: undefined })
    try {
      // The cache can be older than a sign-in made elsewhere: read the live list of credentials.
      const info = await client.integration.get({ integrationID: row.integrationID, location: this.location() })
      for (const id of credentialIDs(info.data.connections)) await client.credential.remove({ credentialID: id })
      this.credentials.delete(row.integrationID)
    } catch (e) {
      this.report(`${server}: ${message(e)}`)
    } finally {
      this.set({ busy: this.state.busy.filter((n) => n !== server) })
    }
    await this.refresh()
  }
}

/** Stored credentials of an integration (`env` connections come from the environment and cannot be removed here). */
function credentialIDs(connections: ReadonlyArray<{ type: string; id?: string }>): string[] {
  return connections.flatMap((c) => (c.type === "credential" && c.id ? [c.id] : []))
}
