import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { runningWorkers, workerLabel } from "@occ/core/worker-activity"

describe("runningWorkers", () => {
  test("counts only running children whose parent is in the list", () => {
    const children = [{ id: "kid-a", parentID: "root" }, { id: "kid-b", parentID: "root" }, { id: "kid-c", parentID: "other" }, { id: "root2" }]
    expect(runningWorkers(["root"], children, new Set(["kid-a", "kid-b", "kid-c"]))).toEqual(new Map([["root", 2]]))
  })

  test("a finished child, an unknown parent and a duplicate child do not count", () => {
    const children = [
      { id: "kid-a", parentID: "root" },
      { id: "kid-a", parentID: "root" },
      { id: "kid-b", parentID: "root" },
      { id: "kid-x", parentID: "gone" },
    ]
    expect(runningWorkers(["root"], children, new Set(["kid-a"]))).toEqual(new Map([["root", 1]]))
  })

  test("no running worker leaves the map empty", () => {
    expect(runningWorkers(["root"], [{ id: "kid", parentID: "root" }], new Set())).toEqual(new Map())
  })
})

describe("workerLabel", () => {
  test("says one or many, and nothing at zero", () => {
    expect(workerLabel(0)).toBe("")
    expect(workerLabel(1)).toBe("Worker running")
    expect(workerLabel(3)).toBe("3 workers running")
  })
})

/* ------------------------------------------------------------- controller */

const session = (id: string, extra: Record<string, unknown> = {}): any => ({
  id,
  title: `Title ${id}`,
  projectID: "prj",
  time: { created: 1, updated: 1 },
  location: { directory: "/w" },
  ...extra,
})

/**
 * A fake server with one root `ses_root` and a running child `ses_kid`. A list without `parentID` answers roots and
 * children together, like the live server; a list with `parentID: null` answers roots only.
 */
function server() {
  const roots = [session("ses_root", { time: { created: 1, updated: 5 } })]
  const kids = [session("ses_kid", { parentID: "ses_root", time: { created: 2, updated: 4 } })]
  const empty = { data: [] }
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async (q: { parentID?: string | null } = {}) => {
        if (q.parentID === null) return { data: roots }
        if (typeof q.parentID === "string") return { data: kids.filter((kid) => kid.parentID === q.parentID) }
        return { data: [...roots, ...kids] }
      },
      active: async () => ({ ses_kid: true }),
      get: async ({ sessionID }: { sessionID: string }) => [...roots, ...kids].find((s) => s.id === sessionID) ?? session(sessionID),
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
  return { client, kids }
}

async function ready() {
  const s = server()
  const store = new Map<string, unknown>()
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w", storage: { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) } })
  ;(ctl as any).client = s.client
  await ctl.sync()
  return { ctl, ...s }
}

describe("the controller's worker counts", () => {
  test("an idle root with a running child reports the worker, and the child is the only running id", async () => {
    const { ctl } = await ready()
    const state = ctl.snapshot()
    expect(state.workerRunning).toEqual({ ses_root: 1 })
    expect(state.running).toEqual(["ses_kid"])
  })

  test("the child finishing takes the indicator away without moving the root", async () => {
    const { ctl } = await ready()
    await ctl.onEvent({ type: "session.execution.succeeded", created: 6, data: { sessionID: "ses_kid" } } as any)
    expect(ctl.snapshot().workerRunning).toEqual({})
    expect(ctl.snapshot().running).toEqual([])
  })

  test("a worker created after the list is counted once it starts, and a deleted root forgets its workers", async () => {
    const { ctl, client, kids } = await ready()
    kids.push(session("ses_kid2", { parentID: "ses_root", time: { created: 7, updated: 7 } }))
    client.session.active = async () => ({ ses_kid: true, ses_kid2: true })
    await ctl.onEvent({ type: "session.created", created: 7, data: { sessionID: "ses_kid2", parentID: "ses_root" } } as any)
    await ctl.onEvent({ type: "session.execution.started", created: 7, data: { sessionID: "ses_kid2" } } as any)
    expect(ctl.snapshot().workerRunning).toEqual({ ses_root: 2 })
    await ctl.onEvent({ type: "session.deleted", created: 8, data: { sessionID: "ses_root" } } as any)
    expect(ctl.snapshot().workerRunning).toEqual({})
    expect(ctl.snapshot().running).toEqual([])
  })
})
