/**
 * A small, strict reader for (already gunzipped) tar archives, enough for npm package tarballs: ustar headers, GNU
 * long names (`L`) and pax headers (`x`, only `path`). Pure: works on bytes, so it is testable without a filesystem.
 * Links, devices and anything else that could point outside the target folder are refused, not skipped.
 */

export type TarEntry = { path: string; type: "file" | "dir"; mode: number; data: Uint8Array }

const BLOCK = 512
const text = new TextDecoder("utf-8")

const cstr = (b: Uint8Array, from: number, len: number): string => {
  let end = from
  while (end < from + len && b[end] !== 0) end++
  return text.decode(b.subarray(from, end))
}

function octal(b: Uint8Array, from: number, len: number): number {
  // GNU base-256 for huge sizes: not needed for packages and refused.
  if ((b[from]! & 0x80) !== 0) throw new Error("tar: unsupported number encoding")
  const s = cstr(b, from, len).trim()
  if (!s) return 0
  if (!/^[0-7]+$/.test(s)) throw new Error("tar: bad number in header")
  return parseInt(s, 8)
}

/**
 * A relative path that is safe to create under a target folder: no absolute paths, no drive letters, no `..`, no
 * backslashes or NUL bytes. Returns the cleaned path (no leading `./`, no empty or `.` parts) or throws.
 */
export function safeRelativePath(raw: string): string {
  if (!raw || raw.includes("\0")) throw new Error(`tar: unsafe path ${JSON.stringify(raw)}`)
  if (raw.startsWith("/") || raw.includes("\\") || /^[a-zA-Z]:/.test(raw)) throw new Error(`tar: unsafe path ${JSON.stringify(raw)}`)
  const parts: string[] = []
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") throw new Error(`tar: unsafe path ${JSON.stringify(raw)}`)
    parts.push(part)
  }
  if (parts.length === 0) throw new Error(`tar: unsafe path ${JSON.stringify(raw)}`)
  return parts.join("/")
}

/** npm tarballs put everything under one top folder (`package/`): drop it. */
export function stripTopFolder(path: string): string | undefined {
  const i = path.indexOf("/")
  return i < 0 ? undefined : path.slice(i + 1) || undefined
}

function paxPath(data: Uint8Array): string | undefined {
  let at = 0
  let found: string | undefined
  while (at < data.length) {
    let sp = at
    while (sp < data.length && data[sp] !== 0x20) sp++
    const len = parseInt(text.decode(data.subarray(at, sp)), 10)
    if (!Number.isFinite(len) || len <= sp - at + 1 || at + len > data.length) throw new Error("tar: bad pax record")
    const rec = text.decode(data.subarray(sp + 1, at + len - 1)) // without the trailing newline
    const eq = rec.indexOf("=")
    if (eq > 0 && rec.slice(0, eq) === "path") found = rec.slice(eq + 1)
    at += len
  }
  return found
}

/** Parse a tar archive. Paths are validated with `safeRelativePath`; the caller still joins them under its own folder. */
export function parseTar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = []
  let longName: string | undefined
  let paxName: string | undefined
  let at = 0
  while (at + BLOCK <= buf.length) {
    const h = buf.subarray(at, at + BLOCK)
    if (h.every((x) => x === 0)) break // end-of-archive marker
    const size = octal(h, 124, 12)
    const mode = octal(h, 100, 8)
    const flag = String.fromCharCode(h[156] || 0x30)
    const body = at + BLOCK
    if (body + size > buf.length) throw new Error("tar: archive is truncated")
    const data = buf.subarray(body, body + size)
    at = body + Math.ceil(size / BLOCK) * BLOCK

    if (flag === "L") {
      longName = cstr(data, 0, data.length)
      continue
    }
    if (flag === "x") {
      paxName = paxPath(data)
      continue
    }
    if (flag === "g") continue // global pax header: nothing we use
    const isUstar = cstr(h, 257, 5) === "ustar"
    const prefix = isUstar ? cstr(h, 345, 155) : ""
    const name = paxName ?? longName ?? (prefix ? `${prefix}/${cstr(h, 0, 100)}` : cstr(h, 0, 100))
    longName = paxName = undefined

    if (flag === "0") out.push({ path: safeRelativePath(name), type: "file", mode, data })
    else if (flag === "5") out.push({ path: safeRelativePath(name), type: "dir", mode, data: new Uint8Array(0) })
    else throw new Error(`tar: unsupported entry type ${JSON.stringify(flag)} for ${JSON.stringify(name)}`)
  }
  return out
}
