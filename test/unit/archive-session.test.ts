import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { NOT_ARCHIVABLE, archivableSessions } from "@occ/core/archive-session"

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  projectID: "prj",
  time: { created: 1, updated: 1 },
  location: { directory: "/w" },
  ...extra,
})

type Opts = { update?: (i: { sessionID: string; archived?: boolean }) => Promise<unknown> }

function server(o: Opts = {}) {
  const calls: Array<[string, any]> = []
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  /** Mirrors the server: archived sessions only appear in archived lists. */
  const archivedState = new Set<string>()
  const roots = () => [
    session("ses_a", { time: { created: 1, updated: 3 } }),
    session("ses_b", { time: { created: 1, updated: 2 } }),
  ]
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async (q?: { parentID?: string | null; archived?: boolean }) => {
        if (q?.parentID) return { data: [] };
        return { data: roots().filter((s) => archivedState.has(s.id) === !!q?.archived) };
      },
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID),
      update: async (i: { sessionID: string; archived?: boolean }) => {
        calls.push(["session.update", i])
        if (i.archived) archivedState.add(i.sessionID);
        else archivedState.delete(i.sessionID)
        return o.update ? o.update(i) : undefined
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
  return { client, calls }
}

async function ready(o: Opts = {}) {
  const s = server(o)
  const store = new Map<string, unknown>()
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w", storage: { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) } })
  ;(ctl as any).client = s.client
  await ctl.sync()
  s.calls.length = 0
  return { ctl, store, ...s }
}

const ids = (ctl: Controller) => ctl.snapshot().sessions.map((s) => s.id)
const archivedIds = (ctl: Controller) => ctl.snapshot().archived.map((s) => s.id)

describe("archiveSession in the controller", () => {
  test("archives a stopped root session: one update call, moved to archived, no error", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "archiveSession", sessionID: "ses_b", archived: true })
    expect(calls).toEqual([["session.update", { sessionID: "ses_b", archived: true }]])
    expect(ids(ctl)).toEqual(["ses_a"])
    expect(archivedIds(ctl)).toContain("ses_b")
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("unarchiving moves the session back to the visible list", async () => {
    const { ctl, calls } = await ready()
    ;(ctl as any).archived = [session("ses_old", { time: { created: 1, updated: 1, archived: 5 } })]
    await ctl.dispatch({ type: "archiveSession", sessionID: "ses_old", archived: false })
    expect(calls).toEqual([["session.update", { sessionID: "ses_old", archived: false }]])
    expect(ids(ctl)).toContain("ses_old")
    expect(archivedIds(ctl)).not.toContain("ses_old")
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("the session.archived event that follows is harmless (idempotent)", async () => {
    const { ctl } = await ready()
    await ctl.dispatch({ type: "archiveSession", sessionID: "ses_b", archived: true })
    await ctl.onEvent({ type: "session.archived", data: { sessionID: "ses_b" } } as any)
    expect(ids(ctl)).not.toContain("ses_b")
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("a server failure shows on the error line and the session stays put", async () => {
    const { ctl, calls } = await ready({
      update: async () => {
        throw new Error("server said no")
      },
    })
    await ctl.dispatch({ type: "archiveSession", sessionID: "ses_b", archived: true })
    expect(calls.length).toBe(1)
    expect(ctl.snapshot().error).toBe("server said no")
    expect(ids(ctl)).toContain("ses_b")
  })

  test("refuses a worker session, an unknown id, and an empty id", async () => {
    const { ctl, calls } = await ready()
    ;(ctl as any).children.set("ses_kid", session("ses_kid", { parentID: "ses_a" }))
    for (const id of ["ses_kid", "ses_nope", ""]) {
      await ctl.dispatch({ type: "archiveSession", sessionID: id, archived: true })
      expect(ctl.snapshot().error).toBe(NOT_ARCHIVABLE)
    }
    expect(calls).toEqual([])
  })

  test("archiving does not require a stopped session (unlike delete): running sessions archive fine", async () => {
    const { ctl, calls } = await ready()
    ;(ctl as any).running = new Set(["ses_b"])
    await ctl.dispatch({ type: "archiveSession", sessionID: "ses_b", archived: true })
    expect(calls).toEqual([["session.update", { sessionID: "ses_b", archived: true }]])
    expect(ids(ctl)).toEqual(["ses_a"])
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("not connected: error line, nothing breaks", async () => {
    const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
    await ctl.dispatch({ type: "archiveSession", sessionID: "ses_b", archived: true })
    expect(ctl.snapshot().error).toMatch(/Not connected/)
  })
})

describe("archivableSessions (the row menu's eligibility)", () => {
  test("roots only, archived included, no duplicates", () => {
    const state = {
      sessions: [session("a"), session("b"), session("kid", { parentID: "a" })],
      archived: [session("d", { time: { created: 1, updated: 1, archived: 2 } }), session("a")],
    } as any
    expect(archivableSessions(state).map((s) => s.id)).toEqual(["a", "b", "d"])
  })
})
