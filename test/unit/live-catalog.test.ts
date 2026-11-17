import { describe, expect, test } from "bun:test"
import { CATALOG_MS, Controller } from "@occ/core/controller"

/**
 * Editing an agent file or an `opencode.json` makes the server emit `agent.updated`, `config.updated`,
 * `provider.updated` and several `model.updated` for the folder's location. The controller reloads its agents, models,
 * providers and defaults once for such a burst, without a window reload.
 */

const model = (id: string, variants: string[] = ["low", "high"]) => ({
  id,
  modelID: id,
  providerID: "cli",
  name: id.toUpperCase(),
  enabled: true,
  status: "active",
  variants: variants.map((v) => ({ id: v })),
})
const agent = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, mode: "primary", hidden: false, ...extra })

function server() {
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const catalog = {
    agents: [agent("build")] as unknown[],
    models: [model("sonnet"), model("opus")],
    config: [] as unknown[],
  }
  const counts = { agent: 0, model: 0, provider: 0, config: 0, default: 0 }
  let gate: Promise<void> | undefined
  const client: any = {
    location: { get: unsupported },
    session: { list: async () => empty, active: async () => ({}), get: unsupported },
    command: { list: async () => empty },
    skill: { list: async () => empty },
    mcp: { list: async () => empty },
    permission: { request: { list: async () => empty } },
    form: { list: async () => empty },
    agent: {
      list: async () => {
        counts.agent++
        if (gate) await gate
        return { data: catalog.agents }
      },
    },
    model: {
      list: async () => (counts.model++, { data: catalog.models }),
      default: async () => (counts.default++, { data: { id: "sonnet", providerID: "cli" } }),
    },
    provider: { list: async () => (counts.provider++, { data: [{ id: "cli", name: "CLI" }] }) },
    config: { get: async () => (counts.config++, catalog.config) },
    shell: { list: async () => empty },
    message: { list: async () => ({ data: [], cursor: { next: null, previous: null } }) },
    event: { subscribe: async function* () {} },
  }
  return {
    client,
    catalog,
    counts,
    hold() {
      let release!: () => void
      gate = new Promise<void>((r) => (release = r))
      return () => {
        gate = undefined
        release()
      }
    },
  }
}

async function ready(directory = "/w") {
  const s = server()
  const ctl = new Controller({ directory, folderName: "w", displayPath: directory })
  ;(ctl as any).client = s.client
  await ctl.sync()
  s.counts.agent = s.counts.model = s.counts.provider = s.counts.config = s.counts.default = 0
  return { ctl, ...s }
}

const wait = (ms = CATALOG_MS + 60) => new Promise((r) => setTimeout(r, ms))
const ev = (type: string, directory?: string) => ({ type, created: 2, ...(directory ? { location: { directory } } : {}), data: {} }) as any

