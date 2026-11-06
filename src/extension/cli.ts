import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"

const exeNames = () => (process.platform === "win32" ? ["opencode.exe", "opencode.cmd", "opencode"] : ["opencode"])

function isExecutable(file: string): boolean {
  try {
    accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Where is the `opencode` binary? The `opencode.cliPath` setting wins, then PATH, then the installer's
 * default `~/.opencode/bin`. Returns undefined when none exists (the view then shows the setup state).
 */
export function resolveCli(setting: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = setting?.trim()
  if (configured) return isExecutable(configured) ? configured : undefined
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of exeNames()) {
      const file = join(dir, name)
      if (isExecutable(file)) return file
    }
  }
  for (const name of exeNames()) {
    const file = join(homedir(), ".opencode", "bin", name)
    if (isExecutable(file)) return file
  }
  return undefined
}
