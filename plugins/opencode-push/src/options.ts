import { readFileSync } from "node:fs"
import { homedir, hostname } from "node:os"
import { isAbsolute, resolve } from "node:path"

export const DEFAULT_CLICK_TEMPLATE = "opencode-mobile://session/{sessionID}?server={serverId}"
export const DEFAULT_TOKEN_ENV = "OPENCODE_PUSH_NTFY_TOKEN"

export type Options = {
  ntfy: {
    url: string
    topic: string
    /** Sent as `Authorization: Bearer <token>`. */
    token?: string
    /** Sent as `Authorization: Basic ...` when no token is set. */
    username?: string
    password?: string
    timeoutMs: number
  }
  kinds: { permission: boolean; question: boolean; finished: boolean; failed: boolean }
  /** Also push when a worker (child session) turn ends. */
  workers: boolean
  /** No "finished" push for turns shorter than this. */
  minDurationSeconds: number
  /** Include the question text and the first error line. Off: only generic wording. */
  details: boolean
  /** Click URL template. Placeholders: `{sessionID}`, `{serverId}`. Empty string: no click action. */
  clickTemplate: string
  serverId: string
  coalesceMs: number
}

export type ParseResult = { ok: true; options: Options; warnings: string[] } | { ok: false; error: string }

type Env = Readonly<Record<string, string | undefined>>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * OpenCode substitutes `{env:NAME}` and `{file:path}` in config strings before the plugin sees them. Doing it again here is
 * harmless (nothing is left to substitute) and keeps the plugin working if a value reaches it unresolved.
 */
export function resolveRefs(value: string, env: Env = process.env): string {
  return value
    .replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => env[name] ?? "")
    .replace(/\{file:([^}]+)\}/g, (_, file: string) => {
      const path = file.trim()
      const full = path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : isAbsolute(path) ? path : resolve(path)
      try {
        return readFileSync(full, "utf8").trim()
      } catch {
        return ""
      }
    })
}

function str(v: unknown, env: Env): string | undefined {
  if (typeof v !== "string") return undefined
  const out = resolveRefs(v, env).trim()
  return out === "" ? undefined : out
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

/** Never throws. A bad configuration returns `{ ok: false }` and the plugin stays silent instead of breaking OpenCode. */
export function parseOptions(raw: unknown, env: Env = process.env, host: string = hostname()): ParseResult {
  const o = isRecord(raw) ? raw : {}
  const n = isRecord(o.ntfy) ? o.ntfy : {}
  const k = isRecord(o.kinds) ? o.kinds : {}
  const click = isRecord(o.click) ? o.click : {}
  const warnings: string[] = []

  const topic = str(n.topic, env)
  if (!topic) return { ok: false, error: "ntfy.topic is required (use a long random string)" }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) return { ok: false, error: "ntfy.topic may only contain letters, digits, '_' and '-' (max 64)" }
  if (topic.length < 16) warnings.push("ntfy.topic is short; anyone who guesses it can read your pushes. Use 20+ random characters.")

  const url = str(n.url, env) ?? "https://ntfy.sh"
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: "ntfy.url is not a valid URL" }
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "ntfy.url must start with http:// or https://" }
  if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    warnings.push("ntfy.url uses plain http: the topic and token travel unencrypted.")
  }

  const tokenEnvName = str(n.tokenEnv, env) ?? DEFAULT_TOKEN_ENV
  const token = str(n.token, env) ?? str(`{env:${tokenEnvName}}`, env)

  return {
    ok: true,
    warnings,
    options: {
      ntfy: {
        url: parsed.toString(),
        topic,
        token,
        username: str(n.username, env),
        password: str(n.password, env),
        timeoutMs: num(n.timeoutMs, 5_000, 500, 30_000),
      },
      kinds: {
        permission: bool(k.permission, true),
        question: bool(k.question, true),
        finished: bool(k.finished, true),
        failed: bool(k.failed, true),
      },
      workers: bool(o.workers, false),
      minDurationSeconds: num(o.minDurationSeconds, 0, 0, 86_400),
      details: bool(o.details, true),
      clickTemplate: typeof click.template === "string" ? click.template.trim() : DEFAULT_CLICK_TEMPLATE,
      serverId: str(click.serverId, env) ?? host,
      coalesceMs: 5_000,
    },
  }
}
