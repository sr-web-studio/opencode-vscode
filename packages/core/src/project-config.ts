import { configPlace, joinFor, remoteConfigNotice, DEFAULT_CONFIG_FILE, NEW_CONFIG_TEXT, type ConfigHost, type OpenConfigResult } from "./global-config"

/**
 * "Open Project Config": find the active workspace folder's OpenCode config so the user can edit it themselves.
 * This extension only ever OPENS that file (or, after an explicit question, creates it empty). It never edits it.
 *
 * Where OpenCode 2.2.5 reads project config (checked in the installed binary and in
 * https://opencode.ai/v2/docs/config, "Locations"):
 * - `opencode.json` and then `opencode.jsonc` in the project directory; a document loaded later overrides an earlier
 *   one, so `opencode.jsonc` wins when both exist (the same pair and order as the global config);
 * - then `.opencode/opencode.json` and `.opencode/opencode.jsonc` in the same directory. Every discovered `.opencode`
 *   config overrides every direct one.
 * OpenCode also merges configs from ancestor directories up to the filesystem root. This command opens the active
 * folder's own file only, which is what the Settings page's "project config" means.
 */

export type ResolvedProjectConfig = { root: string; path: string; exists: boolean; candidates: string[] }

/** In OpenCode's load order: the last one that exists has the highest precedence. */
export function projectConfigCandidates(platform: string, root: string): string[] {
  return [
    joinFor(platform, root, "opencode.json"),
    joinFor(platform, root, "opencode.jsonc"),
    joinFor(platform, root, ".opencode", "opencode.json"),
    joinFor(platform, root, ".opencode", "opencode.jsonc"),
  ]
}

/**
 * The file to open. `existing` are the full paths (of the candidates) that exist. The highest-precedence existing
 * file wins; with none, the path OpenCode would read in the folder (`opencode.jsonc`) and `exists: false`.
 */
export function resolveProjectConfig(input: { root: string; platform: string; existing: readonly string[] }): ResolvedProjectConfig | undefined {
  if (!input.root) return undefined
  const candidates = projectConfigCandidates(input.platform, input.root)
  const found = candidates.filter((c) => input.existing.includes(c))
  const path = found.at(-1)
  return path ? { root: input.root, path, exists: true, candidates } : { root: input.root, path: joinFor(input.platform, input.root, DEFAULT_CONFIG_FILE), exists: false, candidates }
}

export type ProjectConfigResult = OpenConfigResult | "no-folder"

export type OpenProjectConfigInput = {
  /** The active workspace folder; `""` when the window has none. */
  root: string
  platform: string
  serverUrl: string
  serverHostname?: string
  localHostname?: string
}

/**
 * The command: open the active folder's project config. A remote server keeps its config on its own computer, so the
 * same notice as the global command is shown there. With no folder there is nothing to resolve.
 */
export async function openProjectConfig(input: OpenProjectConfigInput, host: ConfigHost): Promise<ProjectConfigResult> {
  if (!input.root) {
    host.info("Open a folder first.")
    return "no-folder"
  }
  const place = configPlace(input)
  if (place.where === "server") {
    host.info(remoteConfigNotice(place.hostname))
    return "remote"
  }
  const existing: string[] = []
  for (const candidate of projectConfigCandidates(input.platform, input.root)) {
    if (await host.exists(candidate)) existing.push(candidate)
  }
  const resolved = resolveProjectConfig({ root: input.root, platform: input.platform, existing })
  if (!resolved) return "no-folder"
  if (resolved.exists) {
    await host.open(resolved.path)
    return "opened"
  }
  if (!(await host.confirmCreate(resolved.path))) return "cancelled"
  await host.create(resolved.path, NEW_CONFIG_TEXT)
  await host.open(resolved.path)
  return "created"
}
