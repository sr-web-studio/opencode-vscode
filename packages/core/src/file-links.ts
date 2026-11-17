/**
 * Turns the text of a file link ("`src/a.ts:12:3`", `file:///x/y.md#L10`, `~/notes.md`, `[x](./a.md#L3)`) into the
 * places the file may be. Pure and string based (no `node:path`, no `vscode`), so the editor and the phone share it.
 */
import { isAbsolutePath, isWindowsPath, sameDirectory, withinDirectory } from "./paths"

export type FileLinkContext = {
  /** The home folder of the machine the files live on, for `~`. */
  home?: string
  /** The folder the session works in. It can differ from every workspace folder (moved session, worktree). */
  sessionDirectory?: string
  /** Workspace folders / project roots, most relevant first. */
  roots?: string[]
}

export type FileLink = { candidates: string[]; line?: number; column?: number }

/** A URI scheme (`mailto:`, `javascript:`), not `name.ext:12` (a file with a line number). */
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d+(?::\d+)?(?:[#?].*)?$)/i
const DRIVE = /^[A-Za-z]:[\\/]/

/** Join `rel` onto `base`, resolving `.` and `..`, in the separator style of `base`. */
export function joinPath(base: string, rel: string): string {
  const norm = base.replace(/\\/g, "/")
  const prefix = norm.startsWith("//") ? "//" : norm.startsWith("/") ? "/" : /^[A-Za-z]:/.test(norm) ? `${norm.slice(0, 2)}/` : ""
  const parts = norm.slice(prefix.length).split("/").filter(Boolean)
  for (const seg of rel.replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue
    if (seg === "..") parts.pop()
    else parts.push(seg)
  }
  const joined = `${prefix}${parts.join("/")}`
  return base.includes("\\") ? joined.replace(/\//g, "\\") : joined
}

const stripWrapping = (s: string): string => {
  let out = s.trim()
  for (;;) {
    const before = out
    if (/^(?:`+)(.*?)(?:`+)$/.test(out)) out = out.replace(/^`+|`+$/g, "")
    else if (/^(["'])(.*)\1$/.test(out)) out = out.slice(1, -1)
    else if (/^<(.*)>$/.test(out) || /^\((.*)\)$/.test(out)) out = out.slice(1, -1)
    out = out.trim()
    if (out === before) return out
  }
}

/** Trailing sentence punctuation, and a closing bracket without its opener ("see (a.ts)." → "a.ts"). */
const stripTrailing = (s: string): string => {
  let out = s
  for (;;) {
    const last = out[out.length - 1]
    if (last && ".,;:!?'\"`".includes(last)) out = out.slice(0, -1)
    else if (last === ")" && !out.includes("(")) out = out.slice(0, -1)
    else if (last === "]" && !out.includes("[")) out = out.slice(0, -1)
    else return out
  }
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** `file:///a/b%20c`, `file:///C:/x`, `file://localhost/a` → the plain path; `file://srv/share/x` → `\\srv\share\x` (UNC). */
function fromFileUrl(url: string): string {
  const rest = url.replace(/^file:\/\//i, "")
  const slash = rest.indexOf("/")
  const host = decode(slash < 0 ? rest : rest.slice(0, slash))
  const path = decode(slash < 0 ? "/" : rest.slice(slash))
  if (host && host.toLowerCase() !== "localhost") return `\\\\${host}${path.replace(/\//g, "\\")}`
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path
}

type Parsed = { path: string; line?: number; column?: number }

function parse(raw: string): Parsed {
  let text = stripWrapping(stripWrapping(raw).replace(/[.,;:!?]+$/, ""))
  let line: number | undefined
  let column: number | undefined

  const words = /\s*\((?:at\s+)?lines?\s+(\d+)\)$/i.exec(text)
  if (words) {
    line = Number(words[1])
    text = text.slice(0, words.index)
  }
  text = stripTrailing(text)

  // `#L10`, `#L10-L20`, `#L10C3` give the position; any other `#anchor` and any `?query` belong to the link, not the file.
  const hash = /#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/i.exec(text)
  if (hash) {
    line = Number(hash[1])
    if (hash[2]) column = Number(hash[2])
    text = text.slice(0, hash.index)
  }
  text = text.replace(/#.*$/, "").replace(/\?.*$/, "")

  if (/^file:\/\//i.test(text)) text = fromFileUrl(text)

  const at = /:(\d+)(?::(\d+))?(?:-\d+(?::\d+)?)?$/.exec(text)
  if (at && at.index > 0) {
    line = Number(at[1])
    if (at[2]) column = Number(at[2])
    text = text.slice(0, at.index)
  }
  text = stripTrailing(text)
  if (line !== undefined && line < 1) line = undefined
  return { path: text, line, column }
}

/** The folders above `dir` up to and including `root`; none when `dir` is not inside `root`. */
function ancestorsUpTo(dir: string, root: string): string[] {
  if (!withinDirectory(dir, root) || sameDirectory(dir, root)) return []
  const out: string[] = []
  let cur = joinPath(dir, "..")
  for (let i = 0; i < 64; i++) {
    out.push(cur)
    if (sameDirectory(cur, root) || !withinDirectory(cur, root)) break
    cur = joinPath(cur, "..")
  }
  return out
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const key = isWindowsPath(p) ? p.replace(/\\/g, "/").toLowerCase() : p.replace(/\\/g, "/")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/** Where the file of a link may be, best guess first, and the position it points to. */
export function resolveFileLink(raw: string, ctx: FileLinkContext = {}): FileLink {
  const { path, line, column } = parse(raw)
  const position = { ...(line !== undefined ? { line } : {}), ...(column !== undefined ? { column } : {}) }
  if (!path) return { candidates: [], ...position }
  if (isAbsolutePath(path)) return { candidates: [path], ...position }
  if (path === "~" || /^~[\\/]/.test(path)) {
    return { candidates: ctx.home ? [joinPath(ctx.home, path.slice(1))] : [], ...position }
  }
  const roots = (ctx.roots ?? []).filter(Boolean)
  const bases: string[] = []
  if (ctx.sessionDirectory) bases.push(ctx.sessionDirectory)
  bases.push(...roots)
  if (ctx.sessionDirectory) {
    const session = ctx.sessionDirectory
    const root = roots.find((r) => withinDirectory(session, r))
    if (root) bases.push(...ancestorsUpTo(session, root))
  }
  return { candidates: unique(bases.map((b) => joinPath(b, path))), ...position }
}

/** The sanitizer keeps a `file:` href on an anchor (and nowhere else: not on `<img src>`). */
export function keepFileHref(tag: string, attribute: string, value: string): boolean {
  return tag.toUpperCase() === "A" && attribute.toLowerCase() === "href" && /^file:\/\//i.test(value.trim())
}

/**
 * The path text of a markdown link target that points at a file, or undefined for web links, other schemes,
 * `#anchor`-only links and text that is not file-like.
 */
export function fileHrefTarget(href: string | null | undefined): string | undefined {
  const h = (href ?? "").trim()
  if (!h || h.startsWith("#") || h.startsWith("//")) return undefined
  if (/^file:\/\//i.test(h)) return h
  if (SCHEME.test(h) && !DRIVE.test(h)) return undefined
  const text = decode(h)
  const { path } = parse(text)
  if (!path) return undefined
  if (isAbsolutePath(path) || path === "~" || /^~[\\/]/.test(path)) return text
  const name = path.replace(/\\/g, "/").split("/").pop() ?? ""
  if (/[\\/]/.test(path) || /^[^.].*\.[A-Za-z0-9]+$|^\.[^.]+$/.test(name)) return text
  return undefined
}