describe("live config reload", () => {
  test("a burst of catalog events reloads agents, models, providers and defaults once", async () => {
    const { ctl, catalog, counts } = await ready()
    catalog.agents = [agent("build"), agent("review", { model: { id: "opus", providerID: "cli", variant: "high" } })]
    for (const type of ["agent.updated", "config.updated", "provider.updated", "model.updated", "model.updated", "model.updated"]) await ctl.onEvent(ev(type, "/w"))
    expect(counts.agent).toBe(0)
    await wait()
    expect(counts).toEqual({ agent: 1, model: 1, provider: 1, config: 1, default: 1 })
    expect(ctl.snapshot().agents.map((a) => a.id)).toEqual(["build", "review"])
    expect(ctl.snapshot().agents[1]!.model).toEqual({ id: "opus", providerID: "cli", variant: "high" })
  })

  test("the new lists reach the view without any other event", async () => {
    const { ctl, catalog } = await ready()
    const seen: string[][] = []
    ctl.subscribe((s) => seen.push(s.agents.map((a) => a.id)))
    catalog.agents = [agent("build"), agent("plan")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await wait()
    expect(seen.at(-1)).toEqual(["build", "plan"])
  })

  test("every catalog event type reloads; unrelated events do not", async () => {
    for (const type of ["agent.updated", "config.updated", "model.updated", "provider.updated", "integration.updated", "credential.updated", "credential.switched", "models-dev.refreshed"]) {
      const { ctl, counts } = await ready()
      await ctl.onEvent(ev(type, "/w"))
      await wait()
      expect([type, counts.agent]).toEqual([type, 1])
    }
    const { ctl, counts } = await ready()
    await ctl.onEvent(ev("vcs.branch.updated", "/w"))
    await wait()
    expect(counts.agent).toBe(0)
  })

  test("an event without a location (a credential, the models.dev list) reloads every folder", async () => {
    const { ctl, counts } = await ready()
    await ctl.onEvent(ev("credential.switched"))
    await wait()
    expect(counts.agent).toBe(1)
  })

  test("another folder's event, a subfolder's included, does not reload this folder", async () => {
    const { ctl, counts } = await ready()
    await ctl.onEvent(ev("agent.updated", "/other"))
    await ctl.onEvent(ev("config.updated", "/w/packages/app"))
    await wait()
    expect(counts.agent).toBe(0)
  })

  test("multi-root: only the folder the event names reloads", async () => {
    const a = await ready("/a")
    const b = await ready("/b")
    const nested = await ready("/a/sub")
    for (const c of [a, b, nested]) await c.ctl.onEvent(ev("config.updated", "/a"))
    await wait()
    expect([a.counts.config, b.counts.config, nested.counts.config]).toEqual([1, 0, 0])
  })

  test("an event during a reload causes exactly one more reload after it", async () => {
    const { ctl, counts, hold } = await ready()
    const release = hold()
    await ctl.onEvent(ev("agent.updated", "/w"))
    await wait()
    expect(counts.agent).toBe(1)
    await ctl.onEvent(ev("model.updated", "/w"))
    await wait()
    await ctl.onEvent(ev("model.updated", "/w"))
    await wait()
    expect(counts.agent).toBe(1)
    release()
    await wait()
    expect(counts.agent).toBe(2)
    await wait()
    expect(counts.agent).toBe(2)
  })

  test("a failed reload keeps the previous lists", async () => {
    const lines: string[] = []
    const s = server()
    const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w", log: (l) => lines.push(l) })
    ;(ctl as any).client = s.client
    await ctl.sync()
    s.client.agent.list = async () => Promise.reject(new Error("boom"))
    await ctl.onEvent(ev("agent.updated", "/w"))
    await wait()
    expect(ctl.snapshot().agents.map((a) => a.id)).toEqual(["build"])
    expect(lines.some((l) => l.includes("Reloading agents and models failed"))).toBe(true)
  })

  test("a draft keeps its agent and model across a reload while they still exist", async () => {
    const { ctl, catalog } = await ready()
    catalog.agents = [agent("build"), agent("plan")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await wait()
    await ctl.dispatch({ type: "pickAgent", id: "plan" })
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli", variant: "low" } })
    await ctl.onEvent(ev("config.updated", "/w"))
    await wait()
    expect(ctl.snapshot().agent).toBe("plan")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "low" })
  })

  test("a draft whose agent or model is gone after a reload falls back to the defaults", async () => {
    const { ctl, catalog } = await ready()
    catalog.agents = [agent("build"), agent("plan")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await wait()
    await ctl.dispatch({ type: "pickAgent", id: "plan" })
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli" } })
    catalog.agents = [agent("build")]
    catalog.models = [model("sonnet")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await wait()
    expect(ctl.snapshot().agent).toBe("build")
    expect(ctl.snapshot().model).toEqual({ id: "sonnet", providerID: "cli" })
  })

  test("a model picked in a draft survives a reload that changes the default agent", async () => {
    const { ctl, catalog } = await ready()
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli", variant: "low" } })
    catalog.agents = [agent("build"), agent("plan")]
    catalog.config = [{ type: "document", info: { default_agent: "plan" } }]
    await ctl.onEvent(ev("config.updated", "/w"))
    await wait()
    expect(ctl.snapshot().agent).toBe("build")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "low" })
  })

  test("a changed default agent and configured model show in a fresh draft", async () => {
    const { ctl, catalog } = await ready()
    catalog.agents = [agent("build"), agent("plan")]
    catalog.config = [{ type: "document", info: { default_agent: "plan", model: { providerID: "cli", model: "opus", variant: "high" } } }]
    await ctl.onEvent(ev("config.updated", "/w"))
    await wait()
    expect(ctl.snapshot().agent).toBe("plan")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "high" })
  })

  test("detaching cancels a pending reload", async () => {
    const { ctl, counts } = await ready()
    await ctl.onEvent(ev("agent.updated", "/w"))
    ctl.detach()
    await wait()
    expect(counts.agent).toBe(0)
  })
})
