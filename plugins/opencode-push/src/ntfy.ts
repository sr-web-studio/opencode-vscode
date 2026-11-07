import type { Options } from "./options"

export type Message = {
  title: string
  body: string
  priority: number
  tags: string[]
  click?: string
}

export type Logger = (level: "info" | "warn", message: string) => void

export const LOG_EVERY_MS = 60_000

/**
 * Publishes through ntfy's JSON API (POST to the server root), so titles with any script (Bengali, emoji) survive:
 * HTTP headers would not. https://docs.ntfy.sh/publish/#publish-as-json
 *
 * `send` never throws and never retries. A failure is logged at most once per minute.
 */
export class NtfyClient {
  private lastFailureLog = Number.NEGATIVE_INFINITY
  private suppressed = 0

  constructor(
    private readonly opts: Options["ntfy"],
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(msg: Message): Promise<boolean> {
    const payload: Record<string, unknown> = {
      topic: this.opts.topic,
      title: msg.title,
      message: msg.body,
      priority: msg.priority,
      tags: msg.tags,
    }
    if (msg.click) payload.click = msg.click

    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`
    else if (this.opts.username && this.opts.password) {
      headers.Authorization = `Basic ${Buffer.from(`${this.opts.username}:${this.opts.password}`).toString("base64")}`
    }

    try {
      const res = await this.fetcher(this.opts.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      })
      // Drain the body so the connection can be reused; its text is never logged (it could echo the request).
      await res.arrayBuffer().catch(() => undefined)
      if (!res.ok) {
        this.fail(`ntfy answered HTTP ${res.status}${res.status === 401 || res.status === 403 ? " (check ntfy.token / access rights for the topic)" : ""}`)
        return false
      }
      return true
    } catch (err) {
      const name = err instanceof Error ? err.name : ""
      this.fail(name === "TimeoutError" || name === "AbortError" ? `ntfy did not answer within ${this.opts.timeoutMs} ms` : `ntfy request failed (${describe(err)})`)
      return false
    }
  }

  private fail(reason: string): void {
    const t = this.now()
    if (t - this.lastFailureLog < LOG_EVERY_MS) {
      this.suppressed++
      return
    }
    const more = this.suppressed > 0 ? ` (${this.suppressed} more failures in the last minute)` : ""
    this.lastFailureLog = t
    this.suppressed = 0
    try {
      this.log("warn", `${reason}${more}`)
    } catch {
      // logging must never break OpenCode
    }
  }
}

/** Error text without the URL (the topic is part of nothing in the URL, but self-hosted bases can embed credentials). */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error"
  const code = (err as { code?: unknown }).code
  return typeof code === "string" ? code : err.name || "error"
}
