import type { ToolItem } from "./types"

/**
 * `execute` is OpenCode's Code Mode: the model runs JavaScript in a sandbox that calls MCP tools
 * (`tools.exa.web_search_exa(...)`, `tools["chrome-devtools"].new_page(...)`). These are the tools it calls.
 */
const NAME = String.raw`(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(["'\x60])([^"'\x60]+)\2\s*\])`
const CALL = new RegExp(String.raw`\btools\s*${NAME}\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(["'\x60])([^"'\x60]+)\5\s*\])\s*\(`, "g")

/** `ns.name` for every MCP call in the code, in order of first appearance, without duplicates. */
export function executeCalls(code: string): string[] {
  const seen = new Set<string>()
  for (const m of code.matchAll(CALL)) {
    const ns = m[1] ?? m[3]
    const name = m[4] ?? m[6]
    if (ns && name) seen.add(`${ns}.${name}`)
  }
  return [...seen]
}

/** Row target for an `execute` call: `exa.web_search_exa, chrome.new_page +2`. Empty when no MCP call is found. */
export function executeTarget(code: string): string {
  const calls = executeCalls(code)
  if (!calls.length) return ""
  const rest = calls.length - 2
  return calls.slice(0, 2).join(", ") + (rest > 0 ? ` +${rest}` : "")
}

/** The sandbox returns its result JSON-encoded; a plain string result shows as text rather than as a quoted literal. */
export function executeOutput(tool: Pick<ToolItem, "output">): string {
  const out = tool.output ?? ""
  if (out.length > 1 && out.startsWith('"') && out.endsWith('"')) {
    try {
      const v: unknown = JSON.parse(out)
      if (typeof v === "string") return v
    } catch {
      // not a JSON string: show as is
    }
  }
  return out
}
