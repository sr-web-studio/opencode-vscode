import { describe, expect, test } from "bun:test"
import { Controller } from "../../src/core/controller"
import { WorkerTab } from "../../src/core/worker-tab"
import { QUIET_AFTER_MS, quietFor, quietLabel, type Worker } from "../../src/core/workers"

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory: "/w" }, ...extra,
})

/** A fake server with one root session (`ses_a`) that has one child (`ses_kid`) and an unrelated session of another parent. */
function server() {
  const calls: Array<[string, any]> = []
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async (q?: { parentID?: string }) => ({ data: q?.parentID === "ses_a" ? [session("ses_kid", { parentID: "ses_a", agent: "explore" })] : [session("ses_a"), session("ses_b")] }),
      active: async () => ({ ses_kid: true }),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID),
      interrupt: async (i: any) => void calls.push(["session.interrupt", i]),
    },
    command: { list: async () => empty },
    skill: { list: async () => empty },
    mcp: { list: async () => empty },
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

async function ready() {
  const s = server()
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
  ;(ctl as any).client = s.client
  await ctl.sync()
  s.calls.length = 0
  return { ctl, ...s }
}

describe("stopWorker in the controller", () => {
  test("a child of the current session is interrupted", async () => {
    const { ctl, calls } = await ready()
    expect(ctl.currentSessionID).toBe("ses_a")
    expect(ctl.snapshot().workers.map((w) => [w.sessionID, w.status])).toEqual([["ses_kid", "running"]])
    await ctl.dispatch({ type: "stopWorker", sessionID: "ses_kid" })
    expect(calls).toEqual([["session.interrupt", { sessionID: "ses_kid" }]])
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("any other session id is refused and nothing is interrupted: the open session, another root, an unknown id", async () => {
    const { ctl, calls } = await ready()
    for (const id of ["ses_a", "ses_b", "ses_nope", ""]) {
      await ctl.dispatch({ type: "stopWorker", sessionID: id })
      expect(ctl.snapshot().error).toMatch(/cannot be stopped/)
    }
    expect(calls).toEqual([])
  })

  test("a child of another session is refused too", async () => {
    const { ctl, calls } = await ready()
    ;(ctl as any).children.set("ses_other_kid", session("ses_other_kid", { parentID: "ses_b" }))
    await ctl.dispatch({ type: "stopWorker", sessionID: "ses_other_kid" })
    expect(calls).toEqual([])
    expect(ctl.snapshot().error).toBeDefined()
  })

  test("a failing interrupt shows on the error line", async () => {
    const { ctl, client } = await ready()
    client.session.interrupt = async () => { throw new Error("server said no") }
    await ctl.dispatch({ type: "stopWorker", sessionID: "ses_kid" })
    expect(ctl.snapshot().error).toBe("server said no")
  })

  test("session.execution.interrupted for the child turns the row Stopped and the running count drops", async () => {
    const { ctl } = await ready()
    await ctl.onEvent({ type: "session.execution.interrupted", created: 5000, data: { sessionID: "ses_kid", reason: "user" } } as any)
    const s = ctl.snapshot()
    expect(s.workers.map((w) => w.status)).toEqual(["stopped"])
    expect(s.running).not.toContain("ses_kid")
    expect(s.workers.filter((w) => w.status === "running").length).toBe(0)
  })

  test("events of a worker refresh its last activity time", async () => {
    const { ctl } = await ready()
    expect(ctl.snapshot().workers[0]!.updated).toBe(1)
    await ctl.onEvent({ type: "session.step.started", created: 9000, data: { sessionID: "ses_kid", assistantMessageID: "m1" } } as any)
    expect(ctl.snapshot().workers[0]!.updated).toBe(9000)
    await ctl.onEvent({ type: "session.step.started", created: 4000, data: { sessionID: "ses_kid", assistantMessageID: "m2" } } as any)
    expect(ctl.snapshot().workers[0]!.updated).toBe(9000)
  })
})

describe("stopWorker in the worker tab", () => {
  function tab(snapshotError?: string) {
    const dispatched: any[] = []
    const controller = {
      api: { session: { get: async () => ({ id: "ses_w", title: "W" }) }, message: { list: async () => ({ data: [], cursor: { next: null, previous: null } }) } },
      observe: () => () => {},
      subscribe: () => () => {},
      snapshot: () => ({ target: { kind: "session", id: "ses_lead" }, features: { revert: true, rename: true }, workers: [], running: [], error: snapshotError }),
      permissionsOf: () => [],
      dispatch: async (a: any) => void dispatched.push(a),
    }
    return { tab: new WorkerTab(controller as never, "ses_w"), dispatched }
  }

  test("forwards the tab's own id", async () => {
    const { tab: t, dispatched } = tab()
    await t.dispatch({ type: "stopWorker", sessionID: "ses_w" })
    expect(dispatched).toEqual([{ type: "stopWorker", sessionID: "ses_w" }])
    t.dispose()
  })

  test("never forwards another id", async () => {
    const { tab: t, dispatched } = tab()
    await t.dispatch({ type: "stopWorker", sessionID: "ses_lead" })
    await t.dispatch({ type: "stopWorker", sessionID: "ses_other" })
    expect(dispatched).toEqual([])
    t.dispose()
  })

  test("an error of the controller shows on the tab's own error line", async () => {
    const { tab: t } = tab("server said no")
    await t.dispatch({ type: "stopWorker", sessionID: "ses_w" })
    expect(t.snapshot().error).toBe("server said no")
    t.dispose()
  })
})

describe("quiet time of a running worker", () => {
  const w = (over: Partial<Worker> = {}): Pick<Worker, "status" | "updated"> => ({ status: "running", updated: 1_000_000, ...over })
  const at = (idleMs: number) => 1_000_000 + idleMs

  test("not shown up to a minute of silence, shown after", () => {
    expect(quietFor(w(), at(0))).toBeUndefined()
    expect(quietFor(w(), at(QUIET_AFTER_MS))).toBeUndefined()
    expect(quietFor(w(), at(QUIET_AFTER_MS + 1))).toBe(QUIET_AFTER_MS + 1)
  })
  test("compact labels", () => {
    expect(quietLabel(w(), at(61_000))).toBe("quiet 1m")
    expect(quietLabel(w(), at(5 * 60_000))).toBe("quiet 5m")
    expect(quietLabel(w(), at(2 * 3_600_000))).toBe("quiet 2h")
    expect(quietLabel(w(), at(30_000))).toBe("")
  })
  test("only for running workers with a known time; a clock behind the update is not quiet", () => {
    expect(quietLabel(w({ status: "done" }), at(10 * 60_000))).toBe("")
    expect(quietLabel(w({ status: "stopped" }), at(10 * 60_000))).toBe("")
    expect(quietLabel(w({ status: "failed" }), at(10 * 60_000))).toBe("")
    expect(quietLabel(w({ updated: undefined }), at(10 * 60_000))).toBe("")
    expect(quietLabel(w(), 500_000)).toBe("")
  })
})
