import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { ALL_PARTS, CATALOG_MS, catalogParts } from "@occ/core/catalog-reload"

/**
 * Editing an agent file or an `opencode.json` makes the server emit `agent.updated`, `config.updated`,
 * `provider.updated` and several `model.updated` for the folder's location. The controller reloads what those events
 * change, once for a burst, without a window reload. The debounce runs on a fake clock, so no test depends on timing.
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

type Counts = { agent: number; model: number; provider: number; config: number; default: number }

function server() {
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const catalog = {
    agents: [agent("build")] as unknown[],
    models: [model("sonnet"), model("opus")],
    defaultModel: { id: "sonnet", providerID: "cli" } as unknown,
    config: [] as unknown[],
  }
  const counts: Counts = { agent: 0, model: 0, provider: 0, config: 0, default: 0 }
  const fail = { default: false, config: false, agents: false }
  // The next `agent.list` answers with the list as it was when asked, but only once `release` is called.
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
        if (fail.agents) throw new Error("boom")
        const data = catalog.agents
        const held = gate
        gate = undefined
        if (held) await held
        return { data }
      },
    },
    model: {
      list: async () => (counts.model++, { data: catalog.models }),
      default: async () => {
        counts.default++
        if (fail.default) throw new Error("socket hang up")
        return { data: catalog.defaultModel }
      },
    },
    provider: { list: async () => (counts.provider++, { data: [{ id: "cli", name: "CLI" }] }) },
    config: {
      get: async () => {
        counts.config++
        if (fail.config) throw new Error("socket hang up")
        return catalog.config
      },
    },
    shell: { list: async () => empty },
    message: { list: async () => ({ data: [], cursor: { next: null, previous: null } }) },
    event: { subscribe: async function* () {} },
  }
  return {
    client,
    catalog,
    counts,
    fail,
    hold() {
      let release!: () => void
      gate = new Promise<void>((r) => (release = r))
      return release
    },
  }
}

type Ready = ReturnType<typeof server> & { ctl: Controller; lines: string[] }

async function ready(directory = "/w", opts: { syncStaggerMs?: number; config?: unknown[] } = {}): Promise<Ready> {
  const s = server()
  if (opts.config) s.catalog.config = opts.config
  const lines: string[] = []
  const ctl = new Controller({ directory, folderName: "w", displayPath: directory, syncStaggerMs: opts.syncStaggerMs, log: (l) => lines.push(l) })
  ;(ctl as any).client = s.client
  await ctl.sync()
  reset(s.counts)
  return { ctl, lines, ...s }
}

const reset = (c: Counts) => (c.agent = c.model = c.provider = c.config = c.default = 0)

/** Let pending promise callbacks run (the fake clock does not touch the microtask queue). */
async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

/** Move the fake clock past the debounce (and the 30 ms emit), then let the reload's answers arrive. */
async function elapse(ms = CATALOG_MS + 100) {
  await flush()
  jest.advanceTimersByTime(ms)
  await flush()
  jest.advanceTimersByTime(50)
  await flush()
}

const ev = (type: string, directory?: string) => ({ type, created: 2, ...(directory ? { location: { directory } } : {}), data: {} }) as any

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe("the model's context window", () => {
  test("loadCatalog keeps limit.context as contextLimit, and nothing when the model has none", async () => {
    const { ctl, catalog } = await ready()
    catalog.models = [{ ...model("big"), limit: { context: 200_000, output: 8000 } }, { ...model("none"), limit: { context: 0, output: 0 } }, model("absent")] as any
    await ctl.onEvent(ev("model.updated", "/w"))
    await elapse()
    const byID = new Map(ctl.snapshot().models.map((m) => [m.id, m]))
    expect(byID.get("big")?.contextLimit).toBe(200_000)
    expect(byID.get("none")?.contextLimit).toBeUndefined()
    expect(byID.get("absent")?.contextLimit).toBeUndefined()
  })
})

describe("which events reload which parts", () => {
  test("each event maps to what it changes, like OpenCode's web app", () => {
    expect(catalogParts("agent.updated", true)).toEqual(["agents"])
    expect(catalogParts("model.updated", true)).toEqual(["models", "defaultModel"])
    expect(catalogParts("provider.updated", true)).toEqual(["providers"])
    expect(catalogParts("config.updated", true)).toEqual(["config", "defaultModel"])
    for (const type of ["integration.updated", "credential.updated", "credential.switched", "models-dev.refreshed"]) expect(catalogParts(type, false)).toEqual(["models", "providers", "defaultModel"])
    expect(catalogParts("agent.updated", false)).toEqual(ALL_PARTS)
    expect(catalogParts("config.updated", false)).toEqual(ALL_PARTS)
    expect(catalogParts("vcs.branch.updated", true)).toBeUndefined()
  })

  test("the controller fetches only those parts", async () => {
    const cases: Array<[string, string | undefined, Partial<Counts>]> = [
      ["agent.updated", "/w", { agent: 1 }],
      ["model.updated", "/w", { model: 1, default: 1 }],
      ["provider.updated", "/w", { provider: 1 }],
      ["config.updated", "/w", { config: 1, default: 1 }],
      ["integration.updated", "/w", { model: 1, provider: 1, default: 1 }],
      ["credential.switched", undefined, { model: 1, provider: 1, default: 1 }],
      ["models-dev.refreshed", undefined, { model: 1, provider: 1, default: 1 }],
      ["config.updated", undefined, { agent: 1, model: 1, provider: 1, config: 1, default: 1 }],
      ["vcs.branch.updated", "/w", {}],
    ]
    for (const [type, dir, want] of cases) {
      const { ctl, counts } = await ready()
      await ctl.onEvent(ev(type, dir))
      await elapse()
      expect([type, counts]).toEqual([type, { agent: 0, model: 0, provider: 0, config: 0, default: 0, ...want }])
    }
  })
})

