import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@occ/core/api"
import { stableOrder } from "@occ/core/stable-order"
import {
  applyFrozenOrder,
  applyOverviewEvent,
  buildOverview,
  emptyOverview,
  filterOverview,
  freezeOrder,
  overviewSets,
  toOverviewSession,
  waitingSessions,
  type OverviewData,
  type OverviewSession,
} from "../../apps/mobile/src/lib/overview"
import type { ProjectLike } from "../../apps/mobile/src/lib/projects"

const project = (id: string, canonical: string, updated: number, name?: string): ProjectLike => ({
  id,
  canonical,
  name,
  time: { created: 1, updated, active: updated },
})

const session = (id: string, directory: string, updated: number, title?: string, over: Partial<SessionInfo["time"]> = {}, outcome?: SessionInfo["outcome"]): SessionInfo =>
  ({
    id,
    projectID: "p",
    title,
    location: { directory },
    outcome,
    time: { created: updated, updated, ...over },
  }) as SessionInfo

const data = (over: Partial<OverviewData> = {}): OverviewData => ({ ...emptyOverview(), ...over })

const waitingFor = (ids: string[]): Record<string, string[]> => Object.fromEntries(ids.map((id) => [id, ["request"]]))

/** The raw server records turned into what `buildOverview` reads. */
const rows = (...list: SessionInfo[]): OverviewSession[] => list.map(toOverviewSession)

describe("overview grouping", () => {
  test("a project folder groups its sessions; a folder no project knows still gets a group named after it", () => {
    const groups = buildOverview(
      data({
        projects: [project("a", "/work/app", 50, "The App")],
        sessions: rows(session("s1", "/work/app", 30, "One"), session("s2", "/other/tool", 20, "Two")),
      }),
    )
    expect(groups.map((g) => g.directory)).toEqual(["/work/app", "/other/tool"])
    expect(groups[0]).toMatchObject({ title: "The App", path: "/work/app" })
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["s1"])
    expect(groups[1]).toMatchObject({ title: "tool" })
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(["s2"])
  })

  test("a project without sessions is still listed (the drawer shows the empty group)", () => {
    const groups = buildOverview(data({ projects: [project("a", "/work/empty", 10)] }))
    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions).toEqual([])
  })

  test("folder matching ignores a trailing slash and the path spelling rules of sameDirectory", () => {
    const groups = buildOverview(
      data({
        projects: [project("a", "/work/app/", 5)],
        sessions: rows(session("s1", "/work/app", 10, "One")),
      }),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["s1"])
  })

  test("an archived session is not a drawer row", () => {
    const groups = buildOverview(
      data({
        projects: [project("a", "/work/app", 1)],
        sessions: rows(session("old", "/work/app", 10, "Old", { archived: 10 }), session("new", "/work/app", 5, "New")),
      }),
    )
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["new"])
  })

  test("the authoritative project name from the Projects screen wins over the list's fallback", () => {
    const groups = buildOverview(data({ projects: [project("a", "/work/app", 1)], sessions: rows(session("s1", "/work/app", 1)) }), {
      resolved: new Map([["/work/app", "a"]]),
      titles: new Map([["/work/app", "Authoritative"]]),
    })
    expect(groups[0]?.title).toBe("Authoritative")
  })
})

