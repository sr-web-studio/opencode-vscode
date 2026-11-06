/**
 * Voice input, bring-your-own-key (Soniox). Pure: the caller passes `fetch`, so the same code runs in the extension host
 * and on mobile. The long-lived key never reaches a webview; only the host (or mobile secure storage) holds it.
 */

export const SONIOX_TEMP_KEY_URL = "https://api.soniox.com/v1/auth/temporary-api-key"

export type KeyCheck = { ok: true } | { ok: false; reason: string }

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean }>

/** A plausible key before any network call: no spaces, not empty, not absurdly short. */
export function keyShapeProblem(raw: string): string | undefined {
  const key = raw.trim()
  if (!key) return "Enter a Soniox API key."
  if (/\s/.test(key)) return "The key must not contain spaces."
  if (key.length < 16) return "That key is too short to be a Soniox API key."
  return undefined
}

/**
 * Check a Soniox key by asking for a 60-second temporary key, which costs nothing. 201/200 means valid, 401/403 means
 * rejected; anything else is reported as a problem reaching Soniox so a valid key is never called invalid by mistake.
 */
export async function checkSonioxKey(fetch: FetchLike, raw: string, timeoutMs = 10_000): Promise<KeyCheck> {
  const shape = keyShapeProblem(raw)
  if (shape) return { ok: false, reason: shape }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const res = await fetch(SONIOX_TEMP_KEY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${raw.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ usage_type: "transcribe_websocket", expires_in_seconds: 60 }),
      signal: abort.signal,
    })
    if (res.ok) return { ok: true }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "Soniox rejected this API key." }
    if (res.status === 429) return { ok: false, reason: "Soniox is rate limiting this key right now. Try again in a minute." }
    return { ok: false, reason: `Soniox answered with HTTP ${res.status}. The key was not saved.` }
  } catch (e) {
    const timedOut = abort.signal.aborted
    return { ok: false, reason: timedOut ? "Soniox did not answer in time. The key was not saved." : `Could not reach Soniox (${e instanceof Error ? e.message : "network error"}). The key was not saved.` }
  } finally {
    clearTimeout(timer)
  }
}
