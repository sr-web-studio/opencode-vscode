/**
 * The bridge to the native watching service (`BackgroundNotifyPlugin.java`). In a desktop browser every call is a
 * harmless no-op, so `bun run dev` works.
 */
import { Capacitor, registerPlugin } from "@capacitor/core"
import { NO_STATUS, parseStatus, type NativeServer, type NotifySettings, type NotifyStatus } from "./notify"

type Plugin = {
  configure(opts: { servers: NativeServer[]; settings: NotifySettings }): Promise<unknown>
  setVisibleSession(opts: { serverId?: string; sessionID?: string }): Promise<void>
  clearSession(opts: { serverId: string; sessionID: string }): Promise<void>
  getStatus(): Promise<unknown>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  requestBatteryExemption(): Promise<unknown>
  openBatterySettings(): Promise<void>
  openNotificationSettings(): Promise<void>
}

const native = (): Plugin | undefined => (Capacitor.isNativePlatform() ? registerPlugin<Plugin>("BackgroundNotify") : undefined)

/** Hand over the saved servers and the switches; the service starts, reloads or stops accordingly. */
export async function configureService(servers: NativeServer[], settings: NotifySettings): Promise<NotifyStatus> {
  const p = native()
  if (!p) return NO_STATUS
  try {
    return parseStatus(await p.configure({ servers, settings }))
  } catch {
    return NO_STATUS
  }
}

export async function setVisibleSession(serverId: string | undefined, sessionID: string | undefined): Promise<void> {
  try {
    await native()?.setVisibleSession({ serverId, sessionID })
  } catch {
    // The service then simply notifies for this session too: harmless.
  }
}

export async function clearSessionNotification(serverId: string, sessionID: string): Promise<void> {
  try {
    await native()?.clearSession({ serverId, sessionID })
  } catch {
    // Nothing to clear.
  }
}

export async function serviceStatus(): Promise<NotifyStatus> {
  const p = native()
  if (!p) return NO_STATUS
  try {
    return parseStatus(await p.getStatus())
  } catch {
    return NO_STATUS
  }
}

/** The Android permission dialog. True when notifications are allowed afterwards. */
export async function askNotificationPermission(): Promise<boolean> {
  const p = native()
  if (!p) return false
  try {
    return (await p.requestNotificationPermission()).granted
  } catch {
    return false
  }
}

export async function askBatteryExemption(): Promise<void> {
  try {
    await native()?.requestBatteryExemption()
  } catch {
    // The user can use the settings list instead.
  }
}

export async function openBatterySettings(): Promise<void> {
  try {
    await native()?.openBatterySettings()
  } catch {
    // No settings screen to open.
  }
}

export async function openNotificationSettings(): Promise<void> {
  try {
    await native()?.openNotificationSettings()
  } catch {
    // No settings screen to open.
  }
}

export const canWatchInBackground = (): boolean => Capacitor.isNativePlatform()
