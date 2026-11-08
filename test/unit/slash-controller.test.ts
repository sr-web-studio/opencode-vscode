import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  projectID: "prj",
  time: { created: 1, updated: 1 },
  location: { directory: "/w" },
  ...extra,
})

/** A fake server that records what the Controller calls. `forkError` makes `session.fork` reject like an empty session. */
function server(opts: { forkError?: unknown; commands?: Array<{ name: string; description?: string }> } = {}) {
  const calls: Array<[string, any]> = []
  const rec = (name: string, result?: unknown) => async (input?: any) => (calls.push([name, input]), result)
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async () => ({ data: [session("ses_a")] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID, sessionID === "ses_fork" ? { fork: { sessionID: "ses_a", boundary: {} } } : {}),
      create: rec("session.create", session("ses_new")),
      prompt: rec("session.prompt"),
      command: rec("session.command"),
      compact: rec("session.compact"),
      fork: async (i: any) => {
        calls.push(["session.fork", i])
        if (opts.forkError) throw opts.forkError
        return session("ses_fork", { fork: { sessionID: i.sessionID, boundary: {} } })
      },
      revert: { stage: rec("session.revert.stage", { messageID: "u2", files: [] }), clear: rec("session.revert.clear") },
    },
    command: {
      list: async () => (
        calls.push(["command.list", undefined]),
        { data: opts.commands ?? [{ name: "review", description: "review changes" }, { name: "compact", description: "server one" }, { name: "goal" }] }
      ),
    },
    skill: { list: async () => (calls.push(["skill.list", undefined]), { data: [{ id: "browser", name: "Browser", description: "d", path: "/p", content: "x" }] }) },
    mcp: { list: async () => ({ data: [{ name: "exa", status: { status: "connected" } }] }) },
    permission: { request: { list: async () => empty } },
    form: { list: async () => empty },
    agent: { list: async () => empty },
    model: { list: async () => empty, default: unsupported },
    provider: { list: async () => empty },
    config: { get: unsupported },
    shell: { list: async () => empty },
    message: { list: async () => ({ data: [], cursor: { next: null, previous: null } }) },
    event: { subscribe: async function* () {} },
  }
  return { client, calls }
}

async function ready(opts: Parameters<typeof server>[0] = {}, target: "session" | "draft" = "session") {
  const s = server(opts)
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
  ;(ctl as any).client = s.client
  await ctl.sync()
  if (target === "draft") await ctl.dispatch({ type: "newDraft", hasText: false })
  s.calls.length = 0
  return { ctl, ...s }
}
const names = (calls: Array<[string, any]>) => calls.map(([n]) => n)

describe("server commands", () => {
  test("the commands load on connect and appear in the state", async () => {
    const s = server()
    const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
    ;(ctl as any).client = s.client
    await ctl.sync()
    expect(ctl.snapshot().commands.map((c) => c.name)).toEqual(["review", "compact", "goal"])
  })
  test("`/review args` runs the command with the arguments; no delivery field", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "send", text: "/review main..HEAD" })
    expect(calls).toEqual([["session.command", { sessionID: "ses_a", name: "review", text: "main..HEAD" }]])
  })
  test("`/goal` without arguments", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "send", text: "/goal" })
    expect(calls[0]).toEqual(["session.command", { sessionID: "ses_a", name: "goal", text: "" }])
  })
  test("an unknown /xyz is an ordinary prompt", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "send", text: "/xyz do it" })
    expect(calls).toEqual([["session.prompt", { sessionID: "ses_a", text: "/xyz do it" }]])
  })
  test("a built-in name never goes to the server's command of the same name", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "send", text: "/compact please" })
    expect(names(calls)).toEqual(["session.prompt"])
  })
  test("in a draft the session is created first, then the command runs", async () => {
    const { ctl, calls } = await ready({}, "draft")
    await ctl.dispatch({ type: "send", text: "/review" })
    expect(names(calls)).toEqual(["session.create", "session.command"])
    expect(calls[1]![1]).toEqual({ sessionID: "ses_new", name: "review", text: "" })
    expect(ctl.currentSessionID).toBe("ses_new")
  })
  test("a failing command shows up on the error line", async () => {
    const { ctl, client } = await ready()
    client.session.command = async () => {
      throw { _tag: "CommandNotFoundError", message: "Command review not found" }
    }
    await ctl.dispatch({ type: "send", text: "/review" })
    expect(ctl.snapshot().error).toBe("Command review not found")
  })
  test("the popup asks again for the list; a second ask within the TTL is free", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "loadCommands" })
    await ctl.dispatch({ type: "loadCommands" })
    expect(names(calls).filter((n) => n === "command.list").length).toBeLessThanOrEqual(1)
  })
  test("a `command.updated` event refreshes the list", async () => {
    const { ctl, calls, client } = await ready()
    client.command.list = async () => (calls.push(["command.list", undefined]), { data: [{ name: "new-one" }] })
    await ctl.onEvent({ type: "command.updated", data: {} } as any)
    await new Promise((r) => setTimeout(r, 0))
    expect(ctl.snapshot().commands.map((c) => c.name)).toEqual(["new-one"])
  })
  test("loading the list does not clear an error the user has not read", async () => {
    const { ctl } = await ready()
    ;(ctl as any).error = "something"
    await ctl.dispatch({ type: "loadCommands" })
    expect(ctl.snapshot().error).toBe("something")
  })
})

