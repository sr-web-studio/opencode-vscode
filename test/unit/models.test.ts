import { describe, expect, test } from "bun:test"
import { agentModel, configuredModel, cycleAgent, cycleVariant, footerLabel, groupModels, inheritedVariant, primaryAgents, resolveModel, usableModel } from "@occ/core/models"
import type { SlimModel } from "@occ/core/api"

const m = (id: string, providerID: string, name: string, extra: Partial<SlimModel> = {}): SlimModel => ({
  id,
  modelID: id,
  providerID,
  name,
  enabled: true,
  variants: [{ id: "low" }, { id: "high" }],
  ...extra,
})
const providers = [
  { id: "anthropic", name: "Anthropic" },
  { id: "cli", name: "CLI Proxy API" },
]

describe("agents", () => {
  test("primary and visible only", () => {
    const list = primaryAgents([
      { id: "build", name: "build", mode: "primary", hidden: false },
      { id: "general", name: "general", mode: "subagent", hidden: false },
      { id: "title", name: "title", mode: "primary", hidden: true },
      { id: "x", name: "x", mode: "all", hidden: false },
    ])
    expect(list.map((a) => a.id)).toEqual(["build", "x"])
  })
  test("tab cycling wraps both ways", () => {
    expect(cycleAgent(["a", "b", "c"], "c")).toBe("a")
    expect(cycleAgent(["a", "b", "c"], "a", -1)).toBe("c")
    expect(cycleAgent(["a", "b"], undefined)).toBe("a")
    expect(cycleAgent([], "a")).toBeUndefined()
  })
})

describe("model groups", () => {
  const models = [
    m("s", "anthropic", "Sonnet"),
    m("o", "anthropic", "Opus"),
    m("d", "cli", "DeepSeek"),
    m("off", "cli", "Disabled", { enabled: false }),
    m("old", "cli", "Old", { status: "deprecated" }),
  ]

  test("grouped by provider name, sorted, disabled/deprecated hidden", () => {
    const g = groupModels({ models, providers, query: "" })
    expect(g.map((x) => x.providerName)).toEqual(["Anthropic", "CLI Proxy API"])
    expect(g[0]!.models.map((x) => x.name)).toEqual(["Opus", "Sonnet"])
    expect(g[1]!.models.map((x) => x.name)).toEqual(["DeepSeek"])
  })
  test("search matches name, id and provider", () => {
    expect(groupModels({ models, providers, query: "son" })[0]!.models.map((x) => x.name)).toEqual(["Sonnet"])
    expect(groupModels({ models, providers, query: "proxy" }).map((g) => g.providerID)).toEqual(["cli"])
    expect(groupModels({ models, providers, query: "zzz" })).toEqual([])
  })
  test("footer label and variant cycling", () => {
    expect(footerLabel({ agent: "build", model: { id: "s", providerID: "anthropic", variant: "high" }, models })).toEqual({ agent: "build", model: "Sonnet", variant: "High" })
    expect(footerLabel({ model: { id: "s", providerID: "anthropic", variant: "xhigh" }, models }).variant).toBe("X-High")
    expect(footerLabel({ models: [] }).model).toBe("model")
    expect(cycleVariant(models[0]!, "low")).toBe("high")
    expect(cycleVariant(models[0]!, "high")).toBe("low")
  })
})

describe("agent and configured models", () => {
  test("an agent's model keeps its variant; none when the agent names no model", () => {
    expect(agentModel({ model: { id: "opus", providerID: "cli", variant: "high" } as never })).toEqual({ id: "opus", providerID: "cli", variant: "high" })
    expect(agentModel({ model: { id: "opus", providerID: "cli" } as never })).toEqual({ id: "opus", providerID: "cli" })
    expect(agentModel({})).toBeUndefined()
    expect(agentModel(undefined)).toBeUndefined()
  })

  test("the configured model is read from the last config document that sets one, with its variant", () => {
    const global = { type: "document", info: { model: { providerID: "cli", model: "sonnet", variant: "low" } } }
    const project = { type: "document", info: { model: "anthropic/claude/opus" } }
    expect(configuredModel([global, { type: "directory", info: {} }, { type: "document", info: {} }])).toEqual({ id: "sonnet", providerID: "cli", variant: "low" })
    expect(configuredModel([global, project])).toEqual({ id: "claude/opus", providerID: "anthropic" })
    expect(configuredModel([{ type: "directory", info: { model: "x/y" } }])).toBeUndefined()
    expect(configuredModel(undefined)).toBeUndefined()
    expect(configuredModel([{ type: "document", info: { model: "nonsense" } }])).toBeUndefined()
  })
})

