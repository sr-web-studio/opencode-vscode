import { isLocalServer } from "./server-url"

/**
 * "Open Global Config": find the user's global OpenCode config file so they can edit it themselves.
 * This extension only ever OPENS that file (or, after an explicit question, creates it empty). It never edits it.
 *
 * Where OpenCode 2.2.5 reads its global config (checked in the installed binary and in
 * https://opencode.ai/v2/docs/config, "Locations"):
 * - the global directory is `$OPENCODE_CONFIG_DIR` when set, else `$XDG_CONFIG_HOME/opencode`, else `<home>/.config/opencode`
 *   (also on Windows: `%USERPROFILE%\.config\opencode`; there is no `%APPDATA%` lookup for it);
 * - in it OpenCode loads `opencode.json` and then `opencode.jsonc`, in that order; a document loaded later overrides
 *   an earlier one, so `opencode.jsonc` wins when both exist;
 * - `OPENCODE_CONFIG` is NOT the global config: it names one extra file merged on top. It is ignored here.
 * - `config.json` in that directory is not a config document (it is only read for the `update` key).
 */

export type ConfigEnv = Record<string, string | undefined>

/** In OpenCode's load order: the last one that exists has the highest precedence. */
export const CONFIG_FILES = ["opencode.json", "opencode.jsonc"] as const
/** What OpenCode would read, and what the V2 docs tell users to create, when neither file exists. */
export const DEFAULT_CONFIG_FILE = "opencode.jsonc"
export const CONFIG_SCHEMA = "https://opencode.ai/config.json"
export const NEW_CONFIG_TEXT = `{\n  "$schema": "${CONFIG_SCHEMA}"\n}\n`

const sep = (platform: string) => (platform === "win32" ? "\\" : "/")

/** Join with the separator of `platform`, without `node:path` (this folder must run anywhere). */
export function joinFor(platform: string, base: string, ...parts: string[]): string {
  const s = sep(platform)
  const head = base.length > 1 ? base.replace(/[\\/]+$/, "") : base
  return [head, ...parts].join(s)
}

/** The global config directory, or undefined when no home folder is known. Empty variables count as unset. */
export function globalConfigDir(input: { env: ConfigEnv; home: string; platform: string }): string | undefined {
  const { env, home, platform } = input
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR
  if (env.XDG_CONFIG_HOME) return joinFor(platform, env.XDG_CONFIG_HOME, "opencode")
  if (!home) return undefined
  return joinFor(platform, home, ".config", "opencode")
}

export type ResolvedConfig = { dir: string; path: string; exists: boolean; candidates: string[] }

/**
 * The file to open. `existing` are the full paths (of `candidates`) that exist. The highest-precedence existing file
 * wins; with none, the path OpenCode would read (`opencode.jsonc`) and `exists: false`.
 */
export function resolveGlobalConfig(input: { env: ConfigEnv; home: string; platform: string; existing: readonly string[] }): ResolvedConfig | undefined {
  const dir = globalConfigDir(input)
  if (!dir) return undefined
  const candidates = CONFIG_FILES.map((f) => joinFor(input.platform, dir, f))
  const found = candidates.filter((c) => input.existing.includes(c))
  const path = found.at(-1)
  return path ? { dir, path, exists: true, candidates } : { dir, path: joinFor(input.platform, dir, DEFAULT_CONFIG_FILE), exists: false, candidates }
}

/**
 * Which computer holds the config. The extension runs next to VS Code's files (a `workspace` extension: in a Remote-SSH
 * window that is the remote host). The server's config is on this machine when the server is local (no
 * `opencode.serverUrl`, or a loopback address) or when the server reports the same hostname as this machine.
 * Anything else is another computer: its config cannot be opened from here.
 */
export type ConfigPlace = { where: "here" } | { where: "server"; hostname?: string }

export function configPlace(input: { serverUrl: string; serverHostname?: string; localHostname?: string }): ConfigPlace {
  if (isLocalServer(input.serverUrl)) return { where: "here" }
  const server = input.serverHostname?.trim().toLowerCase()
  if (server && server === input.localHostname?.trim().toLowerCase()) return { where: "here" }
  return { where: "server", hostname: input.serverHostname?.trim() || undefined }
}

export function remoteConfigNotice(hostname?: string): string {
  const who = hostname ? `the computer “${hostname}”` : "the computer that runs the server"
  return `The OpenCode server runs on ${who}, so its global config lives there, not on this machine. It is usually ~/.config/opencode/opencode.jsonc on that computer. Open it there to edit it.`
}

/** What the command needs from the machine it runs on. Implemented with `vscode` and `node:fs` in `src/extension/`. */
export type ConfigHost = {
  exists(path: string): Promise<boolean>
  /** A modal question: "Create <path>?" with Create / Cancel. */
  confirmCreate(path: string): Promise<boolean>
  /** Create the file; it must fail, not overwrite, when the file exists. */
  create(path: string, text: string): Promise<void>
  open(path: string): Promise<void>
  info(message: string): void
}

export type OpenConfigInput = {
  env: ConfigEnv
  home: string
  platform: string
  serverUrl: string
  serverHostname?: string
  localHostname?: string
}

export type OpenConfigResult = "opened" | "created" | "cancelled" | "remote" | "unknown"

export async function openGlobalConfig(input: OpenConfigInput, host: ConfigHost): Promise<OpenConfigResult> {
  const place = configPlace(input)
  if (place.where === "server") {
    host.info(remoteConfigNotice(place.hostname))
    return "remote"
  }
  const dir = globalConfigDir(input)
  if (!dir) {
    host.info("Could not find your home folder, so the OpenCode config location is unknown. Set OPENCODE_CONFIG_DIR or XDG_CONFIG_HOME, or open the file yourself.")
    return "unknown"
  }
  const existing: string[] = []
  for (const f of CONFIG_FILES) {
    const p = joinFor(input.platform, dir, f)
    if (await host.exists(p)) existing.push(p)
  }
  const resolved = resolveGlobalConfig({ ...input, existing })
  if (!resolved) return "unknown"
  if (resolved.exists) {
    await host.open(resolved.path)
    return "opened"
  }
  if (!(await host.confirmCreate(resolved.path))) return "cancelled"
  await host.create(resolved.path, NEW_CONFIG_TEXT)
  await host.open(resolved.path)
  return "created"
}
