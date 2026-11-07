/**
 * "Ask the window for attention" (taskbar flash on Windows, X11 demand-attention on Linux, a notification on macOS).
 * Pure: the main extension (workspace host, maybe on a remote machine) decides whether to ask, the companion (UI host,
 * the user's laptop) does it. Everything here is testable without VS Code, Node or an operating system.
 */

/** What the main extension sends to the companion. Plain JSON. */
export type AttentionRequest = { kind: string; title: string; body: string }

export type OsSetting = "auto" | "off"

/**
 * The request to send for a notification that was just shown, or undefined when the window must not ask: the setting is
 * `off`, or this window has the focus (the user is looking at it already).
 */
export function attentionFor(notice: { kind: string; title: string; body: string }, state: { os: OsSetting; focused: boolean }): AttentionRequest | undefined {
  if (state.os !== "auto" || state.focused) return undefined
  return { kind: notice.kind, title: notice.title, body: notice.body }
}

/** Accept whatever arrived through `executeCommand` (older or newer callers) and keep only what is needed. */
export function normalizeRequest(raw: unknown): AttentionRequest {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback)
  return { kind: text(r.kind, "completed"), title: text(r.title, "OpenCode"), body: typeof r.body === "string" ? r.body : "" }
}

/* ------------------------------------------------------------ which window */

export type WindowCandidate = { id: number; title: string }

/** What this window looks like in a title bar. All parts optional: a missing part simply scores nothing. */
export type WindowIdentity = {
  /** Folder or workspace name without a ` [SSH: host]` suffix. */
  rootName?: string
  /** `vscode.env.appName`, e.g. "Visual Studio Code". The default title ends with it. */
  appName?: string
  /** `vscode.env.remoteName`, e.g. "ssh-remote". Only says that the window is remote. */
  remoteName?: string
  /** Host of an SSH folder's remote authority (`ssh-remote+myhost` → `myhost`); titles show `[SSH: myhost]`. */
  remoteHost?: string
}

const REMOTE_SUFFIX = /\s+\[[^\]]*\]\s*$/

/** The window identity from what the UI host can read. `workspaceName` may or may not carry the remote suffix. */
export function identityOf(parts: { workspaceName?: string; appName?: string; remoteName?: string; authority?: string }): WindowIdentity {
  const rootName = parts.workspaceName?.replace(REMOTE_SUFFIX, "").trim() || undefined
  let remoteHost: string | undefined
  const prefix = "ssh-remote+"
  if (parts.authority?.startsWith(prefix)) {
    try {
      const host = decodeURIComponent(parts.authority.slice(prefix.length))
      if (/^[\w.@:-]+$/.test(host)) remoteHost = host
    } catch {
      // not a plain host: the host just does not help matching
    }
  }
  return { rootName, appName: parts.appName?.trim() || undefined, remoteName: parts.remoteName || undefined, remoteHost }
}

const SEP = " - "
const ROOT_SCORE = 4

/** How well a window title fits this window. 0 = not at all. */
export function scoreTitle(title: string, who: WindowIdentity): number {
  let score = 0
  const root = who.rootName
  if (root) {
    const padded = `${SEP}${title}${SEP}`
    // `a.ts - folder - Visual Studio Code`, `folder - Visual Studio Code`, `a.ts - folder [SSH: host] - Visual Studio Code`
    if (padded.includes(`${SEP}${root}${SEP}`) || padded.includes(`${SEP}${root} [`)) score += ROOT_SCORE
  }
  if (who.remoteHost && title.includes(`: ${who.remoteHost}]`)) score += 2
  if (who.appName && title.endsWith(who.appName)) score += 1
  return score
}

export type Pick = {
  chosen: WindowCandidate[]
  /** `single`: only one window to choose from. `match`: one best title. `tie`: several equally good (all chosen). */
  reason: "single" | "match" | "tie" | "none"
}

/**
 * Choose the window(s) to flash. A false positive (flashing a sibling window) beats a silent miss, so equal best
 * scores are all chosen. With no title match nothing is chosen.
 *
 * `trustSingle`: the candidates are already known to be VS Code windows (Windows: same process), so a lone one is
 * ours. `requireApp`: the candidates are every window on the desktop (X11), so only titles ending with the app name
 * count.
 */
