import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { confirmDelete, deletableSessions, DELETE_DETAIL, deleteQuestion } from "@occ/core/delete-session"
import { WorkerTab } from "@occ/core/worker-tab"
import { isGone } from "@occ/core/errors"
import { chooseDeleteTarget } from "../../apps/vscode/src/extension/delete-session-target"

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  projectID: "prj",
  time: { created: 1, updated: 1 },
  location: { directory: "/w" },
  ...extra,
})

type Opts = { active?: Record<string, boolean>; kids?: Record<string, string[]>; remove?: (i: { sessionID: string }) => Promise<unknown> }

/** A fake server with roots `ses_a` (newest, open at start), `ses_b`, `ses_c`; `ses_kid` is a worker of `ses_b`. */
function server(o: Opts = {}) {
  const calls: Array<[string, any]> = []
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const kids = o.kids ?? { ses_b: ["ses_kid"] }
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async (q?: { parentID?: string | null }) => ({
        data: q?.parentID
          ? (kids[q.parentID] ?? []).map((id) => session(id, { parentID: q.parentID }))
          : [session("ses_a", { time: { created: 1, updated: 3 } }), session("ses_b", { time: { created: 1, updated: 2 } }), session("ses_c")],
      }),
      active: async () => o.active ?? {},
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID),
      remove: async (i: { sessionID: string }) => {
        calls.push(["session.remove", i])
        return o.remove ? o.remove(i) : undefined
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

describe("deleteSession in the controller", () => {
  test("deletes a stopped root session: one remove call, gone from the list at once, no error", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(calls).toEqual([["session.remove", { sessionID: "ses_c" }]])
    expect(ids(ctl)).toEqual(["ses_a", "ses_b"])
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("the session.deleted event that follows is harmless (idempotent)", async () => {
    const { ctl } = await ready()
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    await ctl.onEvent({ type: "session.deleted", data: { sessionID: "ses_c" } } as any)
    expect(ids(ctl)).toEqual(["ses_a", "ses_b"])
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("deleting the open session switches to the default target (the newest remaining) and forgets what is remembered", async () => {
    const { ctl, store } = await ready()
    expect(ctl.currentSessionID).toBe("ses_a")
    store.set("lastSession", "ses_a")
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_a" })
    expect(ctl.currentSessionID).toBe("ses_b")
    expect(ids(ctl)).toEqual(["ses_b", "ses_c"])
    expect(store.get("lastSession")).toBe("ses_b")
  })

  test("deleting the last session leaves a draft", async () => {
    const { ctl } = await ready()
    for (const id of ["ses_a", "ses_b", "ses_c"]) await ctl.dispatch({ type: "deleteSession", sessionID: id })
    expect(ctl.snapshot().target).toEqual({ kind: "draft" })
    expect(ids(ctl)).toEqual([])
  })

  test("hidden workers of the session are forgotten (workspaceState), others stay", async () => {
    const { ctl, store } = await ready()
    ;(ctl as any).setHidden({ ses_c: ["k1"], ses_b: ["k2"] })
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(store.get("hiddenWorkers")).toEqual({ ses_b: ["k2"] })
  })

  test("an archived root session is deletable too", async () => {
    const { ctl, calls } = await ready()
    ;(ctl as any).archived = [session("ses_old", { time: { created: 1, updated: 1, archived: 5 } })]
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_old" })
    expect(calls).toEqual([["session.remove", { sessionID: "ses_old" }]])
    expect(ctl.snapshot().archived).toEqual([])
  })

  test("404 means already gone: no error, local state cleaned", async () => {
    const { ctl, calls } = await ready({
      remove: async () => {
        throw Object.assign(new Error("Session not found"), { _tag: "SessionNotFoundError" })
      },
    })
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(calls.length).toBe(1)
    expect(ids(ctl)).toEqual(["ses_a", "ses_b"])
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("another failure shows on the error line and the session stays", async () => {
    const { ctl } = await ready({
      remove: async () => {
        throw new Error("server said no")
      },
    })
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(ctl.snapshot().error).toBe("server said no")
    expect(ids(ctl)).toEqual(["ses_a", "ses_b", "ses_c"])
  })

  test("refuses a running session: error line, no call", async () => {
    const { ctl, calls } = await ready()
    await ctl.onEvent({ type: "session.execution.started", created: 5, data: { sessionID: "ses_c" } } as any)
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(calls).toEqual([])
    expect(ctl.snapshot().error).toMatch(/Stop the session first/)
    expect(ids(ctl)).toContain("ses_c")
  })

  test("refuses when the server says it is active even though no event arrived here", async () => {
    const { ctl, calls } = await ready({ active: { ses_c: true } })
    ;(ctl as any).running.clear()
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(calls).toEqual([])
    expect(ctl.snapshot().error).toMatch(/Stop the session first/)
  })

  test("refuses a session with a running worker (also one not tracked locally)", async () => {
    const { ctl, calls } = await ready({ active: { ses_kid: true } })
    ;(ctl as any).running.clear()
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_b" })
    expect(calls).toEqual([])
    expect(ctl.snapshot().error).toMatch(/worker .* still running/)
    expect(ids(ctl)).toContain("ses_b")
  })

  test("a session whose workers have all finished is deleted", async () => {
    const { ctl, calls } = await ready()
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_b" })
    expect(calls).toEqual([["session.remove", { sessionID: "ses_b" }]])
  })

  test("refuses a session with a pending permission, or a form, in the session or in a worker", async () => {
    const { ctl, calls } = await ready()
    ;(ctl as any).permissions.set("ses_c", [{ id: "per_1", sessionID: "ses_c" }])
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(ctl.snapshot().error).toMatch(/waiting for your answer/)
    ;(ctl as any).forms.set("ses_kid", [{ id: "frm_1", sessionID: "ses_kid" }])
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_b" })
    expect(ctl.snapshot().error).toMatch(/waiting for your answer/)
    expect(calls).toEqual([])
  })

  test("refuses a worker (child) session, a session that is not listed, and an empty id", async () => {
    const { ctl, calls } = await ready()
    ;(ctl as any).children.set("ses_kid", session("ses_kid", { parentID: "ses_a" }))
    for (const id of ["ses_kid", "ses_nope", ""]) {
      await ctl.dispatch({ type: "deleteSession", sessionID: id })
      expect(ctl.snapshot().error).toMatch(/Only a session from the session list/)
    }
    expect(calls).toEqual([])
  })

  test("a session with a parent in the list is never deletable from here", async () => {
    const { ctl, calls } = await ready()
    ;(ctl as any).sessions = [...(ctl as any).sessions, session("ses_odd", { parentID: "ses_a" })]
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_odd" })
    expect(calls).toEqual([])
    expect(ctl.snapshot().error).toBeDefined()
  })

  test("not connected: error line, nothing breaks", async () => {
    const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
    await ctl.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(ctl.snapshot().error).toMatch(/Not connected/)
  })

  test("a read-only worker tab ignores the action and the server is never called", async () => {
    const { ctl, calls } = await ready()
    const tab = new WorkerTab(ctl, "ses_kid")
    await tab.dispatch({ type: "deleteSession", sessionID: "ses_c" })
    expect(calls).toEqual([])
    expect(ids(ctl)).toContain("ses_c")
    tab.dispose()
  })
})

describe("host confirmation", () => {
  const asker = (answer: string | undefined) => {
    const seen: Array<{ message: string; options: unknown; buttons: string[] }> = []
    const ask = async (message: string, options: { modal: true; detail: string }, ...buttons: string[]) => {
      seen.push({ message, options, buttons })
      return answer
    }
    return { ask, seen }
  }

  test("the modal says what it does and offers only Delete (the dialog adds Cancel)", async () => {
    const { ask, seen } = asker("Delete")
    expect(await confirmDelete(ask, "Fix login")).toBe(true)
    expect(seen).toEqual([{ message: "Delete “Fix login”?", options: { modal: true, detail: DELETE_DETAIL }, buttons: ["Delete"] }])
    expect(DELETE_DETAIL).toBe("This deletes the session and its workers on the OpenCode server for every client (TUI, other windows). It cannot be undone.")
  })

  test("Cancel, Escape or a closed dialog (undefined) never confirms", async () => {
    expect(await confirmDelete(asker(undefined).ask, "x")).toBe(false)
    expect(await confirmDelete(asker("Cancel").ask, "x")).toBe(false)
  })

  test("an empty title reads as the untitled session", () => {
    expect(deleteQuestion("  ")).toBe("Delete “Untitled session”?")
    expect(deleteQuestion(undefined)).toBe("Delete “Untitled session”?")
  })
})

describe("deletableSessions (the command's list)", () => {
  test("roots only, not running, not waiting, archived included, no duplicates", () => {
    const state = {
      sessions: [session("a"), session("b"), session("c"), session("kid", { parentID: "a" })],
      archived: [session("d", { time: { created: 1, updated: 1, archived: 2 } }), session("a")],
      running: ["b"],
      waiting: ["c"],
    } as any
    expect(deletableSessions(state).map((s) => s.id)).toEqual(["a", "d"])
  })
})

describe("chooseDeleteTarget (the sidebar row's decision)", () => {
  const state = (over: Record<string, unknown> = {}) =>
    ({
      sessions: [session("a", { title: "Alpha" }), session("b"), session("c")],
      archived: [session("old", { time: { created: 1, updated: 1, archived: 2 } })],
      running: [] as string[],
      waiting: [] as string[],
      ...over,
    }) as any

  test("no id: the Command Palette picks, as before", () => {
    expect(chooseDeleteTarget(state())).toEqual({ kind: "pick" })
    expect(chooseDeleteTarget(state(), "")).toEqual({ kind: "pick" })
  })

  test("a stopped root session is the target, so the row is confirmed without a second picker", () => {
    expect(chooseDeleteTarget(state(), "a")).toMatchObject({ kind: "target", session: { id: "a" } })
  })

  test("an archived stopped root session is a target too", () => {
    expect(chooseDeleteTarget(state(), "old")).toMatchObject({ kind: "target", session: { id: "old" } })
  })

  test("running and waiting sessions are refused with their own reason", () => {
    expect(chooseDeleteTarget(state({ running: ["b"] }), "b")).toEqual({ kind: "running" })
    expect(chooseDeleteTarget(state({ waiting: ["c"] }), "c")).toEqual({ kind: "waiting" })
  })

  test("waiting outranks running, as in the shared order", () => {
    expect(chooseDeleteTarget(state({ running: ["c"], waiting: ["c"] }), "c")).toEqual({ kind: "waiting" })
  })

  test("a worker in the session list is refused; an unknown id is gone", () => {
    expect(chooseDeleteTarget(state({ sessions: [session("kid", { parentID: "a" })] }), "kid")).toEqual({ kind: "worker" })
    expect(chooseDeleteTarget(state(), "nope")).toEqual({ kind: "gone" })
  })
})

describe("isGone", () => {
  test("recognises the server's not-found shapes and nothing else", () => {
    expect(isGone({ _tag: "SessionNotFoundError", message: "x" })).toBe(true)
    expect(isGone(new Error("404 not found"))).toBe(true)
    expect(isGone({ status: 404 })).toBe(true)
    expect(isGone(new Error("server said no"))).toBe(false)
    expect(isGone(undefined)).toBe(false)
  })
})
