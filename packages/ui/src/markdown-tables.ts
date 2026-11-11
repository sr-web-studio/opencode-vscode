/**
 * Wrap every top-level `<table>` of sanitized markdown HTML in `<div class="oc-table">`, the box that scrolls a
 * table wider than the chat sideways without widening the conversation around it.
 *
 * It works on the HTML string so that the rule is testable without a DOM (markdown rendering needs a browser
 * otherwise). Only `<table>` tags are touched; everything between them is copied byte for byte, and nested
 * tables are wrapped once, by their outermost table.
 */
export function wrapTables(html: string): string {
  const out: string[] = []
  let copied = 0
  let depth = 0
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf("<", i)
    if (lt < 0) break
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4)
      i = end < 0 ? html.length : end + 3
      continue
    }
    const end = tagEnd(html, lt)
    if (end < 0) break
    const name = tagName(html, lt, end)
    if (name === "table") {
      if (depth === 0) {
        out.push(html.slice(copied, lt), '<div class="oc-table">')
        copied = lt
      }
      depth++
    } else if (name === "/table") {
      depth = Math.max(0, depth - 1)
      if (depth === 0) {
        out.push(html.slice(copied, end + 1), "</div>")
        copied = end + 1
      }
    }
    i = end + 1
  }
  // An unclosed table would leave a stray wrapper behind; keep the input then.
  if (copied === 0 || depth !== 0) return html
  out.push(html.slice(copied))
  return out.join("")
}

/** Index of the `>` that closes the tag starting at `lt`, skipping quoted attribute values. */
function tagEnd(html: string, lt: number): number {
  let quote = ""
  for (let i = lt + 1; i < html.length; i++) {
    const ch = html[i]
    if (quote) {
      if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ">") return i
  }
  return -1
}

/** Lower-case tag name, `/`-prefixed when closing and without a self-closing slash: `table`, `/table`, `td`. */
function tagName(html: string, lt: number, end: number): string {
  const raw = html.slice(lt + 1, end).trim()
  const closing = raw.startsWith("/")
  const name = (closing ? raw.slice(1) : raw).split(/[\s/]/, 1)[0] ?? ""
  return (closing ? "/" : "") + name.toLowerCase()
}
