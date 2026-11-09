import { variantName } from "./names"
import type { AgentInfo, SlimModel } from "./api"

export type ModelGroup = { providerID: string; providerName: string; models: SlimModel[] }

/** Primary, visible agents only (what the footer picker offers). `all` agents can also run as primary. */
export function primaryAgents(agents: ReadonlyArray<Pick<AgentInfo, "id" | "name" | "description" | "mode" | "hidden">>) {
  return agents.filter((a) => !a.hidden && (a.mode === "primary" || a.mode === "all"))
}

/** Next agent for Tab cycling, wrapping around. */
export function cycleAgent(ids: ReadonlyArray<string>, current: string | undefined, step = 1): string | undefined {
  if (ids.length === 0) return undefined
  const i = current ? ids.indexOf(current) : -1
  return ids[(i + step + ids.length * 2) % ids.length]
}

export type ModelQueryInput = {
  models: ReadonlyArray<SlimModel>
  providers: ReadonlyArray<{ id: string; name: string }>
  query: string
}

/** Enabled models grouped by provider, filtered by name/id/provider, providers and models alphabetical. */
export function groupModels({ models, providers, query }: ModelQueryInput): ModelGroup[] {
  const q = query.trim().toLowerCase()
  const names = new Map(providers.map((p) => [p.id, p.name]))
  const groups = new Map<string, ModelGroup>()
  for (const m of models) {
    if (!m.enabled || m.status === "deprecated") continue
    const providerName = names.get(m.providerID) ?? m.providerID
    if (q && !`${m.name} ${m.modelID} ${providerName}`.toLowerCase().includes(q)) continue
    const g = groups.get(m.providerID) ?? { providerID: m.providerID, providerName, models: [] }
    g.models.push(m)
    groups.set(m.providerID, g)
  }
  return [...groups.values()].map((g) => ({ ...g, models: g.models.sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.providerName.localeCompare(b.providerName))
}

/** Pinned models that still exist and are usable, in pin order (stale pins are skipped, not removed). */
export function pinnedModels(models: ReadonlyArray<SlimModel>, pins: ReadonlyArray<string>): SlimModel[] {
  const byKey = new Map(models.filter((m) => m.enabled && m.status !== "deprecated").map((m) => [`${m.providerID}/${m.id}`, m]))
  return pins.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []))
}

export type ModelSection = { id: string; title: string; pinned: boolean; models: SlimModel[] }

/** The picker's sections: "Pinned" first (when there are matches), then one group per provider. Pinned models appear in both. */
export function modelSections(input: ModelQueryInput & { pins: ReadonlyArray<string> }): ModelSection[] {
  const groups = groupModels(input)
  const matching = new Set(groups.flatMap((g) => g.models.map((m) => `${m.providerID}/${m.id}`)))
  const pinned = pinnedModels(input.models, input.pins).filter((m) => matching.has(`${m.providerID}/${m.id}`))
  const out: ModelSection[] = pinned.length ? [{ id: "pinned", title: "Pinned", pinned: true, models: pinned }] : []
  for (const g of groups) out.push({ id: g.providerID, title: g.providerName, pinned: false, models: g.models })
  return out
}

export type ModelSelection = { id: string; providerID: string; variant?: string }

/** A stored selection (host storage may be stale or hand-edited), or nothing when it is not a model reference. */
export function normalizeModelSelection(raw: unknown): ModelSelection | undefined {
  const o = raw as { id?: unknown; providerID?: unknown; variant?: unknown } | null | undefined
  if (!o || typeof o.id !== "string" || !o.id || typeof o.providerID !== "string" || !o.providerID) return undefined
  return { id: o.id, providerID: o.providerID, ...(typeof o.variant === "string" && o.variant ? { variant: o.variant } : {}) }
}

export const sameModel = (a: ModelSelection | undefined, b: { id: string; providerID: string }) => !!a && a.id === b.id && a.providerID === b.providerID

export function findModel(models: ReadonlyArray<SlimModel>, ref: { id: string; providerID: string } | undefined) {
  return ref ? models.find((m) => m.id === ref.id && m.providerID === ref.providerID) : undefined
}

/** `Sonnet 5.5 · high`-style label parts for the footer. */
export function footerLabel(args: { agent?: string; model?: ModelSelection; models: ReadonlyArray<SlimModel> }): { agent: string; model: string; variant?: string } {
  const found = findModel(args.models, args.model)
  return {
    agent: args.agent ?? "agent",
    model: found?.name ?? args.model?.id ?? "model",
    variant: args.model?.variant ? variantName(args.model.variant) : undefined,
  }
}

/** Step to the next/previous variant of a model, wrapping. */
export function cycleVariant(model: SlimModel, current: string | undefined, step = 1): string | undefined {
  const ids = model.variants.map((v) => v.id)
  if (ids.length === 0) return undefined
  const i = current ? ids.indexOf(current) : -1
  return ids[(i + step + ids.length * 2) % ids.length]
}