describe("overview order", () => {
  test("waiting first, then running, then the newest; the shared rule orders sessions", () => {
    const groups = buildOverview(
      data({
        projects: [project("a", "/work/app", 1)],
        sessions: rows(
          session("newest", "/work/app", 100, "Newest"),
          session("running-old", "/work/app", 10, "Running old"),
          session("waiting", "/work/app", 5, "Waiting"),
          session("running-new", "/work/app", 20, "Running new"),
        ),
        running: ["running-old", "running-new"],
        permissions: waitingFor(["waiting"]),
      }),
    )
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["waiting", "running-new", "running-old", "newest"])
    expect(groups[0]?.state).toBe("waiting")
  })

  test("projects follow the same rule: waiting, running, then newest activity; the project's own stamp counts", () => {
    const groups = buildOverview(
      data({
        projects: [project("a", "/idle", 1000), project("b", "/run", 1), project("c", "/wait", 1)],
        sessions: rows(session("s1", "/run", 10), session("s2", "/wait", 20), session("s3", "/idle", 30)),
        running: ["s1"],
        permissions: waitingFor(["s2"]),
      }),
    )
    expect(groups.map((g) => g.directory)).toEqual(["/wait", "/run", "/idle"])
  })

  test("ties fall back to the title, then the folder", () => {
    const groups = buildOverview(data({ projects: [project("a", "/b", 10, "Same"), project("b", "/a", 10, "same")] }))
    expect(groups.map((g) => g.directory)).toEqual(["/a", "/b"])
  })

  test("search keeps a project when its name matches, and only matching sessions when it does not", () => {
    const groups = buildOverview(
      data({
        projects: [project("a", "/work/alpha", 10, "Alpha"), project("b", "/work/beta", 5, "Beta")],
        sessions: rows(session("s1", "/work/alpha", 10, "Fix the login"), session("s2", "/work/alpha", 9, "Something else"), session("s3", "/work/beta", 5, "Login page")),
      }),
    )
    const byProject = filterOverview(groups, "alph")
    expect(byProject.map((g) => g.directory)).toEqual(["/work/alpha"])
    expect(byProject[0]?.sessions).toHaveLength(2)
    const bySession = filterOverview(groups, "login")
    expect(bySession.map((g) => g.directory)).toEqual(["/work/alpha", "/work/beta"])
    expect(bySession[0]?.sessions.map((s) => s.id)).toEqual(["s1"])
    expect(bySession[1]?.sessions.map((s) => s.id)).toEqual(["s3"])
    expect(filterOverview(groups, "zzz")).toEqual([])
  })
})

describe("waiting and running derivation", () => {
  test("a session is waiting while it has an open permission or form, and running only while in the running set", () => {
    const sets = overviewSets({ running: ["run"], permissions: waitingFor(["perm"]), forms: { form: ["f"] } })
    expect([...sets.waiting].sort()).toEqual(["form", "perm"])
    expect([...sets.running]).toEqual(["run"])
  })

  test("an empty list under a session is not waiting", () => {
    expect(waitingSessions({ permissions: { a: [] }, forms: {} }).size).toBe(0)
  })
})

describe("status and unread", () => {
  test("a row's status comes from the outcome and the view stamp; the group shows the highest", () => {
    const groups = buildOverview(
      data({
        projects: [project("a", "/work/app", 1)],
        sessions: rows(
          session("fail", "/work/app", 40, "Fail", { idle: 40 }, "failed"),
          session("new", "/work/app", 30, "New", { idle: 30 }, "succeeded"),
          session("seen", "/work/app", 20, "Seen", { idle: 20, viewed: 20 }, "succeeded"),
        ),
      }),
    )
    expect(groups[0]?.sessions.map((s) => [s.id, s.status])).toEqual([
      ["fail", "failed"],
      ["new", "unread"],
      ["seen", "read"],
    ])
    expect(groups[0]?.status).toBe("failed")
    expect(groups[0]?.unread).toBe(1)
  })
})

