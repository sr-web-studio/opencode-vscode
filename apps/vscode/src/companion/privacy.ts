/**
 * Operating-system microphone permission, as far as an extension can see and fix it.
 *
 * - Windows keeps it in the registry (Settings → Privacy & security → Microphone). Three switches matter for VS Code:
 *   "Microphone access" (HKLM), "Let apps access your microphone" (HKCU) and "Let desktop apps access your microphone"
 *   (HKCU …\NonPackaged). Any of them on "Deny" makes the recorder deliver silence instead of failing.
 * - macOS asks by itself the first time VS Code records; a denial also shows up as silence. We can only open the page.
 * - Linux has no such switch.
 */

const KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone"

export const WINDOWS_QUERIES = [
  { id: "device", hive: "HKLM", key: KEY, label: "Microphone access" },
  { id: "apps", hive: "HKCU", key: KEY, label: "Let apps access your microphone" },
  { id: "desktop", hive: "HKCU", key: `${KEY}\\NonPackaged`, label: "Let desktop apps access your microphone" },
] as const

export type MicPermission = { state: "allowed" | "unknown" } | { state: "denied"; switches: string[] }

/** `Value    REG_SZ    Deny` → "Deny". */
export function regValue(output: string): string | undefined {
  const m = /\bValue\s+REG_SZ\s+(\S+)/i.exec(output)
  return m?.[1]
}

/** Combine the three `reg query` outputs (undefined: the query failed, e.g. the key does not exist). */
export function windowsMicPermission(outputs: Array<string | undefined>): MicPermission {
  const denied: string[] = []
  let known = 0
  WINDOWS_QUERIES.forEach((q, i) => {
    const v = outputs[i] === undefined ? undefined : regValue(outputs[i]!)
    if (!v) return
    known++
    if (v.toLowerCase() === "deny") denied.push(q.label)
  })
  if (denied.length) return { state: "denied", switches: denied }
  return { state: known ? "allowed" : "unknown" }
}

/** The settings page where the user turns microphone access on; undefined where there is none. */
export function micSettingsTarget(platform: string): { command: string; args: string[] } | undefined {
  if (platform === "win32") return { command: "explorer.exe", args: ["ms-settings:privacy-microphone"] }
  if (platform === "darwin") return { command: "open", args: ["x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"] }
  return undefined
}

export function deniedMessage(switches: string[]): string {
  const list = switches.map((s) => `“${s}”`).join(" and ")
  return `Windows blocks the microphone for VS Code. Turn on ${list} in Settings → Privacy & security → Microphone, then click the mic again.`
}