describe("model resolution", () => {
  const models = [m("opus", "cli", "Opus"), m("sonnet", "cli", "Sonnet"), m("plain", "cli", "Plain", { variants: [] }), m("off", "cli", "Off", { enabled: false })]
  const opusHigh = { id: "opus", providerID: "cli", variant: "high" }
  const sonnetLow = { id: "sonnet", providerID: "cli", variant: "low" }
  const serverDefault = { id: "sonnet", providerID: "cli" }

  test("the inherited variant needs the same model and a variant that model lists", () => {
    expect(inheritedVariant({ model: { id: "opus", providerID: "cli" }, models, agent: opusHigh })).toBe("high")
    expect(inheritedVariant({ model: { id: "sonnet", providerID: "cli" }, models, agent: opusHigh })).toBeUndefined()
    expect(inheritedVariant({ model: { id: "sonnet", providerID: "cli" }, models, agent: opusHigh, configured: sonnetLow })).toBe("low")
    expect(inheritedVariant({ model: { id: "opus", providerID: "cli" }, models, agent: { ...opusHigh, variant: "turbo" } })).toBeUndefined()
    expect(inheritedVariant({ model: { id: "opus", providerID: "cli" }, models, agent: { ...opusHigh, variant: "default" } })).toBeUndefined()
    expect(inheritedVariant({ model: { id: "gone", providerID: "cli" }, models, agent: { id: "gone", providerID: "cli", variant: "high" } })).toBeUndefined()
  })

  test("explicit choice, then the agent's model, then the configured one, then the server default", () => {
    expect(resolveModel({ explicit: { id: "plain", providerID: "cli" }, agent: opusHigh, configured: sonnetLow, fallback: serverDefault, models })).toEqual({ id: "plain", providerID: "cli" })
    expect(resolveModel({ agent: opusHigh, configured: sonnetLow, fallback: serverDefault, models })).toEqual(opusHigh)
    expect(resolveModel({ configured: sonnetLow, fallback: serverDefault, models })).toEqual(sonnetLow)
    expect(resolveModel({ fallback: serverDefault, models })).toEqual(serverDefault)
    expect(resolveModel({ models })).toBeUndefined()
  })

  test("an agent or configured model the server does not offer is skipped", () => {
    expect(resolveModel({ agent: { id: "gone", providerID: "cli", variant: "high" }, configured: sonnetLow, models })).toEqual(sonnetLow)
    expect(resolveModel({ agent: { id: "off", providerID: "cli" }, fallback: serverDefault, models })).toEqual(serverDefault)
  })

  test("the server default inherits the configured variant (model.default reports none)", () => {
    expect(resolveModel({ configured: { id: "gone", providerID: "x", variant: "low" }, fallback: serverDefault, models })).toEqual(serverDefault)
    expect(resolveModel({ agent: { id: "gone", providerID: "x" }, configured: sonnetLow, fallback: serverDefault, models })).toEqual(sonnetLow)
  })

  test("a session's recorded model runs with its own variant or none; a draft pick without one inherits", () => {
    const opus = { id: "opus", providerID: "cli" }
    expect(resolveModel({ explicit: opus, agent: opusHigh, models })).toEqual(opus)
    expect(resolveModel({ explicit: opus, explicitInherits: true, agent: opusHigh, models })).toEqual(opusHigh)
    expect(resolveModel({ explicit: { ...opus, variant: "low" }, explicitInherits: true, agent: opusHigh, models })).toEqual({ ...opus, variant: "low" })
    expect(resolveModel({ explicit: { ...opus, variant: "turbo" }, models })).toEqual(opus)
  })

  test("a session's recorded model is kept even when the catalog no longer lists it", () => {
    expect(resolveModel({ explicit: { id: "gone", providerID: "cli", variant: "high" }, agent: opusHigh, models })).toEqual({ id: "gone", providerID: "cli", variant: "high" })
  })

  test("usable models: enabled and listed, anything before the catalog loads", () => {
    expect(usableModel(models, { id: "opus", providerID: "cli" })).toBe(true)
    expect(usableModel(models, { id: "off", providerID: "cli" })).toBe(false)
    expect(usableModel(models, { id: "gone", providerID: "cli" })).toBe(false)
    expect(usableModel([], { id: "gone", providerID: "cli" })).toBe(true)
    expect(usableModel(models, undefined)).toBe(false)
  })
})