describe("live events", () => {
  const base = () =>
    data({
      projects: [project("a", "/work/app", 1)],
      sessions: [toOverviewSession(session("s1", "/work/app", 10, "One"))],
    })

  test("a root session.created adds a row; a child is ignored", () => {
    const root = applyOverviewEvent(base(), { type: "session.created", created: 20, data: { sessionID: "s2", location: { directory: "/work/app" }, title: "Two" } })
    expect(root.state.sessions.map((s) => s.id)).toEqual(["s1", "s2"])
    const child = applyOverviewEvent(base(), { type: "session.created", created: 20, data: { sessionID: "c1", parentID: "s1", location: { directory: "/work/app" } } })
    expect(child.state.sessions.map((s) => s.id)).toEqual(["s1"])
  })

  test("renamed, archived and deleted", () => {
    const renamed = applyOverviewEvent(base(), { type: "session.renamed", data: { sessionID: "s1", title: "  Renamed  " } })
    expect(renamed.state.sessions[0]?.title).toBe("Renamed")
    const archived = applyOverviewEvent(base(), { type: "session.archived", data: { sessionID: "s1" } })
    expect(buildOverview(archived.state)[0]?.sessions).toEqual([])
    const unarchived = applyOverviewEvent(archived.state, { type: "session.unarchived", data: { sessionID: "s1" } })
    expect(buildOverview(unarchived.state)[0]?.sessions.map((s) => s.id)).toEqual(["s1"])
    const unknown = applyOverviewEvent(base(), { type: "session.unarchived", data: { sessionID: "gone" } })
    expect(unknown.refetch).toBe(true)
    const deleted = applyOverviewEvent({ ...base(), running: ["s1"], permissions: waitingFor(["s1"]) }, { type: "session.deleted", data: { sessionID: "s1" } })
    expect(deleted.state.sessions).toEqual([])
    expect(deleted.state.running).toEqual([])
    expect(deleted.state.permissions).toEqual({})
  })

  test("execution events drive the running set and the activity stamp", () => {
    const started = applyOverviewEvent(base(), { type: "session.execution.started", created: 30, data: { sessionID: "s1" } })
    expect(started.state.running).toEqual(["s1"])
    expect(started.state.sessions[0]?.time.busy).toBe(30)
    const done = applyOverviewEvent(started.state, { type: "session.execution.succeeded", created: 40, data: { sessionID: "s1" } })
    expect(done.state.running).toEqual([])
    expect(done.state.sessions[0]?.time.updated).toBe(40)
    expect(done.state.sessions[0]?.time.busy).toBeUndefined()
  })

  test("a finished turn records its outcome and idle stamp, so the row can show failed or unread", () => {
    const done = applyOverviewEvent(base(), { type: "session.execution.succeeded", created: 40, data: { sessionID: "s1" } })
    expect(done.state.sessions[0]?.outcome).toBe("succeeded")
    expect(done.state.sessions[0]?.time.idle).toBe(40)
    expect(buildOverview(done.state)[0]?.sessions[0]?.status).toBe("unread")
    const failed = applyOverviewEvent(base(), { type: "session.execution.failed", created: 40, data: { sessionID: "s1" } })
    expect(failed.state.sessions[0]?.outcome).toBe("failed")
    expect(buildOverview(failed.state)[0]?.sessions[0]?.status).toBe("failed")
    const stopped = applyOverviewEvent(base(), { type: "session.execution.interrupted", created: 40, data: { sessionID: "s1" } })
    expect(stopped.state.sessions[0]?.outcome).toBe("interrupted")
    expect(buildOverview(stopped.state)[0]?.sessions[0]?.status).toBe("unread")
  })

  test("session.viewed marks the finished turn seen without moving the row or its activity stamp", () => {
    const done = applyOverviewEvent(base(), { type: "session.execution.succeeded", created: 40, data: { sessionID: "s1" } })
    expect(buildOverview(done.state)[0]?.sessions[0]?.status).toBe("unread")
    const updated = done.state.sessions[0]!.time.updated
    const viewed = applyOverviewEvent(done.state, { type: "session.viewed", data: { sessionID: "s1", idle: 40 } })
    expect(viewed.state.sessions[0]?.time.viewed).toBe(40)
    expect(viewed.state.sessions[0]?.time.updated).toBe(updated)
    expect(buildOverview(viewed.state)[0]?.sessions[0]?.status).toBe("read")
    // A late view stamp never moves `viewed` backwards.
    const stale = applyOverviewEvent(viewed.state, { type: "session.viewed", data: { sessionID: "s1", idle: 20 } })
    expect(stale.state.sessions[0]?.time.viewed).toBe(40)
    // Without an idle stamp there is nothing to mark, and the state object is reused.
    const missing = applyOverviewEvent(done.state, { type: "session.viewed", data: { sessionID: "s1" } })
    expect(missing.state).toBe(done.state)
  })

  test("session.status busy/retry runs, idle stops; session.idle stops too", () => {
    const busy = applyOverviewEvent(base(), { type: "session.status", created: 30, data: { sessionID: "s1", status: { type: "busy" } } })
    expect(busy.state.running).toEqual(["s1"])
    const retry = applyOverviewEvent(base(), { type: "session.status", created: 30, data: { sessionID: "s1", status: { type: "retry" } } })
    expect(retry.state.running).toEqual(["s1"])
    const idle = applyOverviewEvent(busy.state, { type: "session.status", created: 40, data: { sessionID: "s1", status: { type: "idle" } } })
    expect(idle.state.running).toEqual([])
    const stopped = applyOverviewEvent(busy.state, { type: "session.idle", created: 40, data: { sessionID: "s1" } })
    expect(stopped.state.running).toEqual([])
  })

  test("permission and form events fill and empty the waiting sets", () => {
    const asked = applyOverviewEvent(base(), { type: "permission.asked", data: { id: "p1", sessionID: "s1" } })
    expect(waitingSessions(asked.state)).toEqual(new Set(["s1"]))
    const replied = applyOverviewEvent(asked.state, { type: "permission.replied", data: { sessionID: "s1", requestID: "p1" } })
    expect(waitingSessions(replied.state).size).toBe(0)

    const form = applyOverviewEvent(base(), { type: "form.created", data: { form: { id: "f1", sessionID: "s1" } } })
    expect(waitingSessions(form.state)).toEqual(new Set(["s1"]))
    const cancelled = applyOverviewEvent(form.state, { type: "form.cancelled", data: { id: "f1", sessionID: "s1" } })
    expect(waitingSessions(cancelled.state).size).toBe(0)
  })

  test("project.updated renames the project", () => {
    const renamed = applyOverviewEvent(base(), { type: "project.updated", data: { id: "a", canonical: "/work/app", name: "New name", time: { created: 1, updated: 1, active: 1 } } })
    expect(buildOverview(renamed.state)[0]?.title).toBe("New name")
  })

  test("server.connected asks for a fresh snapshot; an unknown event keeps the same state object", () => {
    const current = base()
    expect(applyOverviewEvent(current, { type: "server.connected" }).refetch).toBe(true)
    expect(applyOverviewEvent(current, { type: "session.text.delta", data: {} }).state).toBe(current)
  })
})

