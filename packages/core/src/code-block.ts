/** Pure helpers for the Copy button and language label on fenced code blocks in answers. */

/** marked appends one "\n" to the code of a fence; the copied text must not carry it. */
export function codeCopyText(raw: string): string {
  return raw.endsWith("\n") ? raw.slice(0, -1) : raw
}

/** Language label from a `class="language-ts"` attribute, or "" when the fence had none. */
export function codeLanguage(className: string | null | undefined): string {
  const m = /(?:^|\s)language-([^\s]+)/.exec(className ?? "")
  const lang = m?.[1] ?? ""
  return lang.length > 24 ? "" : lang
}
