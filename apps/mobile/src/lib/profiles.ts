/**
 * Saved servers. Everything, the password included, lives in the platform's secure storage (Android Keystore) behind the
 * small `SecureKV` interface, so tests use a fake and the app never keeps a secret anywhere else.
 */
import { normalizeServerUrl, serverUrlProblem } from "@occ/core/server-url"

export type Profile = {
  id: string
  name: string
  /** Normalized base address, no trailing slash. */
  url: string
  /** The server password, or the session token a pairing handed out. */
  password: string
  /** What push links call this server (`?server=`). Defaults to the host of the address. */
  serverId: string
  /** The host name the server reported when we last connected. Helps to match push links. */
  hostname?: string
}

export interface SecureKV {
  get(key: string): Promise<unknown>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export type ProfileInput = {
  id?: string
  name?: string
  url: string
  /** Empty keeps the saved password of an existing profile. */
  password?: string
  serverId?: string
  hostname?: string
}

const PROFILES_KEY = "profiles"
const ACTIVE_KEY = "active"

/** The host part of an address: what a push link means by default. */
export function hostOf(url: string): string {
  try {
    return new URL(normalizeServerUrl(url)).hostname.replace(/^\[|\]$/g, "")
  } catch {
    return ""
  }
}

let seq = 0
const newId = () => `srv-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

function valid(x: unknown): x is Profile {
  const p = x as Partial<Profile> | null
  return !!p && typeof p.id === "string" && typeof p.url === "string" && typeof p.password === "string" && typeof p.name === "string" && typeof p.serverId === "string"
}

export class ProfileStore {
  constructor(private readonly kv: SecureKV) {}

  async list(): Promise<Profile[]> {
    const raw = await this.kv.get(PROFILES_KEY)
    if (typeof raw !== "string" || !raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(valid) : []
    } catch {
      return []
    }
  }

  async get(id: string): Promise<Profile | undefined> {
    return (await this.list()).find((p) => p.id === id)
  }

  private async write(list: Profile[]): Promise<void> {
    await this.kv.set(PROFILES_KEY, JSON.stringify(list))
  }

  /** Add a server, or update the one with `input.id`. Throws a message for the user when the address is not usable. */
  async save(input: ProfileInput): Promise<Profile> {
    const problem = serverUrlProblem(input.url)
    const url = normalizeServerUrl(input.url)
    if (!url || problem) throw new Error(problem ?? "Enter the server address.")
    const list = await this.list()
    const existing = input.id ? list.find((p) => p.id === input.id) : undefined
    const password = input.password?.length ? input.password : (existing?.password ?? "")
    const host = hostOf(url)
    const profile: Profile = {
      id: existing?.id ?? input.id ?? newId(),
      name: input.name?.trim() || host || url,
      url,
      password,
      serverId: input.serverId?.trim() || host,
      hostname: input.hostname ?? existing?.hostname,
    }
    await this.write(existing ? list.map((p) => (p.id === profile.id ? profile : p)) : [...list, profile])
    return profile
  }

  /** Remember the host name the server reported (for push links). Does nothing for a profile that is gone. */
  async learnHostname(id: string, hostname: string | undefined): Promise<void> {
    const list = await this.list()
    const p = list.find((x) => x.id === id)
    if (!p || !hostname || p.hostname === hostname) return
    await this.write(list.map((x) => (x.id === id ? { ...x, hostname } : x)))
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.list()).filter((p) => p.id !== id))
    if ((await this.activeID()) === id) await this.kv.remove(ACTIVE_KEY)
  }

  /** The server used last (opened again on the next start). */
  async activeID(): Promise<string | undefined> {
    const raw = await this.kv.get(ACTIVE_KEY)
    return typeof raw === "string" && raw ? raw : undefined
  }

  async setActive(id: string): Promise<void> {
    await this.kv.set(ACTIVE_KEY, id)
  }
}
