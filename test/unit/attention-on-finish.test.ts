import { beforeEach, describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { COALESCE_MS, NotificationEngine } from "@occ/core/notifications/engine"
import { defaultNotificationSettings, type Notice, type NotificationSettings, type SessionMeta, type UiState } from "@occ/core/notifications/types"

/**
 * Turn-end events (`session.execution.succeeded/failed`) carry no `location` on server 2.2.5 (live-checked), unlike
 * `form.created` / `permission.asked`. They are filtered by the session's recorded folder alone, so a mismatch there
 * silently dropped the notice (and the taskbar flash) while a question in the same session still got through.
 */

const DIR = "d:\\Work\\proj"
let shown: Notice[]
let logs: string[]
let settings: NotificationSettings
let ui: UiState
let sessions: Record<string, SessionMeta>
let owned: Set<string>
let clock: number
let engine: NotificationEngine

beforeEach(() => {
  shown = []
  logs = []
  settings = { ...defaultNotificationSettings }
  ui = { windowFocused: false }
  sessions = { root: { title: "Fix login", directory: DIR } }
  owned = new Set()
  clock = 1_000_000
  engine = new NotificationEngine({
    directory: DIR,
    settings: () => settings,
    ui: () => ui,
    notifier: { show: (n) => void shown.push(n), dismiss: () => undefined },
    now: () => clock,
    session: (id) => sessions[id],
    shellSession: () => undefined,
    owns: (id) => owned.has(id),
    log: (l) => logs.push(l),
  })
})

const finished = (sessionID = "root", type = "session.execution.succeeded") => ({ type, data: { sessionID } }) // no location, as on the wire
const question = (sessionID = "root", location: any = { directory: "D:\\Work\\proj" }) => ({
  type: "form.created",
  location,
  data: { form: { id: "f1", sessionID, title: "Q", fields: [{ key: "a", title: "Pick" }] } },
})

describe("turn end without an event location", () => {
  test("session folder spelled differently: still shown when the window lists the session", async () => {
    sessions.root = { title: "Fix login", directory: "/srv/office/proj" }
    owned.add("root")
    await engine.handle(finished())
    expect(shown.map((n) => n.kind)).toEqual(["completed"])
    expect(logs.some((l) => l.includes("dropped"))).toBe(false)
  })

  test("failed turn too", async () => {
    sessions.root = { title: "Fix login", directory: "/srv/office/proj" }
    owned.add("root")
    await engine.handle({ type: "session.execution.failed", data: { sessionID: "root", error: { message: "boom" } } })
    expect(shown.map((n) => n.kind)).toEqual(["failed"])
  })

  test("a question and the turn end of the same session both get through, in that order", async () => {
    sessions.root = { title: "Fix login", directory: "/srv/office/proj" }
    owned.add("root")
    await engine.handle(question())
    await engine.handle({ type: "form.replied", data: { id: "f1", sessionID: "root" } })
    clock += 1000
    await engine.handle(finished())
    expect(shown.map((n) => n.kind)).toEqual(["question", "completed"])
  })

  test("the event's own folder is enough when the session lookup fails", async () => {
    sessions = {}
    await engine.handle({ type: "session.execution.succeeded", location: { directory: "D:\\Work\\proj" }, data: { sessionID: "ghost" } })
    expect(shown.map((n) => n.kind)).toEqual(["completed"])
  })

  test("a session of another project that this window does not list is still ignored", async () => {
    sessions.other = { title: "Elsewhere", directory: "/srv/office/other" }
    await engine.handle(finished("other"))
    expect(shown).toEqual([])
  })
})

describe("dropped notices are logged (kind and session id only)", () => {
  test("other project", async () => {
    sessions.other = { title: "Secret title", directory: "/srv/other" }
    await engine.handle(finished("other"))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain("completed")
    expect(logs[0]).toContain("other")
    expect(logs[0]).toContain("not this project")
    expect(logs[0]).not.toContain("Secret title")
  })

  test("unknown session", async () => {
    await engine.handle(finished("ghost"))
    expect(logs[0]).toMatch(/completed, session ghost.*not found/)
  })

  test("setting off", async () => {
    settings.completed = false
    await engine.handle(finished())
    expect(logs[0]).toMatch(/completed, session root.*opencode\.notifications\.completed is off/)
    settings.enabled = false
    await engine.handle(finished())
    expect(logs[1]).toMatch(/enabled is off/)
  })

  test("worker kind follows the workers setting", async () => {
    sessions.kid = { title: "Worker", parentID: "root", directory: DIR }
    await engine.handle(finished("kid"))
    expect(logs[0]).toMatch(/worker, session kid.*notifications\.workers is off/)
  })

  test("focused with the session on screen", async () => {
    ui = { windowFocused: true, visibleSessionID: "root" }
    await engine.handle(finished())
    expect(logs[0]).toMatch(/completed, session root.*focused/)
  })

  test("coalesced: names the notice that blocked it and its age", async () => {
    await engine.handle(finished())
    clock += 1200
    await engine.handle(finished("root", "session.execution.failed"))
    expect(shown).toHaveLength(1)
    expect(logs.at(-1)).toMatch(/failed, session root.*completed notice.*1200 ms ago.*coalesce window 5000 ms/)
    clock += COALESCE_MS
    await engine.handle(finished())
    expect(shown).toHaveLength(2)
  })

  test("a shown notice is logged too", async () => {
    await engine.handle(finished())
    expect(logs).toEqual(["Notification shown (completed, session root)"])
  })

  test("a throwing logger never blocks the notice", async () => {
    engine = new NotificationEngine({
      directory: DIR,
      settings: () => settings,
      ui: () => ui,
      notifier: { show: (n) => void shown.push(n), dismiss: () => undefined },
      session: (id) => sessions[id],
      shellSession: () => undefined,
      log: () => {
        throw new Error("log broke")
      },
    })
    await engine.handle(finished())
    expect(shown).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ controller */

const session = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory: "/w" }, ...extra })

function fakeServer() {
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  return {
    location: { get: unsupported },
    session: {
      list: async (q?: { parentID?: string | null }) => ({ data: q?.parentID ? [session("ses_kid", { parentID: q.parentID })] : [session("ses_a")] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID),
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
}

async function ready(onEvent: (ev: any) => void) {
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w", onEvent })
  ;(ctl as any).client = fakeServer()
  await ctl.sync()
  return ctl
}

describe("controller hands every event to the notifier", () => {
  test("listsSession: a listed root and its worker, not a stranger", async () => {
    const ctl = await ready(() => undefined)
    expect(ctl.listsSession("ses_a")).toBe(true)
    expect(ctl.listsSession("ses_nope")).toBe(false)
    ;(ctl as any).children.set("ses_kid", session("ses_kid", { parentID: "ses_a" }))
    expect(ctl.listsSession("ses_kid")).toBe(true)
    ;(ctl as any).children.set("ses_x", session("ses_x", { parentID: "ses_unlisted" }))
    expect(ctl.listsSession("ses_x")).toBe(false)
  })

  test("a failure while updating the view does not swallow the turn-end notification", async () => {
    const seen: string[] = []
    const ctl = await ready((ev) => seen.push(ev.type))
    expect(ctl.currentSessionID).toBe("ses_a")
    ;(ctl as any).feed.apply = () => {
      throw new Error("reducer blew up")
    }
    await expect(ctl.onEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_a" } } as any)).rejects.toThrow(/reducer/)
    expect(seen).toEqual(["session.execution.succeeded"])
  })
})
