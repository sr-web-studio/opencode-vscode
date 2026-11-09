import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@occ/core/api"
import { buildTree, type FolderInput, type ProjectNode, type SessionNode, type TreeLayout } from "../../apps/vscode/src/extension/sessions-tree-model"

const now = new Date(2026, 10, 9, 12, 0, 0).getTime()
const m = 60_000
const h = 3_600_000
const d = 24 * h

const s = (id: string, updated: number, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, cost: 0, tokens: {} as any, time: { created: updated, updated }, location: { directory: "/p" }, projectID: "p", ...extra }) as SessionInfo

function folder(directory: string, over: Partial<Omit<FolderInput, "directory">> = {}): FolderInput {
  return {
    directory,
    name: directory.split("/").pop() || directory,
    displayPath: directory,
    active: false,
    sessions: [],
    running: new Set(),
    waiting: new Set(),
    loaded: true,
    ...over,
  }
}

function sessions(layout: TreeLayout): SessionNode[] {
  if (layout.kind === "sessions") return layout.sessions
  if (layout.kind === "projects") return layout.projects.flatMap((project) => project.sessions)
  return []
}

function projects(layout: TreeLayout): ProjectNode[] {
  return layout.kind === "projects" ? layout.projects : []
}

describe("sessions tree layout", () => {
  test("no workspace folder: a message, no nodes", () => {
    expect(buildTree([], now)).toEqual({ kind: "empty" })
  })

  test("one folder: a flat list of its root sessions, never workers or archived ones", () => {
    const layout = buildTree(
      [
        folder("/p", {
          active: true,
          sessions: [
            s("idle-new", now - m, { title: "Idle new" }),
            s("waiting-old", now - 5 * h, { title: "Waiting old" }),
            s("running", now - 2 * h, { title: "Running" }),
            s("child", now, { parentID: "running" }),
            s("archived", now, { time: { created: now, updated: now, archived: now } }),
            s("untitled", now - 3 * h),
          ],
          running: new Set(["running"]),
          waiting: new Set(["waiting-old"]),
          currentID: "idle-new",
        }),
      ],
      now,
    )
    expect(layout.kind).toBe("sessions")
    expect(sessions(layout).map((row) => row.id)).toEqual(["waiting-old", "running", "idle-new", "untitled"])
    expect(sessions(layout).map((row) => row.state)).toEqual(["waiting", "running", "idle", "idle"])
    expect(sessions(layout)[2]!.current).toBe(true)
    expect(sessions(layout)[3]!.title).toBe("Untitled session")
  })

  test("two or more folders: one node per folder, placed by the same rule", () => {
    const layout = buildTree(
      [
        folder("/a", { name: "alpha", sessions: [s("waiting", now - 10 * h, { title: "Waiting" })], waiting: new Set(["waiting"]) }),
        folder("/b", { name: "beta", projectName: "Bravo Project", sessions: [s("running", now - h, { title: "Running" })], running: new Set(["running"]) }),
        folder("/c", { name: "gamma", sessions: [s("idle", now, { title: "Idle" })], active: true }),
        folder("/d", { name: "delta" }),
      ],
      now,
    )
    expect(layout.kind).toBe("projects")
    expect(projects(layout).map((project) => project.directory)).toEqual(["/a", "/b", "/c", "/d"])
    expect(projects(layout).map((project) => project.state)).toEqual(["waiting", "running", "idle", "idle"])
    expect(projects(layout).map((project) => project.name)).toEqual(["alpha", "Bravo Project", "gamma", "delta"])
    expect(projects(layout).map((project) => project.expanded)).toEqual([false, false, true, false])
  })

  test("a project's state is the highest state of its sessions; its last activity is the newest", () => {
    const layout = buildTree(
      [
        folder("/urgent", {
          name: "urgent",
          sessions: [s("idle-old", now - 20 * h, { title: "Old" }), s("waiting-old", now - 10 * h, { title: "Blocked" })],
          waiting: new Set(["waiting-old"]),
        }),
        folder("/recent", { name: "recent", sessions: [s("running-new", now - h, { title: "Fresh" })], running: new Set(["running-new"]) }),
      ],
      now,
    )
    const [first, second] = projects(layout)
    expect(first!.directory).toBe("/urgent")
    expect(first!.state).toBe("waiting")
    expect(first!.last).toBe(now - 10 * h)
    expect(second!.state).toBe("running")
    expect(second!.last).toBe(now - h)
  })

  test("idle projects fall back to the newest session, then the project name", () => {
    const layout = buildTree(
      [
        folder("/old", { name: "Old", sessions: [s("o", now - 2 * d)] }),
        folder("/new", { name: "New", sessions: [s("n", now - h)] }),
        folder("/same-b", { name: "Beta", sessions: [s("b", now - h)] }),
        folder("/same-a", { name: "Alpha", sessions: [s("a", now - h)] }),
      ],
      now,
    )
    expect(projects(layout).map((project) => project.name)).toEqual(["Alpha", "Beta", "New", "Old"])
  })

  test("only the active folder's current session is marked", () => {
    const layout = buildTree([folder("/a", { name: "a", sessions: [s("one", now)], currentID: "one" }), folder("/b", { name: "b", sessions: [s("two", now)], currentID: "two", active: true })], now)
    expect(sessions(layout).map((row) => [row.id, row.current])).toEqual([
      ["one", false],
      ["two", true],
    ])
  })

  test("short relative time under a title", () => {
    const layout = buildTree(
      [
        folder("/p", {
          sessions: [s("now", now), s("5m", now - 5 * m), s("2h", now - 2 * h), s("3d", now - 3 * d)],
        }),
      ],
      now,
    )
    expect(sessions(layout).map((row) => row.description)).toEqual(["now", "5m", "2h", "3d"])
  })
})