describe("stable order while the drawer is open", () => {
  test("ids already listed keep their place; new ids slot in by the shared order", () => {
    expect(stableOrder([], ["a", "b"])).toEqual(["a", "b"])
    expect(stableOrder(["a", "b", "c"], ["b", "a", "c"])).toEqual(["a", "b", "c"])
    expect(stableOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"])
    expect(stableOrder(["a", "c"], ["a", "b", "c"])).toEqual(["a", "b", "c"])
    expect(stableOrder(["a", "b"], ["n", "a", "b"])).toEqual(["n", "a", "b"])
    expect(stableOrder(["a", "b"], ["a", "b", "n"])).toEqual(["a", "b", "n"])
    expect(stableOrder(["a"], ["n2", "a", "n1"])).toEqual(["n2", "a", "n1"])
  })

  test("a project that becomes running while open keeps its row; only its dot changes", () => {
    const projects = [project("a", "/a", 10, "A"), project("b", "/b", 20, "B")]
    const sessions = [session("s1", "/a", 10), session("s2", "/b", 20)]
    const before = buildOverview(data({ projects, sessions: rows(...sessions) }))
    expect(before.map((g) => g.directory)).toEqual(["/b", "/a"])
    const frozen = freezeOrder(before)
    const after = buildOverview(data({ projects, sessions: rows(...sessions), running: ["s1"] }))
    expect(after.map((g) => g.directory)).toEqual(["/a", "/b"])
    const held = applyFrozenOrder(after, frozen)
    expect(held.map((g) => g.directory)).toEqual(["/b", "/a"])
    expect(held.find((g) => g.directory === "/a")?.state).toBe("running")
  })

  test("a project that appears after the freeze is inserted, and the rest keep their relative order", () => {
    const before = buildOverview(data({ projects: [project("a", "/a", 10, "A"), project("b", "/b", 20, "B")], sessions: rows(session("s1", "/a", 10), session("s2", "/b", 20)) }))
    const frozen = freezeOrder(before)
    const after = buildOverview(
      data({
        projects: [project("a", "/a", 10, "A"), project("b", "/b", 20, "B"), project("c", "/c", 30, "C")],
        sessions: rows(session("s1", "/a", 10), session("s2", "/b", 20), session("s3", "/c", 30)),
      }),
    )
    expect(after.map((g) => g.directory)).toEqual(["/c", "/b", "/a"])
    expect(applyFrozenOrder(after, frozen).map((g) => g.directory)).toEqual(["/c", "/b", "/a"])
  })

  test("sessions inside a project are held too: a new one slots in at its position, a removed one disappears", () => {
    const projects = [project("a", "/a", 1, "A")]
    const before = buildOverview(data({ projects, sessions: rows(session("s1", "/a", 10, "One"), session("s2", "/a", 5, "Two")) }))
    expect(before[0]?.sessions.map((s) => s.id)).toEqual(["s1", "s2"])
    const frozen = freezeOrder(before)
    const added = buildOverview(data({ projects, sessions: rows(session("s1", "/a", 10, "One"), session("s3", "/a", 7, "Three"), session("s2", "/a", 5, "Two")) }))
    expect(added[0]?.sessions.map((s) => s.id)).toEqual(["s1", "s3", "s2"])
    expect(applyFrozenOrder(added, frozen)[0]?.sessions.map((s) => s.id)).toEqual(["s1", "s3", "s2"])
    const removed = buildOverview(data({ projects, sessions: rows(session("s3", "/a", 7, "Three"), session("s2", "/a", 5, "Two")) }))
    expect(applyFrozenOrder(removed, frozen)[0]?.sessions.map((s) => s.id)).toEqual(["s3", "s2"])
  })
})
