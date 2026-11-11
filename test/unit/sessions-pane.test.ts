import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { SessionInfo } from "@occ/core/api"
import type { FolderInfo, FolderSessions } from "@occ/core/protocol"
import {
  PANE_WIDTH,
  PANE_WIDE_MIN,
  applyPaneOrder,
  buildPane,
  filterPane,
  freezePane,
  paneFolders,
  paneMode,
  type PaneFolder,
  type PaneLayout,
  type PaneProject,
  type PaneRow,
  type PaneSession,
  type PaneState,
} from "@occ/core/sessions-pane"

const now = new Date(2026, 10, 9, 12, 0, 0).getTime()
const m = 60_000
const h = 3_600_000
const d = 24 * h

const session = (id: string, updated: number, extra: Partial<PaneSession> = {}): PaneSession => ({
  id,
  time: { created: updated, updated },
  ...extra,
})

/** The app state carries the full server record, not the pane's light session. */
const fullSession = (id: string, updated: number, title?: string): SessionInfo => ({ id, projectID: "p", title, location: { directory: "/p" }, time: { created: updated, updated } }) as SessionInfo

function folder(directory: string, over: Partial<Omit<PaneFolder, "directory">> = {}): PaneFolder {
  return {
    directory,
    name: directory.split("/").pop() || directory,
    active: false,
    sessions: [],
    running: new Set(),
    waiting: new Set(),
    workers: new Map(),
    loaded: true,
    ...over,
  }
}

function rows(layout: PaneLayout): PaneRow[] {
  if (layout.kind === "sessions") return layout.sessions
  if (layout.kind === "projects") return layout.projects.flatMap((project) => project.sessions)
  return []
}

function projects(layout: PaneLayout): PaneProject[] {
  return layout.kind === "projects" ? layout.projects : []
}

const folderInfo = (directory: string, name: string, over: Partial<FolderInfo> = {}): FolderInfo => ({
  directory,
  name,
  displayPath: directory,
  active: false,
  ...over,
})

function state(over: Partial<PaneState> = {}): PaneState {
  return {
    folders: [folderInfo("/p", "p", { active: true })],
    directory: "/p",
    folderName: "p",
    projectName: undefined,
    sessions: [],
    archived: [],
    showArchived: false,
    running: [],
    waiting: [],
    workerRunning: {},
    target: { kind: "draft" },
    sessionsLoaded: true,
    ...over,
  }
}

