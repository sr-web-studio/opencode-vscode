import DOMPurify from "dompurify"
import { marked } from "marked"
import { codeLanguage } from "@occ/core/code-block"
import { looksLikePath } from "@occ/core/paths"

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
  // Added after sanitizing on purpose: the sanitizer keeps forbidding `button`.
  for (const pre of Array.from(tpl.content.querySelectorAll("pre"))) {
    const code = pre.querySelector("code")
    if (!code) continue
    const wrap = document.createElement("div")
    wrap.className = "oc-code"
    const head = document.createElement("div")
    head.className = "oc-code-head"
    const lang = document.createElement("span")
    lang.className = "oc-code-lang"
    lang.textContent = codeLanguage(code.getAttribute("class"))
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "oc-copy"
    btn.title = "Copy code"
    btn.setAttribute("aria-label", "Copy code")
    const icon = document.createElement("span")
    icon.className = "codicon codicon-copy"
    btn.appendChild(icon)
    head.append(lang, btn)
    pre.replaceWith(wrap)
    wrap.append(head, pre)
  }
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
