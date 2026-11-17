/**
 * The VS Code webview asking its extension whether an open tab's session still exists. The webview has no client of
 * its own, so the extension runs `session.get` for it. Like `WebviewMetrics`, these messages are deliberately not part
 * of `ToHost`/`ToWebview`: only the VS Code webview sends them and only the VS Code extension answers, so the Android
 * bridge (which calls the server directly) stays as it is.
 */
import type { TabLookup } from "./session-tabs"

/** Webview → extension: look this session up. */
export type TabCheckRequest = { type: "tabCheck"; requestID: string; sessionID: string }

/** Extension → webview: the answer to one `TabCheckRequest`. */
export type TabCheckAnswer = { type: "tabCheckAnswer"; requestID: string; result: TabLookup }

export function isTabCheckRequest(m: unknown): m is TabCheckRequest {
  const o = m as Partial<TabCheckRequest> | null
  return !!o && o.type === "tabCheck" && typeof o.requestID === "string" && typeof o.sessionID === "string" && o.sessionID.length > 0
}

export function isTabCheckAnswer(m: unknown): m is TabCheckAnswer {
  const o = m as Partial<TabCheckAnswer> | null
  const state = o?.result?.state
  return !!o && o.type === "tabCheckAnswer" && typeof o.requestID === "string" && (state === "gone" || state === "exists" || state === "unknown")
}