describe("sessions pane layout", () => {
  test("no workspace folder: a message, no rows", () => {
    expect(buildPane([], now)).toEqual({ kind: "empty" })
  })

  test("one folder: a flat list in the shared order, never workers or archived sessions", () => {
    const layout = buildPane(
      [
        folder("/p", {
          active: true,
          sessions: [
            session("idle-new", now - m, { title: "Idle new" }),
            session("waiting-old", now - 5 * h, { title: "Waiting old" }),
            session("running", now - 2 * h, { title: "Running" }),
            session("child", now, { parentID: "running" }),
            session("archived", now, { time: { created: now, updated: now, archived: now } }),
            session("untitled", now - 3 * h),
          ],
          running: new Set(["running"]),
          waiting: new Set(["waiting-old"]),
          currentID: "idle-new",
        }),
      ],
      now,
    )
    expect(layout.kind).toBe("sessions")
    expect(rows(layout).map((row) => row.id)).toEqual(["waiting-old", "running", "idle-new", "untitled"])
    expect(rows(layout).map((row) => row.state)).toEqual(["waiting", "running", "idle", "idle"])
    expect(rows(layout)[2]!.current).toBe(true)
    expect(rows(layout)[3]!.title).toBe("Untitled session")
    expect(rows(layout).map((row) => row.directory)).toEqual(["/p", "/p", "/p", "/p"])
  })

  test("short relative time after the title", () => {
    const layout = buildPane([folder("/p", { sessions: [session("now", now), session("5m", now - 5 * m), session("2h", now - 2 * h), session("3d", now - 3 * d)] })], now)
    expect(rows(layout).map((row) => row.description)).toEqual(["now", "5m", "2h", "3d"])
  })

  test("two or more folders: one group per folder, placed by the same rule", () => {
    const layout = buildPane(
      [
        folder("/a", { name: "alpha", sessions: [session("waiting", now - 10 * h, { title: "Waiting" })], waiting: new Set(["waiting"]) }),
        folder("/b", { name: "beta", projectName: "Bravo Project", sessions: [session("running", now - h, { title: "Running" })], running: new Set(["running"]) }),
        folder("/c", { name: "gamma", sessions: [session("idle", now, { title: "Idle" })], active: true }),
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
    const layout = buildPane(
      [
        folder("/urgent", {
          name: "urgent",
          sessions: [session("idle-old", now - 20 * h, { title: "Old" }), session("waiting-old", now - 10 * h, { title: "Blocked" })],
          waiting: new Set(["waiting-old"]),
        }),
        folder("/recent", { name: "recent", sessions: [session("running-new", now - h, { title: "Fresh" })], running: new Set(["running-new"]) }),
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
    const layout = buildPane(
      [
        folder("/old", { name: "Old", sessions: [session("o", now - 2 * d)] }),
        folder("/new", { name: "New", sessions: [session("n", now - h)] }),
        folder("/same-b", { name: "Beta", sessions: [session("b", now - h)] }),
        folder("/same-a", { name: "Alpha", sessions: [session("a", now - h)] }),
      ],
      now,
    )
    expect(projects(layout).map((project) => project.name)).toEqual(["Alpha", "Beta", "New", "Old"])
  })

  test("only the active folder's current session is marked", () => {
    const layout = buildPane(
      [folder("/a", { name: "a", sessions: [session("one", now)], currentID: "one" }), folder("/b", { name: "b", sessions: [session("two", now)], currentID: "two", active: true })],
      now,
    )
    expect(rows(layout).map((row) => [row.id, row.current])).toEqual([
      ["one", false],
      ["two", true],
    ])
  })
})

describe("pane status and archive", () => {
  test("a row's icon comes from the outcome and the view stamp; the order still uses the activity state", () => {
    const layout = buildPane(
      [
        folder("/p", {
          active: true,
          sessions: [
            session("waiting", now - 10 * h, { title: "Blocked" }),
            session("failed", now - 5 * h, { title: "Failed", time: { created: now - 5 * h, updated: now - 5 * h, idle: now - 5 * h }, outcome: "failed" }),
            session("unread", now - h, { title: "New", time: { created: now - h, updated: now - h, idle: now - h }, outcome: "succeeded" }),
            session("read", now, { title: "Read", time: { created: now, updated: now, idle: now, viewed: now }, outcome: "succeeded" }),
          ],
          waiting: new Set(["waiting"]),
        }),
      ],
      now,
    )
    expect(rows(layout).map((row) => row.id)).toEqual(["waiting", "read", "unread", "failed"])
    expect(rows(layout).map((row) => row.status)).toEqual(["waiting", "read", "unread", "failed"])
    expect(rows(layout).map((row) => row.state)).toEqual(["waiting", "idle", "idle", "idle"])
  })

  test("a project shows its most urgent status and counts only unread sessions", () => {
    const layout = buildPane(
      [
        folder("/a", {
          name: "a",
          sessions: [
            session("fail", now - h, { time: { created: now - h, updated: now - h, idle: now - h }, outcome: "failed" }),
            session("new1", now - 2 * h, { time: { created: now - 2 * h, updated: now - 2 * h, idle: now - 2 * h }, outcome: "succeeded" }),
            session("new2", now - 3 * h, { time: { created: now - 3 * h, updated: now - 3 * h, idle: now - 3 * h }, outcome: "interrupted" }),
            session("seen", now - 4 * h, { time: { created: now - 4 * h, updated: now - 4 * h, idle: now - 4 * h, viewed: now - 4 * h }, outcome: "succeeded" }),
          ],
        }),
        folder("/b", { name: "b" }),
      ],
      now,
    )
    const [first, second] = projects(layout)
    expect(first!.directory).toBe("/a")
    expect(first!.status).toBe("failed")
    expect(first!.unread).toBe(2)
    expect(second!.status).toBe("read")
    expect(second!.unread).toBe(0)
  })

  test("archived sessions stay out until the folder includes them, then they are marked", () => {
    const old = session("old", now - h, { title: "Old", time: { created: now - h, updated: now - h, archived: now - h } })
    const live = session("live", now, { title: "Live" })
    expect(rows(buildPane([folder("/p", { sessions: [old, live] })], now)).map((row) => row.id)).toEqual(["live"])
    const shown = buildPane([folder("/p", { sessions: [old, live], includeArchived: true })], now)
    expect(rows(shown).map((row) => [row.id, row.archived])).toEqual([
      ["live", false],
      ["old", true],
    ])
  })
})

describe("pane folder inputs", () => {
  const light = (directory: string, sessions: PaneSession[], over: Partial<FolderSessions> = {}): FolderSessions => ({
    directory,
    sessions,
    running: [],
    waiting: [],
    workerRunning: {},
    loaded: true,
    ...over,
  })

  test("a single folder window reads everything from the app state", () => {
    const folders = paneFolders(state({ sessions: [fullSession("a", now, "A")], running: ["a"], target: { kind: "session", id: "a" }, projectName: "Project" }), [])
    expect(folders).toHaveLength(1)
    expect(folders[0]).toMatchObject({ directory: "/p", name: "p", projectName: "Project", active: true, currentID: "a", loaded: true })
    expect([...folders[0]!.running]).toEqual(["a"])
    expect(folders[0]!.sessions.map((s) => s.id)).toEqual(["a"])
  })

  test("Show archived merges the active folder's archived list and leaves other folders alone", () => {
    const folders = paneFolders(
      state({
        folders: [folderInfo("/p", "p", { active: true }), folderInfo("/q", "q")],
        sessions: [fullSession("live", now)],
        archived: [fullSession("old", now - h)],
        showArchived: true,
      }),
      [light("/q", [session("other", now)])],
    )
    expect(folders[0]!.sessions.map((s) => s.id)).toEqual(["live", "old"])
    expect(folders[0]!.includeArchived).toBe(true)
    expect(folders[1]!.sessions.map((s) => s.id)).toEqual(["other"])
    expect(folders[1]!.includeArchived).toBeUndefined()
  })

  test("Show archived lists a session once when the root list already carries it", () => {
    // The server's root list includes archived sessions; the archived page then answers with the same record.
    const old = { ...fullSession("old", now - h), time: { created: now - h, updated: now - h, archived: now - h } }
    const folders = paneFolders(state({ sessions: [fullSession("live", now), old], archived: [old], showArchived: true }), [])
    expect(folders[0]!.sessions.map((s) => s.id)).toEqual(["live", "old"])
    const shown = rows(buildPane(folders, now)).map((row) => row.id)
    expect(shown).toEqual(["live", "old"])
  })

  test("multi-root: the active folder is fresh from the app state, the others from the light message", () => {
    const folders = paneFolders(
      state({
        folders: [folderInfo("/p", "p", { active: true }), folderInfo("/q", "q", { projectName: "Queue" })],
        sessions: [fullSession("live", now)],
        target: { kind: "session", id: "live" },
      }),
      [light("/p", [session("stale", now)]), light("/q", [session("other", now)], { running: ["other"] })],
    )
    expect(folders.map((f) => f.directory)).toEqual(["/p", "/q"])
    expect(folders[0]!.sessions.map((s) => s.id)).toEqual(["live"])
    expect(folders[0]!.currentID).toBe("live")
    expect(folders[1]!.sessions.map((s) => s.id)).toEqual(["other"])
    expect([...folders[1]!.running]).toEqual(["other"])
    expect(folders[1]!.projectName).toBe("Queue")
    expect(folders[1]!.currentID).toBeUndefined()
  })

  test("a folder the host has not posted yet is empty and still loading, never invented", () => {
    const folders = paneFolders(state({ folders: [folderInfo("/p", "p", { active: true }), folderInfo("/q", "q")] }), [])
    expect(folders[1]).toMatchObject({ directory: "/q", sessions: [], loaded: false })
    expect(folders[1]!.running.size).toBe(0)
    expect(folders[1]!.waiting.size).toBe(0)
  })

  test("another folder's status reads its light record, outcome included", () => {
    const failed = { ...session("broke", now - 2 * m), outcome: "failed" as const, time: { created: now - 2 * m, updated: now - 2 * m, idle: now - 2 * m } }
    // No view stamp and a turn older than the window: an upgrade must not light up the whole history.
    const old = { ...session("old", now - 2 * d), outcome: "succeeded" as const, time: { created: now - 2 * d, updated: now - 2 * d, idle: now - 2 * d } }
    const fresh = { ...session("fresh", now - m), outcome: "succeeded" as const, time: { created: now - m, updated: now - m, idle: now - m } }
    const folders = paneFolders(state({ folders: [folderInfo("/p", "p", { active: true }), folderInfo("/q", "q")] }), [light("/q", [failed, old, fresh])])
    expect(rows(buildPane(folders, now)).map((row) => [row.id, row.status])).toEqual([
      ["fresh", "unread"],
      ["broke", "failed"],
      ["old", "read"],
    ])
  })

  test("a root's running workers reach its row without changing its state or its place", () => {
    const folders = paneFolders(
      state({
        sessions: [fullSession("a", now), fullSession("b", now + m)],
        running: ["kid"],
        workerRunning: { a: 2 },
        target: { kind: "session", id: "b" },
      }),
      [],
    )
    const layout = buildPane(folders, now)
    expect(rows(layout).map((row) => [row.id, row.state, row.workers])).toEqual([
      ["b", "idle", 0],
      ["a", "idle", 2],
    ])
  })

  test("a project header sums its sessions' workers, read from the light message too", () => {
    const folders = paneFolders(state({ folders: [folderInfo("/p", "p", { active: true }), folderInfo("/q", "q")] }), [light("/q", [session("q1", now)], { running: ["k"], workerRunning: { q1: 1 } })])
    const [project] = projects(buildPane(folders, now))
    expect(project).toMatchObject({ directory: "/q", workers: 1 })
    expect(project?.sessions[0]).toMatchObject({ id: "q1", workers: 1 })
  })
})

describe("pane search", () => {
  const flat = buildPane(
    [
      folder("/p", {
        sessions: [session("one", now, { title: "Fix the parser" }), session("two", now - m, { title: "Write docs" })],
      }),
    ],
    now,
  )

  test("empty query keeps everything", () => {
    expect(filterPane(flat, "  ")).toBe(flat)
  })

  test("case-insensitive title match in the flat list", () => {
    expect(rows(filterPane(flat, "PARSER")).map((row) => row.id)).toEqual(["one"])
    expect(rows(filterPane(flat, "nothing")).map((row) => row.id)).toEqual([])
  })

  test("a project name match keeps all of its sessions; a session match narrows the group", () => {
    const layout = buildPane(
      [
        folder("/alpha", { name: "Alpha", sessions: [session("a1", now, { title: "One" }), session("a2", now - m, { title: "Two" })] }),
        folder("/beta", { name: "Beta", sessions: [session("b1", now, { title: "Other" })] }),
      ],
      now,
    )
    expect(projects(filterPane(layout, "alpha")).map((p) => [p.directory, p.sessions.map((s) => s.id)])).toEqual([["/alpha", ["a1", "a2"]]])
    expect(projects(filterPane(layout, "two")).map((p) => [p.directory, p.sessions.map((s) => s.id)])).toEqual([["/alpha", ["a2"]]])
    expect(projects(filterPane(layout, "missing"))).toEqual([])
  })

  test("a directory match keeps the whole project", () => {
    const layout = buildPane([folder("/alpha", { name: "Alpha", sessions: [session("a1", now)] }), folder("/beta", { name: "Beta" })], now)
    expect(projects(filterPane(layout, "/beta")).map((p) => p.directory)).toEqual(["/beta"])
  })
})

describe("pane stable order", () => {
  test("a row that becomes urgent stays where it was while the pane is open", () => {
    const open = buildPane(
      [
        folder("/p", {
          sessions: [session("a", now, { title: "A" }), session("b", now - h, { title: "B" })],
        }),
      ],
      now,
    )
    expect(rows(open).map((row) => row.id)).toEqual(["a", "b"])
    const frozen = freezePane(open)
    const live = buildPane([folder("/p", { sessions: [session("a", now, { title: "A" }), session("b", now + m, { title: "B" })], waiting: new Set(["b"]) })], now)
    expect(rows(live).map((row) => row.id)).toEqual(["b", "a"])
    const held = applyPaneOrder(live, frozen)
    expect(rows(held).map((row) => row.id)).toEqual(["a", "b"])
    // The state is live even though the place is held.
    expect(rows(held)[1]!.state).toBe("waiting")
  })

  test("a new session is inserted by the current order; a deleted one disappears", () => {
    const open = buildPane([folder("/p", { sessions: [session("a", now, { title: "A" }), session("c", now - 2 * h, { title: "C" })] })], now)
    const frozen = freezePane(open)
    const live = buildPane([folder("/p", { sessions: [session("a", now, { title: "A" }), session("b", now - h, { title: "B" })] })], now)
    expect(rows(applyPaneOrder(live, frozen)).map((row) => row.id)).toEqual(["a", "b"])
  })

  test("multi-root: projects and their sessions each keep their place", () => {
    const open = buildPane(
      [
        folder("/x", { name: "X", sessions: [session("x1", now, { title: "One" }), session("x2", now - h, { title: "Two" })] }),
        folder("/y", { name: "Y", sessions: [session("y1", now - m, { title: "Three" })] }),
      ],
      now,
    )
    expect(projects(open).map((p) => p.directory)).toEqual(["/x", "/y"])
    const frozen = freezePane(open)
    const live = buildPane(
      [
        folder("/x", { name: "X", sessions: [session("x1", now, { title: "One" }), session("x2", now + m, { title: "Two" })], waiting: new Set(["x2"]) }),
        folder("/y", { name: "Y", sessions: [session("y1", now - m, { title: "Three" })] }),
        folder("/z", { name: "Z", sessions: [session("z1", now + 2 * m, { title: "Four" })], running: new Set(["z1"]) }),
      ],
      now,
    )
    expect(projects(live).map((p) => p.directory)).toEqual(["/x", "/z", "/y"])
    // A new project takes its place by the current order; the known ones keep theirs.
    const held = applyPaneOrder(live, frozen)
    expect(projects(held).map((p) => p.directory)).toEqual(["/x", "/z", "/y"])
    expect(projects(held)[0]!.sessions.map((s) => s.id)).toEqual(["x1", "x2"])
    expect(projects(held)[0]!.state).toBe("waiting")
  })

  test("freezing an empty pane keeps nothing and ordering a message is a no-op", () => {
    expect(freezePane({ kind: "empty" })).toEqual({ projects: [], sessions: {} })
    expect(applyPaneOrder({ kind: "empty" }, { projects: [], sessions: {} })).toEqual({ kind: "empty" })
  })
})

describe("pane mode", () => {
  test("a column from 560px, an overlay below it", () => {
    expect(PANE_WIDE_MIN).toBe(560)
    expect(PANE_WIDTH).toBe(240)
    expect(paneMode(900)).toBe("wide")
    expect(paneMode(560)).toBe("wide")
    expect(paneMode(559)).toBe("overlay")
    expect(paneMode(400)).toBe("overlay")
  })
})

describe("command arguments", () => {
  test("a session row names its session and folder", async () => {
    const { sessionTarget, directoryArg } = await import("../../apps/vscode/src/extension/session-target")
    expect(sessionTarget({ sessionID: "ses_a", directory: "/p" })).toEqual({ sessionID: "ses_a", directory: "/p" })
    expect(sessionTarget({ kind: "session", id: "ses_b", directory: "/q" })).toEqual({ sessionID: "ses_b", directory: "/q" })
    expect(sessionTarget({ sessionID: "ses_c" })).toEqual({ sessionID: "ses_c", directory: undefined })
    expect(sessionTarget(undefined)).toBeUndefined()
    expect(sessionTarget("ses_d")).toBeUndefined()
    expect(directoryArg("/p")).toBe("/p")
    expect(directoryArg({ directory: "/q" })).toBe("/q")
    expect(directoryArg({})).toBeUndefined()
  })
})

describe("sessions pane wiring", () => {
  const protocol = readFileSync("packages/core/src/protocol.ts", "utf8")
  const store = readFileSync("packages/ui/src/store.svelte.ts", "utf8")
  const app = readFileSync("packages/ui/src/App.svelte", "utf8")
  const pane = readFileSync("packages/ui/src/components/SessionsPane.svelte", "utf8")
  const vscodeBridge = readFileSync("apps/vscode/src/webview/vscode-bridge.ts", "utf8")
  const view = readFileSync("apps/vscode/src/extension/view.ts", "utf8")
  const pkg = JSON.parse(readFileSync("apps/vscode/package.json", "utf8"))

  test("the host posts one light message with every folder's root sessions", () => {
    expect(protocol).toContain(`export type FolderSessions = {`)
    expect(protocol).toContain(`{ type: "folderSessions"; folders: FolderSessions[] }`)
    expect(store).toContain(`m.type === "folderSessions"`)
    expect(view).toContain(`this.post({ type: "folderSessions", folders })`)
    // Only a multi-root window needs it; a single folder already arrives in the app state.
    expect(view).toMatch(/if \(list\.length <= 1\) return/)
    // The lists come from the controllers the window already holds, never from a new server call.
    expect(view).toMatch(/controllerAt\(folder\.directory\)\?\.snapshot\(\)/)
  })

  test("the host throttles the folder lists on their own timer", () => {
    expect(view).toContain("private sessionsTimer?")
    expect(view).toMatch(/private scheduleFolderSessions\(\): void \{/)
    expect(view).toMatch(/this\.sessionsTimer = setTimeout\(/)
    expect(view).toMatch(/if \(this\.sessionsTimer\) clearTimeout\(this\.sessionsTimer\)/)
  })

  test("the title-bar toggle is a host command; the webview flips and remembers its own pane", () => {
    expect(protocol).toContain(`{ type: "command"; name: "newSession" | "toggleSessions" }`)
    expect(store).toContain(`m.name === "toggleSessions"`)
    expect(store).toContain("sessionsTick")
    expect(view).toContain(`this.post({ type: "command", name: "toggleSessions" })`)
    expect(app).toContain(`store.bridge.storage.get<boolean>("sessionsPane")`)
    expect(app).toContain(`store.bridge.storage.set("sessionsPane", open)`)
  })

  test("the pane opens a session of any folder, switches folders first, and never calls the server itself", () => {
    expect(protocol).toContain(`{ type: "openSessionInFolder"; sessionID: string; directory?: string }`)
    expect(protocol).toContain(`{ type: "refreshSessions" }`)
    expect(vscodeBridge).toContain(`openSessionInFolder: (sessionID, directory) => host({ type: "openSessionInFolder", sessionID, directory })`)
    expect(vscodeBridge).toContain(`refreshSessions: () => host({ type: "refreshSessions" })`)
    expect(view).toMatch(/this\.folders\.activateForSession\(m\.request\.sessionID, m\.request\.directory\)/)
    expect(view).toMatch(/if \(m\.request\.type === "refreshSessions"\) \{\s+this\.postState\(\)\s+this\.postFolderSessions\(\)/)
    expect(pane).toContain("store.bridge.openSessionInFolder(row.id, row.directory)")
    expect(pane).toContain("store.bridge.refreshSessions()")
  })

  test("delete goes through the one command that owns the modal, with the row's folder", () => {
    expect(protocol).toContain(`{ type: "confirmDeleteSession"; sessionID: string; title?: string; directory?: string }`)
    expect(pane).toContain("store.bridge.confirmDeleteSession(row.id, row.title, row.directory)")
    expect(vscodeBridge).toContain(`confirmDeleteSession: (sessionID, title, directory) => host({ type: "confirmDeleteSession", sessionID, title, directory })`)
    const host = readFileSync("apps/vscode/src/extension/host.ts", "utf8")
    expect(host).toContain(`vscode.commands.executeCommand("opencode.deleteSession", { sessionID, directory })`)
    expect(host).not.toContain("@occ/core/delete-session")
  })

  test("the pane is a VS Code capability: the phone never renders it", async () => {
    const mobile = await import("../../apps/mobile/src/lib/bridge")
    expect(mobile.MOBILE_CAPABILITIES.sessionsPane).toBe(false)
    expect(vscodeBridge).toContain("capabilities: { sessionsPane: true }")
    expect(app).toContain(`store.bridge.capabilities?.sessionsPane !== false`)
    expect(app).toContain("paneAvailable && paneOpen")
  })

  test("the pane's own controls: status icons, current row, keyboard and labels", () => {
    expect(pane).toContain(`<Codicon name="loading" spin />`)
    expect(pane).toContain(`<Codicon name="bell-dot" />`)
    expect(pane).toContain(`<Codicon name="error" />`)
    expect(pane).toContain(`<Codicon name="circle-filled" />`)
    expect(pane).toContain(`<Codicon name="check" />`)
    expect(pane).toContain("statusLabel(row.status)")
    expect(pane).toContain("class:current={row.current}")
    expect(pane).toContain(`tabindex="0"`)
    expect(pane).toContain(`e.key === "ArrowDown"`)
    expect(pane).toContain(`e.key === "ArrowUp"`)
    expect(pane).toContain(`e.key === "Enter"`)
    expect(pane).toContain(`aria-label={rowLabel(row)}`)
    expect(pane).toContain(`row.current ? "current session" : undefined`)
    expect(app).toContain(`e.key === "Escape"`)
  })

  test("a project's + starts a draft there through the host; the pane header's + is gone", () => {
    expect(protocol).toContain(`{ type: "newSessionIn"; directory: string }`)
    expect(vscodeBridge).toContain(`newSessionIn: (directory) => host({ type: "newSessionIn", directory })`)
    expect(view).toMatch(/if \(m\.request\.type === "newSessionIn"\)/)
    expect(view).toMatch(/this\.folders\.setActive\(controller\.folderPath\)/)
    expect(view).toMatch(/await controller\.dispatch\(\{ type: "newDraft", hasText: false \}\)/)
    expect(pane).toContain("store.bridge.newSessionIn(project.directory)")
    expect(pane).toContain(`aria-label="New session in {project.name}"`)
    expect(pane).not.toMatch(/class="icon" onclick=\{newSession\}/)
    expect(pane).toContain(`<span class="text">New session</span>`)
  })

  test("the pane and the drawer show running workers with the shared label and icon", () => {
    expect(protocol).toContain("workerRunning: Record<string, number>")
    expect(view).toContain("workerRunning: state?.workerRunning ?? {}")
    expect(pane).toContain(`<Codicon name="organization" />`)
    expect(pane).toContain("workerLabel(row.workers)")
    expect(pane).toContain("workerLabel(project.workers)")
    const drawer = readFileSync("apps/mobile/src/components/Drawer.svelte", "utf8")
    expect(drawer).toContain(`<Codicon name="organization" />`)
    expect(drawer).toContain("workerLabel(session.workers)")
  })

  test("a project shows its folder, its status beside it, and its count only while collapsed", () => {
    expect(pane).toContain(`<Codicon name={open ? "folder-opened" : "folder"} />`)
    expect(pane).toContain(`<span class="folder"><Codicon name="folder-opened" /></span>`)
    expect(pane).toContain(`{#if !open && project.sessions.length > 0}<span class="count muted"`)
    // A running project that also has running workers shows the worker icon, not both spinners.
    expect(pane).toContain(`{#if project.sessions.length > 0 && !(project.status === "running" && project.workers > 0)}{@render statusIcon(project.status)}{/if}`)
    // The header actions take room from the name only while hovered or focused, so every status signal stays visible.
    expect(pane).toContain(`<div class="pactions">`)
    expect(pane).toContain(`max-width: 4.5em`)
    expect(pane).toContain(`.phead:hover .pactions,`)
    expect(pane).toContain(`.phead:focus-within .pactions {`)
    expect(pane).not.toContain("margin-left: auto")
  })

  test("the order freezes only once every folder has its list", () => {
    expect(pane).toContain("const loadedAll = $derived(")
    expect(pane).toContain("if (!loadedAll) return")
  })

  test("contributions: the old activity-bar tree is gone, the toggle stays", () => {
    expect(pkg.contributes.viewsContainers?.activitybar ?? []).toEqual([])
    expect(pkg.contributes.views["opencode-sessions"]).toBeUndefined()
    expect(pkg.contributes.views.opencode.some((v: { id: string }) => v.id === "opencode.sessions")).toBe(false)
    expect(pkg.contributes.commands.filter((c: { command: string }) => c.command.startsWith("opencode.sessions."))).toEqual([])
    expect(pkg.contributes.menus["view/item/context"] ?? []).toEqual([])
    expect(pkg.contributes.menus.commandPalette ?? []).toEqual([])
    expect(pkg.contributes.commands).toContainEqual(expect.objectContaining({ command: "opencode.toggleSessions", title: "Toggle Sessions", icon: "$(layout-sidebar-left)" }))
    expect(pkg.contributes.menus["view/title"]).toContainEqual({ command: "opencode.toggleSessions", when: "view == opencode.chat", group: "navigation@90" })
  })

  test("the extension registers the toggle and no longer registers a tree view", () => {
    const extension = readFileSync("apps/vscode/src/extension/extension.ts", "utf8")
    expect(extension).toContain(`registerCommand("opencode.toggleSessions"`)
    expect(extension).not.toContain("SessionsTreeProvider")
    expect(extension).not.toContain("createTreeView")
    expect(extension).not.toContain("opencode.sessions.")
  })
})
