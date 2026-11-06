/**
 * The muted line after a completed turn: `2:41 PM · 42s`.
 *
 * Pure: the clock and the time zone are parameters, so tests are exact. The UI passes `Date.now()` and the user's
 * locale; the hover title uses `fullDateTime`.
 */
import { formatDuration } from "./format"

export type TimeEnv = {
  /** "Now" in epoch ms. */
  now: number
  /** BCP 47 locale, e.g. `en-US`. Undefined uses the runtime default. */
  locale?: string
  /** IANA zone, e.g. `Asia/Dhaka`. Undefined uses the runtime zone. */
  timeZone?: string
}

type Parts = { year: number; month: number; day: number }

function partsOf(ms: number, timeZone: string | undefined): Parts {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
  const get = (type: string) => Number(f.formatToParts(ms).find((p) => p.type === type)?.value)
  return { year: get("year"), month: get("month"), day: get("day") }
}

/** Whole calendar days between two instants, in the given zone (not 24h blocks, so DST days count right). */
function dayDiff(now: Parts, then: Parts): number {
  return Math.round((Date.UTC(now.year, now.month - 1, now.day) - Date.UTC(then.year, then.month - 1, then.day)) / 86_400_000)
}

const fmt = (env: Pick<TimeEnv, "locale" | "timeZone">, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(env.locale, { timeZone: env.timeZone, ...options })

/**
 * Compact moment for a finished turn:
 * today `2:41 PM` · yesterday `Yesterday 2:41 PM` · this year `Nov 3, 2:41 PM` · older `Nov 3 2025, 2:41 PM`.
 * A moment in the future (clock skew between client and server) is treated as today.
 */
export function compactTime(at: number, env: TimeEnv): string {
  const time = fmt(env, { hour: "numeric", minute: "2-digit" }).format(at)
  const days = dayDiff(partsOf(env.now, env.timeZone), partsOf(at, env.timeZone))
  if (days <= 0) return time
  if (days === 1) return `Yesterday ${time}`
  const sameYear = partsOf(env.now, env.timeZone).year === partsOf(at, env.timeZone).year
  if (sameYear) return `${fmt(env, { month: "short", day: "numeric" }).format(at)}, ${time}`
  return `${fmt(env, { month: "short", day: "numeric", year: "numeric" }).format(at).replace(",", "")}, ${time}`
}

/** Full date and time for the hover title. */
export const fullDateTime = (at: number, env: Pick<TimeEnv, "locale" | "timeZone">): string =>
  fmt(env, { dateStyle: "full", timeStyle: "medium" }).format(at)

/**
 * `2:41 PM · 42s`, or empty for a turn that has not finished. `started` is the user prompt, `ended` the last step.
 * A missing or negative duration leaves just the time.
 */
export function turnStamp(turn: { started?: number; ended?: number; outcome?: string }, env: TimeEnv): { text: string; title: string } | undefined {
  if (!turn.outcome || turn.ended === undefined) return undefined
  const when = compactTime(turn.ended, env)
  const hasDuration = turn.started !== undefined && turn.ended >= turn.started
  const text = hasDuration ? `${when} · ${formatDuration(turn.ended - turn.started!)}` : when
  return { text, title: fullDateTime(turn.ended, env) }
}
