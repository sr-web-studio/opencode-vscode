import { describe, expect, test } from "bun:test"
import { cycleAgent, cycleVariant, footerLabel, groupModels, primaryAgents } from "../../src/core/models"
import type { SlimModel } from "../../src/core/api"

const m = (id: string, providerID: string, name: string, extra: Partial<SlimModel> = {}): SlimModel => ({
  id, modelID: id, providerID, name, enabled: true, variants: [{ id: "low" }, { id: "high" }], ...extra,
})
const providers = [{ id: "anthropic", name: "Anthropic" }, { id: "cli", name: "CLI Proxy API" }]

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
  const models = [m("s", "anthropic", "Sonnet"), m("o", "anthropic", "Opus"), m("d", "cli", "DeepSeek"), m("off", "cli", "Disabled", { enabled: false }), m("old", "cli", "Old", { status: "deprecated" })]

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
    expect(footerLabel({ agent: "build", model: { id: "s", providerID: "anthropic", variant: "high" }, models })).toEqual({ agent: "build", model: "Sonnet", variant: "high" })
    expect(footerLabel({ models: [] }).model).toBe("model")
    expect(cycleVariant(models[0]!, "low")).toBe("high")
    expect(cycleVariant(models[0]!, "high")).toBe("low")
  })
})
