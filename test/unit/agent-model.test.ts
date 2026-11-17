import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"

/**
 * An agent file with `model: provider/model#variant` makes that agent run with its own model and variant, like in
 * OpenCode's web app: the footer shows it, a new session is created with it, and switching an open session to the
 * agent switches the model too.
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
const session = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory: "/w" }, ...extra })

const OPUS_HIGH = { id: "opus", providerID: "cli", variant: "high" }
const SONNET = { id: "sonnet", providerID: "cli" }

function server(opts: { sessions?: unknown[]; config?: unknown[]; agents?: unknown[] } = {}) {
  const calls: Array<[string, any]> = []
  const rec = (name: string, result?: unknown) => async (input?: any) => (calls.push([name, input]), result)
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async () => ({ data: opts.sessions ?? [] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID),
      create: rec("session.create", session("ses_new")),
      prompt: rec("session.prompt"),
      switchAgent: rec("session.switchAgent"),
      switchModel: rec("session.switchModel"),
      view: async () => undefined,
    },
    command: { list: async () => empty },
    skill: { list: async () => empty },
    mcp: { list: async () => empty },
    permission: { request: { list: async () => empty } },
    form: { list: async () => empty },
    agent: {
      list: async () => ({
        data: [
          agent("build"),
          agent("review", { model: OPUS_HIGH }),
          agent("plain", { model: { id: "plain", providerID: "cli" } }),
          agent("worker", { mode: "subagent", model: { id: "opus", providerID: "cli", variant: "low" } }),
          ...(opts.agents ?? []),
        ],
      }),
    },
    model: { list: async () => ({ data: [model("sonnet"), model("opus"), model("plain", [])] }), default: async () => ({ data: SONNET }) },
    provider: { list: async () => ({ data: [{ id: "cli", name: "CLI" }] }) },
    config: { get: async () => opts.config ?? [] },
    shell: { list: async () => empty },
    message: { list: async () => ({ data: [], cursor: { next: null, previous: null } }) },
    event: { subscribe: async function* () {} },
  }
  return { client, calls }
}

async function ready(opts: Parameters<typeof server>[0] = {}, target: "draft" | string = "draft") {
  const s = server(opts)
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
  ;(ctl as any).client = s.client
  await ctl.sync()
  if (target === "draft") await ctl.dispatch({ type: "newDraft", hasText: false })
  else await ctl.open(target)
  s.calls.length = 0
  return { ctl, ...s }
}

describe("agent models", () => {
  test("the agent list carries each primary agent's model and variant", async () => {
    const { ctl } = await ready()
    const agents = ctl.snapshot().agents
    expect(agents.map((a) => a.id)).toEqual(["build", "review", "plain"])
    expect(agents.find((a) => a.id === "review")?.model).toEqual(OPUS_HIGH)
    expect(agents.find((a) => a.id === "build")?.model).toBeUndefined()
  })

  test("draft: picking an agent shows its model and variant; one without a model shows the default", async () => {
    const { ctl } = await ready()
    expect(ctl.snapshot().model).toEqual(SONNET)
    await ctl.dispatch({ type: "pickAgent", id: "review" })
    expect(ctl.snapshot().model).toEqual(OPUS_HIGH)
    await ctl.dispatch({ type: "pickAgent", id: "build" })
    expect(ctl.snapshot().model).toEqual(SONNET)
  })

  test("draft: a model picked for one agent does not stick to the next, and comes back with its agent", async () => {
    const { ctl } = await ready()
    await ctl.dispatch({ type: "pickModel", model: { id: "plain", providerID: "cli" } })
    expect(ctl.snapshot().model).toEqual({ id: "plain", providerID: "cli" })
    await ctl.dispatch({ type: "pickAgent", id: "review" })
    expect(ctl.snapshot().model).toEqual(OPUS_HIGH)
    await ctl.dispatch({ type: "pickAgent", id: "build" })
    expect(ctl.snapshot().model).toEqual({ id: "plain", providerID: "cli" })
  })

  test("draft: picking the agent's model without a variant inherits the agent's variant; an explicit one wins", async () => {
    const { ctl } = await ready()
    await ctl.dispatch({ type: "pickAgent", id: "review" })
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli" } })
    expect(ctl.snapshot().model).toEqual(OPUS_HIGH)
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli", variant: "low" } })
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli", variant: "low" })
  })

  test("a new session is created with the agent and its model, variant included", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "pickAgent", id: "review" })
    await ctl.dispatch({ type: "send", text: "hi" })
    expect(calls[0]).toEqual(["session.create", { location: { directory: "/w" }, agent: "review", model: OPUS_HIGH }])
  })

  test("a new session with the default agent gets the default model", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "send", text: "hi" })
    expect(calls[0]).toEqual(["session.create", { location: { directory: "/w" }, agent: "build", model: SONNET }])
  })

  test("the configured model's variant applies to the default model (model.default reports none)", async () => {
    const config = [{ type: "document", info: { model: { providerID: "cli", model: "sonnet", variant: "low" } } }]
    const { ctl, calls } = await ready({ config })
    expect(ctl.snapshot().model).toEqual({ id: "sonnet", providerID: "cli", variant: "low" })
    await ctl.dispatch({ type: "send", text: "hi" })
    expect(calls[0]![1].model).toEqual({ id: "sonnet", providerID: "cli", variant: "low" })
  })

  test("the folder's default_agent wins over the global one (config documents come lowest priority first)", async () => {
    const config = [
      { type: "document", info: { default_agent: "review" } },
      { type: "document", info: { default_agent: "plain" } },
      { type: "document", info: {} },
      { type: "directory", info: { default_agent: "build" } },
    ]
    const { ctl, calls } = await ready({ config })
    expect(ctl.snapshot().agent).toBe("plain")
    await ctl.dispatch({ type: "send", text: "hi" })
    expect(calls[0]![1].agent).toBe("plain")
  })

  test("a session without a model shows its agent's model and variant", async () => {
    const { ctl } = await ready({ sessions: [session("ses_a", { agent: "review" })] }, "ses_a")
    expect(ctl.snapshot().agent).toBe("review")
    expect(ctl.snapshot().model).toEqual(OPUS_HIGH)
  })

  test("a session's own model wins over its agent's, without inheriting the agent's variant", async () => {
    const { ctl } = await ready({ sessions: [session("ses_a", { agent: "review", model: { id: "opus", providerID: "cli" } })] }, "ses_a")
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli" })
  })

  test("existing session: switching to an agent with a model switches the model too, variant included", async () => {
    const { ctl, calls } = await ready({ sessions: [session("ses_a", { agent: "build", model: SONNET })] }, "ses_a")
    await ctl.dispatch({ type: "pickAgent", id: "review" })
    expect(calls).toEqual([
      ["session.switchAgent", { sessionID: "ses_a", agent: "review" }],
      ["session.switchModel", { sessionID: "ses_a", model: OPUS_HIGH }],
    ])
    expect(ctl.snapshot().model).toEqual(OPUS_HIGH)
  })

  test("existing session: an agent without a model keeps the session's model", async () => {
    const { ctl, calls } = await ready({ sessions: [session("ses_a", { agent: "review", model: OPUS_HIGH })] }, "ses_a")
    await ctl.dispatch({ type: "pickAgent", id: "build" })
    expect(calls).toEqual([["session.switchAgent", { sessionID: "ses_a", agent: "build" }]])
    expect(ctl.snapshot().model).toEqual(OPUS_HIGH)
  })

  test("existing session: picking the agent's model without a variant records the agent's variant", async () => {
    const { ctl, calls } = await ready({ sessions: [session("ses_a", { agent: "review", model: SONNET })] }, "ses_a")
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli" } })
    expect(calls).toEqual([["session.switchModel", { sessionID: "ses_a", model: OPUS_HIGH }]])
  })

  test("existing session: choosing the default variant of the model on screen stays without a variant", async () => {
    const { ctl, calls } = await ready({ sessions: [session("ses_a", { agent: "review" })] }, "ses_a")
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli" } })
    expect(calls).toEqual([["session.switchModel", { sessionID: "ses_a", model: { id: "opus", providerID: "cli" } }]])
  })

  test("existing session: an agent with a model switches a session that recorded none; one without a model does not", async () => {
    const { ctl, calls } = await ready({ sessions: [session("ses_a", { agent: "build", model: null })] }, "ses_a")
    await ctl.dispatch({ type: "pickAgent", id: "review" })
    expect(calls).toEqual([
      ["session.switchAgent", { sessionID: "ses_a", agent: "review" }],
      ["session.switchModel", { sessionID: "ses_a", model: OPUS_HIGH }],
    ])
    const other = await ready({ sessions: [session("ses_b", { agent: "review", model: null })] }, "ses_b")
    await other.ctl.dispatch({ type: "pickAgent", id: "build" })
    expect(other.calls).toEqual([["session.switchAgent", { sessionID: "ses_b", agent: "build" }]])
  })

  test("an agent variant the model does not list runs without a variant", async () => {
    const { ctl, calls } = await ready({ agents: [agent("odd", { model: { id: "opus", providerID: "cli", variant: "turbo" } })] })
    await ctl.dispatch({ type: "pickAgent", id: "odd" })
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli" })
    await ctl.dispatch({ type: "send", text: "hi" })
    expect(calls[0]![1].model).toEqual({ id: "opus", providerID: "cli" })
  })
})

describe("the explicit Default variant", () => {
  test("draft: Default shows and creates the session without a variant, not the agent's", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "pickAgent", id: "review" })
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli", variant: "default" } })
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli" })
    await ctl.dispatch({ type: "send", text: "hi" })
    expect(calls[0]).toEqual(["session.create", { location: { directory: "/w" }, agent: "review", model: { id: "opus", providerID: "cli" } }])
  })

  test("existing session: Default is recorded as no variant and not inherited again", async () => {
    const { ctl, calls } = await ready({ sessions: [session("ses_a", { agent: "review", model: SONNET })] }, "ses_a")
    await ctl.dispatch({ type: "pickModel", model: { id: "opus", providerID: "cli", variant: "default" } })
    expect(calls).toEqual([["session.switchModel", { sessionID: "ses_a", model: { id: "opus", providerID: "cli" } }]])
    expect(ctl.snapshot().model).toEqual({ id: "opus", providerID: "cli" })
  })
})