describe("skills", () => {
  test("sent as `skills: [{ id }]` on a prompt", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "loadSkills" })
    expect(ctl.snapshot().skills).toEqual([{ id: "browser", name: "Browser", description: "d" }])
    await ctl.dispatch({ type: "send", text: "look at this", skills: [{ id: "browser" }] })
    expect(calls.at(-1)).toEqual(["session.prompt", { sessionID: "ses_a", text: "look at this", skills: [{ id: "browser" }] }])
  })
  test("sent on a command too, and with no skills the field is absent", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "send", text: "/review", skills: [{ id: "browser" }] })
    expect(calls[0]![1].skills).toEqual([{ id: "browser" }])
    await ctl.dispatch({ type: "send", text: "plain" })
    expect("skills" in calls[1]![1]).toBe(false)
  })
})

describe("/compact", () => {
  test("compacts the current session", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "compact" })
    expect(calls).toEqual([["session.compact", { sessionID: "ses_a" }]])
  })
  test("a draft has nothing to compact: a short note, no call", async () => {
    const { ctl, calls } = await ready({}, "draft")
    await ctl.dispatch({ type: "compact" })
    expect(calls).toEqual([])
    expect(ctl.snapshot().error).toMatch(/Nothing to compact/)
  })
})

describe("/fork", () => {
  test("opens the new session and lists it", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "fork" })
    expect(calls[0]).toEqual(["session.fork", { sessionID: "ses_a" }])
    expect(ctl.currentSessionID).toBe("ses_fork")
    expect(ctl.snapshot().sessions.map((s) => s.id)).toContain("ses_fork")
  })
  test("an empty session says so", async () => {
    const { ctl } = await ready({ forkError: { _tag: "InvalidRequestError", kind: "empty_session", message: "Session has no messages" } })
    await ctl.dispatch({ type: "fork" })
    expect(ctl.snapshot().error).toBe("Nothing to fork yet.")
    expect(ctl.currentSessionID).toBe("ses_a")
  })
  test("another failure shows its own message", async () => {
    const { ctl } = await ready({ forkError: { _tag: "InvalidRequestError", kind: "other", message: "nope" } })
    await ctl.dispatch({ type: "fork" })
    expect(ctl.snapshot().error).toBe("nope")
  })
  test("a draft: a short note", async () => {
    const { ctl, calls } = await ready({}, "draft")
    await ctl.dispatch({ type: "fork" })
    expect(calls).toEqual([])
    expect(ctl.snapshot().error).toBe("Nothing to fork yet.")
  })
  test("a `session.forked` event adds the session made by another client", async () => {
    const { ctl } = await ready()
    await ctl.onEvent({ type: "session.forked", location: { directory: "/w" }, data: { sessionID: "ses_other", parentID: "ses_a" } } as any)
    expect(ctl.snapshot().sessions.map((s) => s.id)).toContain("ses_other")
  })
})

describe("/mcps in state", () => {
  test("open / close and the list", async () => {
    const { ctl } = await ready()
    expect(ctl.snapshot().mcp.servers.map((s) => s.name)).toEqual(["exa"])
    await ctl.dispatch({ type: "mcp", op: "open" })
    expect(ctl.snapshot().mcp.open).toBe(true)
    await ctl.dispatch({ type: "mcp", op: "close" })
    expect(ctl.snapshot().mcp.open).toBe(false)
  })
  test("toggle goes through the experimental runtime calls with the project location", async () => {
    const { ctl, client } = await ready()
    const calls: any[] = []
    client.experimental = { mcp: { disconnect: async (i: any) => void calls.push(["disconnect", i]), connect: async (i: any) => void calls.push(["connect", i]) } }
    await ctl.dispatch({ type: "mcp", op: "toggle", server: "exa" })
    expect(calls).toEqual([["disconnect", { server: "exa", location: { directory: "/w" } }]])
  })
  test("detach forgets the list", async () => {
    const { ctl } = await ready()
    ctl.detach()
    expect(ctl.snapshot().mcp.servers).toEqual([])
  })
})