export function pickWindows(candidates: WindowCandidate[], who: WindowIdentity, opts: { trustSingle?: boolean; requireApp?: boolean } = {}): Pick {
  let pool = candidates
  if (opts.requireApp) pool = pool.filter((c) => !!who.appName && c.title.endsWith(who.appName))
  if (pool.length === 0) return { chosen: [], reason: "none" }
  if (pool.length === 1 && opts.trustSingle) return { chosen: pool, reason: "single" }
  const scored = pool.map((c) => ({ c, s: scoreTitle(c.title, who) }))
  const best = Math.max(...scored.map((x) => x.s))
  // With a known folder name the title must contain it: the app name alone fits every VS Code window.
  if (best < (who.rootName ? ROOT_SCORE : 1)) return { chosen: [], reason: "none" }
  const top = scored.filter((x) => x.s === best).map((x) => x.c)
  return { chosen: top, reason: top.length === 1 ? "match" : "tie" }
}

/* ---------------------------------------------------- Windows helper protocol */

/** One line of JSON per request on the helper's stdin, one line per answer on its stdout. */
export type HelperRequest =
  | { id: number; op: "windows"; pid: number }
  | { id: number; op: "flash"; hwnds: number[] }
  | { id: number; op: "quit" }

export type HelperWindow = { h: number; p: number; t: string }

export type HelperResponse = {
  id: number
  ok: boolean
  error?: string
  /** `windows`: the process that owns the windows (the nearest ancestor that owns any). */
  pid?: number
  windows?: HelperWindow[]
  /** `flash`: windows that were told to flash / were skipped because they already are the foreground window. */
  flashed?: number[]
  skipped?: number[]
}

export type HelperLine = { kind: "ready" } | { kind: "response"; response: HelperResponse }

/** One request line, ASCII only so no console code page can damage it. */
export function encodeRequest(req: HelperRequest): string {
  return JSON.stringify(req).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
}

/** Read one helper line; anything else (PowerShell banners, warnings) is ignored. */
export function decodeLine(line: string): HelperLine | undefined {
  const s = line.trim()
  if (!s.startsWith("{")) return undefined
  let v: unknown
  try {
    v = JSON.parse(s)
  } catch {
    return undefined
  }
  if (!v || typeof v !== "object") return undefined
  const o = v as Record<string, unknown>
  if (o.ready === true) return { kind: "ready" }
  if (typeof o.id !== "number" || typeof o.ok !== "boolean") return undefined
  return { kind: "response", response: o as unknown as HelperResponse }
}

/** Splits a byte stream (already decoded to text) into lines. */
export class LineBuffer {
  private rest = ""
  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split(/\r?\n/)
    this.rest = parts.pop() ?? ""
    return parts
  }
}

/* ------------------------------------------------------------ macOS, Linux */

const clip = (s: string, max: number): string => {
  const flat = s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Command-line options start with "-"; an argument that does would be read by osascript as one. */
const asArgument = (s: string): string => (s === "" || s.startsWith("-") ? ` ${s}` : s)

/**
 * `osascript` arguments for a notification. The text travels as argv items of `on run argv`, never inside the script,
 * so quotes, backslashes and any language need no escaping.
 */
export function osascriptArgs(title: string, body: string): string[] {
  return [
    "-e",
    "on run argv",
    "-e",
    "display notification (item 2 of argv) with title (item 1 of argv)",
    "-e",
    "end run",
    asArgument(clip(title, 80)),
    asArgument(clip(body, 240)),
  ]
}

/** `notify-send` arguments; `--` keeps text that starts with "-" from being read as an option. */
export function notifySendArgs(title: string, body: string): string[] {
  return ["--app-name=OpenCode", "--", clip(title, 80) || "OpenCode", clip(body, 240)]
}

export type X11Window = { id: string; pid: number; title: string }

/** Parse `wmctrl -l -p`: `0x04600003  0 1234 host Title text`. The title may contain spaces (and be empty). */
export function parseWmctrl(out: string): X11Window[] {
  const windows: X11Window[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^(0x[0-9a-fA-F]+)\s+(-?\d+)\s+(\d+)\s+(\S+)\s?(.*)$/.exec(line)
    if (m) windows.push({ id: m[1]!, pid: Number(m[3]), title: m[5]! })
  }
  return windows
}

/** `wmctrl` arguments that mark a window as wanting attention (the taskbar highlights it; focus is not moved). */
export const wmctrlAttentionArgs = (id: string): string[] => ["-i", "-r", id, "-b", "add,demand_attention"]
