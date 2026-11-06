/** Small, dependency-free formatting helpers shared by core logic and UI. */

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

export function firstLine(text: string): string {
  const i = text.indexOf("\n")
  return (i === -1 ? text : text.slice(0, i)).trim()
}

/** `42s`, `1m 05s`, `1h 02m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, "0")}m`
}

/** Compact relative time for the session list: `now`, `5m`, `2h`, `3d`, `2w`, or a short date. */
export function relativeTime(then: number, now: number): string {
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "now"
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  if (d < 35) return `${Math.floor(d / 7)}w`
  const date = new Date(then)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Last `n` lines of a text, with a marker when something was cut. */
export function tailLines(text: string, n: number): string {
  const lines = text.replace(/\s+$/, "").split("\n")
  return lines.length <= n ? lines.join("\n") : `…\n${lines.slice(-n).join("\n")}`
}

/** First `n` lines of a text, with a marker when something was cut. */
export function headLines(text: string, n: number): string {
  const lines = text.split("\n")
  return lines.length <= n ? text : `${lines.slice(0, n).join("\n")}\n…`
}
