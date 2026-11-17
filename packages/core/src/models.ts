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

/**
 * The variant id of an explicit "Default" pick: the model runs without a variant, and the agent's or the configured
 * variant is not inherited. OpenCode itself treats `default` as no variant. It only travels from the picker to the
 * controller; the server and the footer never see it.
 */
export const DEFAULT_VARIANT = "default"

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

/** The agent's own model from `agent.list` (`model: provider/id#variant` in the agent file), if it names one. */
export function agentModel(agent: Pick<AgentInfo, "model"> | undefined): ModelSelection | undefined {
  return normalizeModelSelection(agent?.model)
}

/**
 * The `model` the location's configuration sets (the global `opencode.json` or a project one). `config.get` lists its
 * documents from lowest to highest priority, so the last one that sets a model wins. The server answers with
 * `{ providerID, model, variant }`; a plain `provider/model` string has no variant. `model.default` does not report the
 * variant, so this is the only place it comes from.
 */
export function configuredModel(config: unknown): ModelSelection | undefined {
  const docs: unknown[] = Array.isArray(config) ? config : []
  for (let i = docs.length - 1; i >= 0; i--) {
    const doc = docs[i] as { type?: unknown; info?: { model?: unknown } } | undefined
    if (doc?.type !== undefined && doc.type !== "document") continue
    const raw = doc?.info?.model
    if (raw === undefined) continue
    if (typeof raw === "string") {
      const [providerID, ...rest] = raw.split("/")
      const id = rest.join("/")
      return providerID && id ? { id, providerID } : undefined
    }
    const o = raw as { providerID?: unknown; model?: unknown; variant?: unknown }
    return normalizeModelSelection({ id: o?.model, providerID: o?.providerID, variant: o?.variant })
  }
  return undefined
}

/**
 * The variant a model gets when nobody picked one: the agent's own variant when the agent names this very model, else
 * the configured default's variant when that is this model. Only a variant the model lists counts; `default` means none.
 * Mirrors OpenCode's web app (`getConfiguredAgentVariant` and `resolveModelVariant`).
 */
export function inheritedVariant(args: { model: { id: string; providerID: string }; models: ReadonlyArray<SlimModel>; agent?: ModelSelection; configured?: ModelSelection }): string | undefined {
  const found = findModel(args.models, args.model)
  if (!found) return undefined
  const source = [args.agent, args.configured].find((s) => !!s?.variant && sameModel(s, args.model))
  const v = source?.variant
  return v && v !== "default" && found.variants.some((x) => x.id === v) ? v : undefined
}

/**
 * A model the pickers can use: listed, enabled and not deprecated (the pickers hide the others). Before the catalog has
 * loaded nothing can be checked, so everything passes.
 */
export function usableModel(models: ReadonlyArray<SlimModel>, ref: { id: string; providerID: string } | undefined): boolean {
  if (!ref) return false
  if (models.length === 0) return true
  const found = findModel(models, ref)
  return !!found && found.enabled && found.status !== "deprecated"
}

/** A pick as the server records it: the explicit "Default" becomes no variant. */
export function withoutDefaultVariant(model: ModelSelection): ModelSelection {
  return model.variant === DEFAULT_VARIANT ? { id: model.id, providerID: model.providerID } : model
}

/**
 * The model and variant a session or draft runs with, in OpenCode's web app order: the explicit choice (the session's
 * recorded model, or the draft's pick), then the agent's model, then the configured default, then the server's default
 * model. The explicit choice is kept even when the catalog no longer lists it (the session still names it); the agent's
 * and the configured model are skipped when this server does not offer them.
 *
 * The variant: an explicit choice that names one keeps it while the model lists it, and an explicit `DEFAULT_VARIANT`
 * means none. A session's recorded model without a variant runs with none. Everything else (a draft pick that named no
 * variant, the agent's, the configured or the server's default model) inherits one through `inheritedVariant`.
 */
export function resolveModel(args: {
  explicit?: ModelSelection
  /** The explicit choice is a draft pick: without a variant of its own it inherits one, like the defaults do. */
  explicitInherits?: boolean
  agent?: ModelSelection
  configured?: ModelSelection
  fallback?: ModelSelection
  models: ReadonlyArray<SlimModel>
}): ModelSelection | undefined {
  const { explicit, models } = args
  const picked = explicit ?? [args.agent, args.configured].find((m) => usableModel(models, m)) ?? args.fallback
  if (!picked) return undefined
  const ref = (variant: string | undefined): ModelSelection => ({ id: picked.id, providerID: picked.providerID, ...(variant ? { variant } : {}) })
  if (explicit && (explicit.variant || !args.explicitInherits)) {
    const found = findModel(models, explicit)
    const v = explicit.variant
    return ref(v && v !== "default" && (!found || found.variants.some((x) => x.id === v)) ? v : undefined)
  }
  return ref(inheritedVariant({ model: picked, models, agent: args.agent, configured: args.configured }))
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

/**
 * Step to the next/previous variant of a model, wrapping through "Default" (no variant, `undefined`) between the last
 * and the first, like OpenCode's web app (`cycleModelVariant`).
 */
export function cycleVariant(model: SlimModel, current: string | undefined, step = 1): string | undefined {
  const ids = model.variants.map((v) => v.id)
  if (ids.length === 0) return undefined
  const positions: Array<string | undefined> = [undefined, ...ids]
  const i = current && ids.includes(current) ? positions.indexOf(current) : 0
  return positions[(i + step + positions.length * 2) % positions.length]
}
