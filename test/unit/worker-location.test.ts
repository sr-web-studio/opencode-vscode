import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { WorkerTab } from "@occ/core/worker-tab"

/**
 * A worker can move to its own folder (a worktree) while the window keeps showing it. Its events then carry that
 * folder, not the window's: they must still reach the panel, the worker tab and the notification engine.
 */
const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  projectID: "prj",
  time: { created: 1, updated: 1 },
  location: { directory: "/w" },
  ...extra,
})

type Kid = { id: string; directory: string; parentID: string; updated?: number; listed?: boolean }

function server(kids: Kid[]) {
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async (q?: { parentID?: string | null }) => ({
        data: q?.parentID
          ? kids
              .filter((k) => k.parentID === q.parentID && k.listed !== false)
              .map((k) => session(k.id, { parentID: k.parentID, location: { directory: k.directory }, time: { created: 1, updated: k.updated ?? 1 } }))
          : [session("ses_a")],
      }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => {
        const kid = kids.find((k) => k.id === sessionID)
        return kid ? session(kid.id, { parentID: kid.parentID, location: { directory: kid.directory }, time: { created: 1, updated: kid.updated ?? 1 } }) : session(sessionID)
      },
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
  return client
}

/** A window on `/w`, open on `ses_a`, whose worker `ses_kid` moved to `/other`. */
async function ready(kids: Kid[] = [{ id: "ses_kid", directory: "/other", parentID: "ses_a" }]) {
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
  ;(ctl as any).client = server(kids)
  await ctl.sync()
  ctl.setConnection({ status: "connected" })
  await ctl.open("ses_a")
  return ctl
}

const at = { location: { directory: "/other" } }
const step = (created: number, data: Record<string, unknown> = {}) =>
  ({ type: "session.step.started", created, ...at, data: { sessionID: "ses_kid", assistantMessageID: "msg_1", started: created, ...data } }) as any
const delta = (text: string) => ({ type: "session.text.delta", created: 2, ...at, data: { sessionID: "ses_kid", assistantMessageID: "msg_1", ordinal: 0, delta: text } }) as any

const viewText = (s: { view: { turns: ReadonlyArray<{ steps: ReadonlyArray<{ items: ReadonlyArray<{ kind: string; text?: string }> }> }> } }) =>
  s.view.turns.flatMap((t) => t.steps.flatMap((st) => st.items.filter((i) => i.kind === "text").map((i) => i.text ?? ""))).join("")

describe("a worker that moved to another folder (its own worktree)", () => {
  test("its live events still reach the worker tab", async () => {
    const ctl = await ready()
    const tab = new WorkerTab(ctl, "ses_kid")
    await tab.start()
    await ctl.onEvent(step(1))
    await ctl.onEvent(delta("hello from the worktree"))
    expect(viewText(tab.snapshot())).toBe("hello from the worktree")
    tab.dispose()
    ctl.detach()
  })

  test("its events count as activity in the panel (not 'quiet' while it works)", async () => {
    const ctl = await ready()
    await ctl.onEvent({ type: "session.execution.started", created: 5_000, ...at, data: { sessionID: "ses_kid" } } as any)
    const worker = ctl.snapshot().workers.find((w) => w.sessionID === "ses_kid")
    expect(worker?.status).toBe("running")
    expect(worker?.updated).toBe(5_000)
    ctl.detach()
  })

  test("a worker created in another folder is listed and can be opened", async () => {
    const ctl = await ready([{ id: "ses_kid2", directory: "/other", parentID: "ses_a", listed: false }])
    expect(ctl.snapshot().workers).toEqual([])
    await ctl.onEvent({ type: "session.created", created: 3, ...at, data: { sessionID: "ses_kid2", parentID: "ses_a", location: { directory: "/other" } } } as any)
    expect(ctl.snapshot().workers.map((w) => w.sessionID)).toContain("ses_kid2")
    ctl.detach()
  })

  test("deleting a moved worker removes its row", async () => {
    const ctl = await ready()
    await ctl.onEvent({ type: "session.deleted", created: 4, ...at, data: { sessionID: "ses_kid" } } as any)
    expect(ctl.snapshot().workers.map((w) => w.sessionID)).not.toContain("ses_kid")
    ctl.detach()
  })

  test("a session of another folder that this window does not list is still ignored", async () => {
    const ctl = await ready()
    const tab = new WorkerTab(ctl, "ses_kid")
    await tab.start()
    const other = { location: { directory: "/elsewhere" } }
    await ctl.onEvent({ type: "session.execution.started", created: 9_000, ...other, data: { sessionID: "ses_other" } } as any)
    await ctl.onEvent({ type: "session.step.started", created: 9_000, ...other, data: { sessionID: "ses_other", assistantMessageID: "msg_x", started: 9_000 } } as any)
    expect(ctl.snapshot().running).not.toContain("ses_other")
    expect(ctl.snapshot().workers.map((w) => w.sessionID)).not.toContain("ses_other")
    expect(viewText(tab.snapshot())).toBe("")
    tab.dispose()
    ctl.detach()
  })
})
