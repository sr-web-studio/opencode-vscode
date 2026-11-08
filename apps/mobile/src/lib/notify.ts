/**
 * Background notifications, the pure part: the owner's switches, what is handed to the native service, and the words of
 * the status line. No DOM and no Capacitor here (the root tests import this file); the bridge is `notify-native.ts`.
 */
import type { Profile } from "./profiles"

export type NotifySettings = {
  /** The master switch: the app keeps its own connection alive and notifies. */
  enabled: boolean
  permission: boolean
  question: boolean
  finished: boolean
  failed: boolean
  workers: boolean
}

export const DEFAULT_NOTIFY: NotifySettings = { enabled: true, permission: true, question: true, finished: true, failed: true, workers: true }

export const NOTIFY_KINDS: ReadonlyArray<{ key: Exclude<keyof NotifySettings, "enabled">; title: string; detail: string }> = [
  { key: "permission", title: "Needs permission", detail: "A session asks to run something." },
  { key: "question", title: "Has a question", detail: "A session waits for your answer." },
  { key: "finished", title: "Turn finished", detail: "A session finished what you asked." },
  { key: "failed", title: "Turn failed", detail: "A session stopped with an error." },
  { key: "workers", title: "Workers", detail: "A worker (child session) finished or failed." },
]

/** Read what was saved; anything missing or of the wrong type keeps its default (everything is on). */
export function parseNotifySettings(raw: unknown): NotifySettings {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  const pick = (k: keyof NotifySettings) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_NOTIFY[k])
  return {
    enabled: pick("enabled"),
    permission: pick("permission"),
    question: pick("question"),
    finished: pick("finished"),
    failed: pick("failed"),
    workers: pick("workers"),
  }
}

/** What the native service needs of a saved server. The password goes to the encrypted store of the service only. */
export type NativeServer = { id: string; name: string; url: string; password: string; serverId: string }

export function nativeServers(profiles: ReadonlyArray<Profile>): NativeServer[] {
  return profiles.map((p) => ({ id: p.id, name: p.name, url: p.url, password: p.password, serverId: p.serverId }))
}

export type WatchedServer = { id: string; name: string; connected: boolean }

export type NotifyStatus = {
  running: boolean
  connected: number
  servers: number
  /** Epoch ms of the last event the service received; 0 for none yet. */
  lastEventAt: number
  notificationsAllowed: boolean
  batteryUnrestricted: boolean
  watching: WatchedServer[]
}

export const NO_STATUS: NotifyStatus = { running: false, connected: 0, servers: 0, lastEventAt: 0, notificationsAllowed: true, batteryUnrestricted: false, watching: [] }

export function parseStatus(raw: unknown): NotifyStatus {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  const num = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : 0)
  const bool = (k: string, d: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : d)
  const list = Array.isArray(o.watching) ? o.watching : []
  const watching: WatchedServer[] = []
  for (const w of list) {
    const e = typeof w === "object" && w !== null ? (w as Record<string, unknown>) : {}
    if (typeof e.id === "string") watching.push({ id: e.id, name: typeof e.name === "string" ? e.name : e.id, connected: e.connected === true })
  }
  return {
    running: bool("running", false),
    connected: num("connected"),
    servers: num("servers"),
    lastEventAt: num("lastEventAt"),
    notificationsAllowed: bool("notificationsAllowed", true),
    batteryUnrestricted: bool("batteryUnrestricted", false),
    watching,
  }
}

/** “3 minutes ago”-style text for the last event; short and calm. */
export function ago(at: number, now: number): string {
  if (!at) return "none yet"
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 10) return "just now"
  if (s < 60) return `${s} seconds ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`
  return `${Math.round(h / 24)} days ago`
}

/** One calm sentence about what the service is doing. */
export function statusLine(settings: NotifySettings, status: NotifyStatus, serverCount: number): string {
  if (!settings.enabled) return "Background notifications are off."
  if (serverCount === 0) return "Add a server first. Then the app can watch it."
  if (!status.notificationsAllowed) return "Android is blocking notifications for this app."
  if (!status.running) return "Starting…"
  if (status.connected === status.servers) return `Watching ${status.servers} ${status.servers === 1 ? "server" : "servers"}. All connected.`
  return `Watching ${status.servers} ${status.servers === 1 ? "server" : "servers"}: ${status.connected} connected, ${status.servers - status.connected} trying to reconnect.`
}

/** The session on screen, as the service needs it: its folder's current session for a chat, the worker's own id for a worker. */
export function visibleSessionOf(
  top: { kind: string; directory?: string; sessionID?: string } | undefined,
  viewing: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (!top?.directory) return undefined
  if (top.kind === "worker") return top.sessionID
  if (top.kind === "chat") return viewing[top.directory] ?? top.sessionID
  return undefined
}
