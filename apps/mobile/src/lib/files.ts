/**
 * What the read-only file viewer shows for the bytes of a file. Pure: no DOM, so the rules are tested directly.
 */
import { isImageMime, mimeFromName } from "@occ/core/attachments"
import { isAbsolutePath, withinDirectory } from "@occ/core/paths"

export type FileContent = { kind: "text"; text: string; lines: number; truncated: boolean } | { kind: "image"; mime: string } | { kind: "binary"; size: number }

/** A phone should not render megabytes of text in one go. */
export const MAX_VIEW_BYTES = 1_000_000
export const MAX_VIEW_LINES = 5000

/** The folder that holds `path`, in the spelling the path itself uses (`/a/b.txt` → `/a`, `C:\a\b.txt` → `C:\`). */
function parentOf(path: string): string {
  const clean = path.replace(/[\\/]+$/, "")
  const cut = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"))
  if (cut < 0) return path
  const head = clean.slice(0, cut)
  if (!head) return clean.slice(0, 1)
  if (/^[A-Za-z]:$/.test(head)) return `${head}${clean[cut]}`
  return head
}

/**
 * The `file.read` input of the viewer. The server only reads a path that is inside `location.directory` (the project
 * instance), so a picture the agent read from elsewhere — a worktree, `/tmp`, the home folder — needs the folder that
 * holds it as the location. Inside the project the project itself stays the location.
 */
export function fileReadInput(path: string, directory: string): { path: string; location: { directory: string } } {
  if (!isAbsolutePath(path)) return { path, location: { directory } }
  return { path, location: { directory: withinDirectory(path, directory) ? directory : parentOf(path) } }
}

export function classifyFile(name: string, bytes: Uint8Array): FileContent {
  const mime = mimeFromName(name)
  if (mime && isImageMime(mime)) return { kind: "image", mime }
  if (bytes.subarray(0, 8000).includes(0) || mime === "application/pdf") return { kind: "binary", size: bytes.length }
  const cut = bytes.length > MAX_VIEW_BYTES ? bytes.subarray(0, MAX_VIEW_BYTES) : bytes
  const all = new TextDecoder().decode(cut).replace(/\r\n/g, "\n").split("\n")
  // A file that ends with a newline does not have an empty last line.
  if (all.length > 1 && all[all.length - 1] === "" && bytes.length <= MAX_VIEW_BYTES) all.pop()
  const truncated = bytes.length > MAX_VIEW_BYTES || all.length > MAX_VIEW_LINES
  const lines = truncated ? all.slice(0, MAX_VIEW_LINES) : all
  return { kind: "text", text: lines.join("\n"), lines: lines.length, truncated }
}

export const humanSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** The file name of a path, for screen titles. */
export const leaf = (path: string): string =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path