describe("live config reload", () => {
  test("a burst of catalog events causes one reload of the parts they name", async () => {
    const { ctl, catalog, counts } = await ready()
    catalog.agents = [agent("build"), agent("review", { model: { id: "opus", providerID: "cli", variant: "high" } })]
    for (const type of ["agent.updated", "config.updated", "provider.updated", "model.updated", "model.updated", "model.updated"]) await ctl.onEvent(ev(type, "/w"))
    await flush()
    jest.advanceTimersByTime(CATALOG_MS - 1)
    await flush()
    expect(counts.agent).toBe(0)
    await elapse()
    expect(counts).toEqual({ agent: 1, model: 1, provider: 1, config: 1, default: 1 })
    expect(ctl.snapshot().agents.map((a) => a.id)).toEqual(["build", "review"])
    expect(ctl.snapshot().agents[1]!.model).toEqual({ id: "opus", providerID: "cli", variant: "high" })
  })

  test("the new lists reach the view; a reload that changes nothing sends nothing", async () => {
    const { ctl, catalog } = await ready()
    const seen: string[][] = []
    ctl.subscribe((s) => seen.push(s.agents.map((a) => a.id)))
    catalog.agents = [agent("build"), agent("plan")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    expect(seen.at(-1)).toEqual(["build", "plan"])
    const before = seen.length
    const agents = ctl.snapshot().agents
    await ctl.onEvent(ev("model.updated", "/w"))
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    expect(seen.length).toBe(before)
    // An unchanged list keeps its reference, so the webview diff has nothing to post either.
    expect(ctl.snapshot().agents).toBe(agents)
  })

  test("an event without a location (a credential, the models.dev list) reloads every folder", async () => {
    const a = await ready("/a")
    const b = await ready("/b")
    for (const c of [a, b]) await c.ctl.onEvent(ev("credential.switched"))
    await elapse()
    expect([a.counts.model, b.counts.model]).toEqual([1, 1])
  })

  test("a folder in the background waits its stagger before a location-less reload; a located one does not", async () => {
    const { ctl, counts } = await ready("/w", { syncStaggerMs: 1000 })
    ctl.setActive(false)
    await ctl.onEvent(ev("models-dev.refreshed"))
    await elapse()
    expect(counts.model).toBe(0)
    await elapse(1000)
    expect(counts.model).toBe(1)
    await ctl.onEvent(ev("model.updated", "/w"))
    await elapse()
    expect(counts.model).toBe(2)
  })

  test("another folder's event, a subfolder's included, does not reload this folder", async () => {
    const { ctl, counts } = await ready()
    await ctl.onEvent(ev("agent.updated", "/other"))
    await ctl.onEvent(ev("config.updated", "/w/packages/app"))
    await elapse()
    expect(counts).toEqual({ agent: 0, model: 0, provider: 0, config: 0, default: 0 })
  })

  test("the same folder spelled differently still reloads", async () => {
    const slash = await ready("/w")
    await slash.ctl.onEvent(ev("agent.updated", "/w/"))
    const win = await ready("d:\\Work\\app")
    await win.ctl.onEvent(ev("agent.updated", "D:/Work/app"))
    await elapse()
    expect([slash.counts.agent, win.counts.agent]).toEqual([1, 1])
  })

  test("multi-root: only the folder the event names reloads", async () => {
    const a = await ready("/a")
    const b = await ready("/b")
    const nested = await ready("/a/sub")
    for (const c of [a, b, nested]) await c.ctl.onEvent(ev("config.updated", "/a"))
    await elapse()
    expect([a.counts.config, b.counts.config, nested.counts.config]).toEqual([1, 0, 0])
  })

  test("an event during a reload causes exactly one more reload after it", async () => {
    const { ctl, counts, hold } = await ready()
    const release = hold()
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    expect(counts.agent).toBe(1)
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    expect(counts.agent).toBe(1)
    release()
    await elapse()
    expect(counts.agent).toBe(2)
    await elapse()
    expect(counts.agent).toBe(2)
  })

  test("a failed reload keeps the previous lists", async () => {
    const { ctl, fail, lines } = await ready()
    fail.agents = true
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    expect(ctl.snapshot().agents.map((a) => a.id)).toEqual(["build"])
    expect(lines.some((l) => l.includes("Reloading agents and models failed"))).toBe(true)
  })

  test("a failed model.default or config.get keeps the previous defaults", async () => {
    const config = [{ type: "document", info: { default_agent: "plan", model: { providerID: "cli", model: "opus", variant: "high" } } }]
    const { ctl, catalog, fail, counts } = await ready("/w", { config })
    catalog.agents = [agent("build"), agent("plan")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    expect(ctl.snapshot().agent).toBe("plan")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "high" })
    fail.default = fail.config = true
    reset(counts)
    await ctl.onEvent(ev("config.updated"))
    await elapse()
    expect(counts.config).toBe(1)
    expect(ctl.snapshot().agent).toBe("plan")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "high" })
    expect((ctl as any).defaultModel).toEqual({ id: "sonnet", providerID: "cli" })
  })

  test("a draft keeps its agent and model across a reload while they still exist", async () => {
    const { ctl, catalog } = await ready()
    catalog.agents = [agent("build"), agent("plan")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    await ctl.dispatch({ type: "pickAgent", id: "plan" })
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli", variant: "low" } })
    await ctl.onEvent(ev("config.updated"))
    await elapse()
    expect(ctl.snapshot().agent).toBe("plan")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "low" })
  })

  test("a draft whose agent or model is gone after a reload falls back to the defaults", async () => {
    const { ctl, catalog } = await ready()
    catalog.agents = [agent("build"), agent("plan")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    await ctl.dispatch({ type: "pickAgent", id: "plan" })
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli" } })
    catalog.agents = [agent("build")]
    catalog.models = [model("sonnet")]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await ctl.onEvent(ev("model.updated", "/w"))
    await elapse()
    expect(ctl.snapshot().agent).toBe("build")
    expect(ctl.snapshot().model).toEqual({ id: "sonnet", providerID: "cli" })
  })

  test("a model picked in a draft survives a reload that changes the default agent", async () => {
    const { ctl, catalog } = await ready()
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli", variant: "low" } })
    catalog.agents = [agent("build"), agent("plan")]
    catalog.config = [{ type: "document", info: { default_agent: "plan" } }]
    await ctl.onEvent(ev("config.updated"))
    await elapse()
    expect(ctl.snapshot().agent).toBe("build")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "low" })
  })

  test("a changed default agent and configured model show in a fresh draft", async () => {
    const { ctl, catalog } = await ready()
    catalog.agents = [agent("build"), agent("plan")]
    catalog.config = [{ type: "document", info: { default_agent: "plan", model: { providerID: "cli", model: "opus", variant: "high" } } }]
    await ctl.onEvent(ev("agent.updated", "/w"))
    await ctl.onEvent(ev("config.updated", "/w"))
    await elapse()
    expect(ctl.snapshot().agent).toBe("plan")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "high" })
  })
})

