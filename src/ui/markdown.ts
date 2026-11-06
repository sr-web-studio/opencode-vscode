import DOMPurify from "dompurify"
import { marked } from "marked"
import { looksLikePath } from "../core/paths"

marked.setOptions({ gfm: true, breaks: false })

const purify = DOMPurify(window)
purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("rel", "noopener noreferrer")
    node.removeAttribute("target")
  }
})

/**
 * Markdown → sanitized HTML. Inline code that looks like a file path becomes a link
 * (`a[data-path]`) that the host opens in the editor; web links are opened externally.
 */
export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  const clean = purify.sanitize(raw, { FORBID_ATTR: ["style"], FORBID_TAGS: ["style", "form", "input", "button"] })
  const tpl = document.createElement("template")
  tpl.innerHTML = clean
  for (const code of Array.from(tpl.content.querySelectorAll("code"))) {
    if (code.closest("pre") || code.closest("a")) continue
    const label = code.textContent ?? ""
    if (!looksLikePath(label)) continue
    const a = document.createElement("a")
    a.dataset.path = label
    a.href = "#"
    a.className = "oc-path"
    code.replaceWith(a)
    a.appendChild(code)
  }
  return tpl.innerHTML
}
