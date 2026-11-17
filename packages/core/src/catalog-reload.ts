/**
 * Reloading the agent and model catalog after OpenCode reports a change, without a window reload. Only the part an
 * event changes is fetched again, like OpenCode's web app does per location, and a burst of events causes one reload.
 */

/** A piece of the catalog that is fetched on its own. */
export type CatalogPart = "agents" | "models" | "providers" | "defaultModel" | "config"

export const ALL_PARTS: readonly CatalogPart[] = ["agents", "models", "providers", "defaultModel", "config"]

/** How long a burst of catalog events is collected before one reload. */
export const CATALOG_MS = 200

const MODELS: readonly CatalogPart[] = ["models", "providers", "defaultModel"]

/**
 * What an event makes stale, or undefined when it does not touch the catalog. The default model follows the model list
 * and the configured `model`; the default agent is worked out from the config and the agent list once either arrives.
 * A `config.updated` or `agent.updated` without a location refetches everything, as the web app's bootstrap does.
 */
export function catalogParts(type: string, located: boolean): readonly CatalogPart[] | undefined {
  switch (type) {
    case "agent.updated":
      return located ? ["agents"] : ALL_PARTS
    case "config.updated":
      return located ? ["config", "defaultModel"] : ALL_PARTS
    case "model.updated":
      return ["models", "defaultModel"]
    case "provider.updated":
      return ["providers"]
    case "integration.updated":
    case "credential.updated":
    case "credential.switched":
    case "models-dev.refreshed":
      return MODELS
    default:
      return undefined
  }
}

/**
 * Collects the parts events ask for and runs one reload once they stop arriving. One reload runs at a time; parts asked
 * for meanwhile wait for the next one. `cancel` (a full sync, a detach) drops what is waiting and bumps `epoch`, so a
 * reload still in flight can tell that its answer is stale and must not be written.
 */
export class CatalogReload {
  epoch = 0
  private timer?: ReturnType<typeof setTimeout>
  private pending = new Set<CatalogPart>()
  private running = false

  constructor(private readonly run: (parts: ReadonlySet<CatalogPart>, epoch: number) => Promise<void>) {}

  /** Ask for `parts`, after `extraMs` more than the usual pause (a folder in the background waits its turn). */
  request(parts: readonly CatalogPart[], extraMs = 0): void {
    for (const p of parts) this.pending.add(p)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.fire()
    }, CATALOG_MS + extraMs)
  }

  cancel(): void {
    this.epoch++
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pending.clear()
  }

  private async fire(): Promise<void> {
    if (this.running || this.pending.size === 0) return
    const parts = this.pending
    this.pending = new Set()
    this.running = true
    try {
      await this.run(parts, this.epoch)
    } finally {
      this.running = false
      if (this.pending.size > 0 && !this.timer) this.request([])
    }
  }
}
