import type { OpenCodeClient } from "./api"

export type CommandSummary = { name: string; description?: string }
/** Only what the popup shows. The server's skill list also carries each skill's full text, which never leaves core. */
export type SkillSummary = { id: string; name: string; description?: string }

const TTL_MS = 15_000

/**
 * The server's slash commands and skills for the project. The popup asks again every time it opens, so a short TTL
 * keeps that cheap; `command.updated` / `skill.updated` events mark the cache stale.
 */
export class CommandCatalog {
  commands: CommandSummary[] = []
  skills: SkillSummary[] = []
  private commandsAt = -Infinity
  private skillsAt = -Infinity

  constructor(private readonly now: () => number = Date.now) {}

  has(name: string): boolean {
    return this.commands.some((c) => c.name === name)
  }

  invalidateCommands() {
    this.commandsAt = -Infinity
  }

  invalidateSkills() {
    this.skillsAt = -Infinity
  }

  /** True when the list changed. A server without the endpoint keeps the list empty; the failure is not worth a message. */
  async loadCommands(client: OpenCodeClient, directory: string, log?: (line: string) => void): Promise<boolean> {
    if (this.now() - this.commandsAt < TTL_MS) return false
    this.commandsAt = this.now()
    try {
      const res = await client.command.list({ location: { directory } })
      this.commands = res.data.map((c) => ({ name: c.name, description: c.description }))
      return true
    } catch (e) {
      log?.(`command.list failed: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }

  async loadSkills(client: OpenCodeClient, directory: string, log?: (line: string) => void): Promise<boolean> {
    if (this.now() - this.skillsAt < TTL_MS) return false
    this.skillsAt = this.now()
    try {
      const res = await client.skill.list({ location: { directory } })
      this.skills = res.data.map((s) => ({ id: s.id, name: s.name, description: s.description }))
      return true
    } catch (e) {
      log?.(`skill.list failed: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }
}