describe("stale reloads", () => {
  test("server.connected cancels a pending reload: its full sync already loads everything", async () => {
    const { ctl, counts } = await ready()
    await ctl.onEvent(ev("agent.updated", "/w"))
    await ctl.onEvent({ type: "server.connected" } as any)
    await flush()
    expect(counts.agent).toBe(1)
    await elapse()
    expect(counts.agent).toBe(1)
  })

  test("a sync supersedes a reload in flight: the older answer is not written", async () => {
    const { ctl, catalog, hold } = await ready()
    catalog.agents = [agent("build"), agent("old")]
    const release = hold()
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    catalog.agents = [agent("build"), agent("new")]
    await ctl.sync()
    expect(ctl.snapshot().agents.map((a) => a.id)).toEqual(["build", "new"])
    release()
    await elapse()
    expect(ctl.snapshot().agents.map((a) => a.id)).toEqual(["build", "new"])
  })

  test("detaching cancels a pending reload and drops one in flight", async () => {
    const pending = await ready()
    await pending.ctl.onEvent(ev("agent.updated", "/w"))
    pending.ctl.detach()
    await elapse()
    expect(pending.counts.agent).toBe(0)

    const flying = await ready()
    flying.catalog.agents = [agent("build"), agent("late")]
    const release = flying.hold()
    await flying.ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    flying.ctl.detach()
    release()
    await elapse()
    expect(flying.ctl.snapshot().agents.map((a) => a.id)).toEqual(["build"])
  })

  test("an answer for an old client is not written after a new one attached", async () => {
    const { ctl, catalog, hold } = await ready()
    catalog.agents = [agent("build"), agent("late")]
    const release = hold()
    await ctl.onEvent(ev("agent.updated", "/w"))
    await elapse()
    ;(ctl as any).client = server().client
    release()
    await elapse()
    expect(ctl.snapshot().agents.map((a) => a.id)).toEqual(["build"])
  })
})
