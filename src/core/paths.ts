/** Pure path helpers (string based, POSIX and Windows separators). No `node:path`. */

const normalize = (p: string) => p.replace(/\\/g, "/")

export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)
}

/** Path relative to `cwd` when it lives inside it, otherwise unchanged. */
export function relativeTo(path: string, cwd: string): string {
  const p = normalize(path)
  const base = normalize(cwd).replace(/\/+$/, "")
  if (base && p === base) return "."
  if (base && p.startsWith(`${base}/`)) return p.slice(base.length + 1)
  return path
}

/** Replace the home directory prefix with `~`. */
export function shortenHome(path: string, home: string | undefined): string {
  if (!home) return path
  const p = normalize(path)
  const h = normalize(home).replace(/\/+$/, "")
  if (p === h) return "~"
  if (p.startsWith(`${h}/`)) return `~${p.slice(h.length)}`
  return path
}

export const isWindowsPath = (p: string): boolean => /^[A-Za-z]:/.test(p) || p.startsWith("\\\\")

/**
 * The same directory, as the server and VS Code may spell it: separators, trailing slashes, and on Windows the case
 * (VS Code reports `d:\Work`, the server stores `D:\Work`).
 */
export function sameDirectory(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const clean = (p: string) => normalize(p).replace(/(?<=.)\/+$/, "")
  const x = clean(a)
  const y = clean(b)
  if (x === y) return true
  return (isWindowsPath(a) || isWindowsPath(b)) && x.toLowerCase() === y.toLowerCase()
}

export function folderName(path: string): string {
  const parts = normalize(path).replace(/\/+$/, "").split("/")
  return parts[parts.length - 1] || path
}

/** Split `src/a.ts:42` into path and 1-based line. */
export function splitLine(ref: string): { path: string; line?: number } {
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(ref)
  if (m?.[1] && m[2]) return { path: m[1], line: Number(m[2]) }
  return { path: ref }
}

const KNOWN_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "md", "mdx", "svelte", "vue", "css", "scss", "html",
  "py", "rs", "go", "java", "kt", "swift", "rb", "php", "c", "h", "cpp", "hpp", "cs", "sh", "bash", "zsh",
  "yml", "yaml", "toml", "lock", "txt", "sql", "xml", "env", "gitignore", "dockerfile",
])

/** Conservative check for inline text that is probably a file reference. */
export function looksLikePath(text: string): boolean {
  if (text.length > 260 || /\s/.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false
  const { path } = splitLine(text)
  if (!/^[\w@.~\-/\\:]+$/.test(path)) return false
  const name = normalize(path).split("/").pop() ?? ""
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  if (!KNOWN_EXT.has(ext)) return false
  return path.includes("/") || path.includes("\\") || name.length > ext.length + 1
}
