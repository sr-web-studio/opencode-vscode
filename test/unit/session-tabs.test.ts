import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { SessionInfo } from "@occ/core/api"
import type { AppState, FolderSessions } from "@occ/core/protocol"
import { buildPane, type PaneFolder } from "@occ/core/sessions-pane"
import {
  AVATAR_COLORS,
  CHECK_BATCH,
  ChatTabCatalog,
  MAX_TABS,
  OwnSessionsMemo,
  RECHECK_MS,
  TabVerifier,
  avatarColor,
  avatarLetter,
  closeTab,
  filterTabSessions,
  fitTabs,
  heldOrder,
  lookupTab,
  moveTab,
  nextAfterClose,
  openTab,
  orderTabs,
  paneCatalog,
  parseTabs,
  rememberTabs,
  sameNumbers,
  tabSessions,
  type SessionTab,
  type TabEntry,
  type TabLookup,
  type TabSession,
  type TabVerdict,
} from "@occ/core/session-tabs"
import { isTabCheckAnswer, isTabCheckRequest } from "@occ/core/tab-check"
import { NO_STORAGE, REMEMBER_MS, TABS_KEY, TabListCore, type Schedule, type TabStorage } from "@occ/core/tab-list"
import { emptyOverview, toOverviewSession } from "../../apps/mobile/src/lib/overview"
import { overviewCatalog, tabsKey } from "../../apps/mobile/src/lib/tab-catalog"

const tab = (id: string, directory = "/work/app", over: Partial<SessionTab> = {}): SessionTab => ({ id, directory, ...over })

describe("tab list", () => {
  test("opening adds a tab at the end; opening it again keeps its place and takes the newer details", () => {
    let tabs = openTab([], tab("a"))
    tabs = openTab(tabs, tab("b"))
    expect(tabs.map((t) => t.id)).toEqual(["a", "b"])
    const again = openTab(tabs, tab("a", "/work/app", { title: "Renamed", last: 9 }))
    expect(again.map((t) => t.id)).toEqual(["a", "b"])
    expect(again[0]).toEqual({ id: "a", directory: "/work/app", title: "Renamed", last: 9 })
  })

  test("opening a tab with nothing new returns the same list, so nothing is written", () => {
    const tabs = [tab("a", "/w", { title: "T", last: 1 })]
    expect(openTab(tabs, tab("a", "/w", { title: "T" }))).toBe(tabs)
  })

  test("past the cap the least recently active tab goes, never the one on screen nor the one being opened", () => {
    // s0 was opened first but is the most active; s1 is the least active, s2 the next.
    let tabs: SessionTab[] = []
    for (let i = 0; i < MAX_TABS; i++) tabs = openTab(tabs, tab(`s${i}`, "/w", { last: i === 0 ? 10_000 : i === 1 ? 1 : 100 + i }))
    const next = openTab(tabs, tab("new", "/w", { last: 0 }))
    expect(next).toHaveLength(MAX_TABS)
    expect(next.some((t) => t.id === "s0")).toBe(true)
    expect(next.some((t) => t.id === "s1")).toBe(false)
    expect(next.at(-1)!.id).toBe("new")
    // The least active tab is on screen: the next least active goes instead.
    const kept = openTab(tabs, tab("new"), "s1")
    expect(kept.some((t) => t.id === "s1")).toBe(true)
    expect(kept.some((t) => t.id === "s2")).toBe(false)
  })

  test("past the cap, tabs with the same (or no) activity go in the order they were opened", () => {
    let tabs: SessionTab[] = []
    for (let i = 0; i < MAX_TABS + 3; i++) tabs = openTab(tabs, tab(`s${i}`))
    expect(tabs).toHaveLength(MAX_TABS)
    expect(tabs[0]!.id).toBe("s3")
  })

  test("closing removes only the tab", () => {
    const tabs = [tab("a"), tab("b"), tab("c")]
    expect(closeTab(tabs, "b").map((t) => t.id)).toEqual(["a", "c"])
    expect(closeTab(tabs, "zzz")).toBe(tabs)
  })

  test("after closing, the next tab in strip order is shown, else the previous one, else none", () => {
    expect(nextAfterClose(["a", "b", "c"], "b")).toBe("c")
    expect(nextAfterClose(["a", "b", "c"], "c")).toBe("b")
    expect(nextAfterClose(["a"], "a")).toBeUndefined()
    expect(nextAfterClose(["a"], "x")).toBeUndefined()
  })

  test("a stored list is parsed defensively: bad entries and duplicates are dropped", () => {
    expect(parseTabs(undefined)).toEqual([])
    expect(parseTabs("nope")).toEqual([])
    expect(
      parseTabs([
        { id: "a", directory: "/w", title: "A", last: 5 },
        { id: "a", directory: "/other" },
        { id: "", directory: "/w" },
        { id: "b" },
        null,
        { id: "c", directory: "/w", title: 3, last: "x" },
      ]),
    ).toEqual([
      { id: "a", directory: "/w", title: "A", last: 5 },
      { id: "c", directory: "/w" },
    ])
  })

  test("remembering titles, times and folders changes the list only when something differs", () => {
    const tabs = [tab("a", "/w", { title: "A", last: 1 }), tab("b")]
    expect(rememberTabs(tabs, (id) => (id === "a" ? { title: "A", last: 1, directory: "/w" } : undefined))).toBe(tabs)
    const next = rememberTabs(tabs, (id) => (id === "b" ? { title: "B", last: 7 } : undefined))
    expect(next[1]).toEqual({ id: "b", directory: "/work/app", title: "B", last: 7 })
    expect(next[0]).toBe(tabs[0])
  })

  test("a session moved to another folder keeps its tab, which follows it there", () => {
    const tabs = [tab("a", "/w/old", { title: "A", last: 1 })]
    // The lists carry it under its new folder.
    expect(rememberTabs(tabs, () => ({ title: "A", last: 1, directory: "/w/new" }))[0]).toEqual({ id: "a", directory: "/w/new", title: "A", last: 1 })
    // Or the server says where it lives now.
    expect(moveTab(tabs, "a", "/w/new")[0]!.directory).toBe("/w/new")
    expect(moveTab(tabs, "a", "/w/old")).toBe(tabs)
  })
})

describe("closing tabs of deleted sessions", () => {
  test("only the server's 'session not found' means gone; a bad request or a network error keeps the tab", async () => {
    const reject = (e: unknown) => () => Promise.reject(e)
    expect(await lookupTab(reject({ _tag: "SessionNotFoundError", name: "SessionNotFoundError", sessionID: "x" }))).toEqual({ state: "gone" })
    expect(await lookupTab(reject({ _tag: "InvalidRequestError", name: "InvalidRequestError" }))).toEqual({ state: "unknown" })
    expect(await lookupTab(reject(new TypeError("fetch failed")))).toEqual({ state: "unknown" })
    // A bare 404 may come from a proxy in front of the server: not proof.
    expect(await lookupTab(reject({ status: 404, message: "404 Not Found" }))).toEqual({ state: "unknown" })
    expect(await lookupTab(() => Promise.resolve({ location: { directory: "/w/new" } }))).toEqual({ state: "exists", directory: "/w/new" })
    expect(await lookupTab(() => Promise.resolve({}))).toEqual({ state: "exists" })
  })

  /** A verifier whose lookups the test answers by hand. */
  function harness(start = 0) {
    let clock = start
    const asked: string[] = []
    const answers = new Map<string, (result: TabLookup) => void>()
    const verdicts: TabVerdict[] = []
    const verifier = new TabVerifier(
      (t) =>
        new Promise<TabLookup>((resolve) => {
          asked.push(t.id)
          answers.set(t.id, resolve)
        }),
      (verdict) => verdicts.push(verdict),
      () => clock,
    )
    const answer = async (id: string, result: TabLookup) => {
      answers.get(id)!(result)
      // Let the lookup's promise chain settle.
      for (let i = 0; i < 3; i++) await Promise.resolve()
    }
    return { verifier, asked, verdicts, answer, advance: (ms: number) => void (clock += ms) }
  }

  test("a list cut off or filtered by folder proves nothing: a missing tab is looked up, never closed for that alone", async () => {
    // The chat's list holds one folder's share of a 200-session page: "b" is simply not in it.
    const { verifier, asked, verdicts, answer } = harness()
    const tabs = [tab("a"), tab("b")]
    expect(verifier.update(tabs, new Set(["a"]), new Set())).toEqual(["b"])
    expect(asked).toEqual(["b"])
    await answer("b", { state: "exists" })
    expect(verdicts).toEqual([{ id: "b", gone: false, directory: undefined }])
  })

  test("a 'not found' answer closes the tab; an unclear one keeps it", async () => {
    const { verifier, verdicts, answer } = harness()
    verifier.update([tab("a"), tab("b")], new Set(), new Set())
    await answer("a", { state: "gone" })
    await answer("b", { state: "unknown" })
    expect(verdicts).toEqual([{ id: "a", gone: true }])
  })

  test("a moved session keeps its tab and reports its new folder", async () => {
    const { verifier, verdicts, answer } = harness()
    verifier.update([tab("a", "/w/old")], new Set(), new Set())
    await answer("a", { state: "exists", directory: "/w/new" })
    expect(verdicts).toEqual([{ id: "a", gone: false, directory: "/w/new" }])
  })

  test("listed tabs and the session on screen are never looked up", () => {
    const { verifier, asked } = harness()
    verifier.update([tab("a"), tab("b"), tab("c")], new Set(["a"]), new Set(["b"]))
    expect(asked).toEqual(["c"])
  })

  test("lookups run a few at a time; the next start as answers come in", async () => {
    const { verifier, asked, answer } = harness()
    const tabs = Array.from({ length: CHECK_BATCH + 2 }, (_, i) => tab(`t${i}`))
    verifier.update(tabs, new Set(), new Set())
    expect(asked).toHaveLength(CHECK_BATCH)
    await answer("t0", { state: "exists" })
    expect(asked).toHaveLength(CHECK_BATCH + 1)
  })

  test("an unlisted tab is asked about again only after a while; one that leaves the lists is asked at once", async () => {
    const { verifier, asked, answer, advance } = harness()
    verifier.update([tab("a")], new Set(), new Set())
    await answer("a", { state: "exists" })
    verifier.update([tab("a")], new Set(), new Set())
    expect(asked).toEqual(["a"])
    advance(RECHECK_MS)
    verifier.update([tab("a")], new Set(), new Set())
    expect(asked).toEqual(["a", "a"])
    await answer("a", { state: "exists" })
    // Listed again, then gone from the lists (deleted elsewhere): looked up without waiting.
    verifier.update([tab("a")], new Set(["a"]), new Set())
    verifier.update([tab("a")], new Set(), new Set())
    expect(asked).toEqual(["a", "a", "a"])
  })

  test("a stopped verifier reports nothing", async () => {
    const { verifier, verdicts, answer } = harness()
    verifier.update([tab("a")], new Set(), new Set())
    verifier.stop()
    await answer("a", { state: "gone" })
    expect(verdicts).toEqual([])
  })

  test("the VS Code webview's lookup messages are checked before use", () => {
    expect(isTabCheckRequest({ type: "tabCheck", requestID: "r", sessionID: "s" })).toBe(true)
    expect(isTabCheckRequest({ type: "tabCheck", requestID: "r", sessionID: "" })).toBe(false)
    expect(isTabCheckAnswer({ type: "tabCheckAnswer", requestID: "r", result: { state: "gone" } })).toBe(true)
    expect(isTabCheckAnswer({ type: "tabCheckAnswer", requestID: "r", result: { state: "maybe" } })).toBe(false)
  })
})

describe("tab list persistence", () => {
  function store(initial?: unknown) {
    const writes: unknown[] = []
    const storage: TabStorage = { get: <T>() => initial as T | undefined, set: (_key, value) => void writes.push(structuredClone(value)) }
    return { storage, writes }
  }
  /** A timer the test fires by hand. */
  function timers() {
    const due: Array<{ fn: () => void; ms: number; cancelled: boolean }> = []
    const schedule: Schedule = (fn, ms) => {
      const entry = { fn, ms, cancelled: false }
      due.push(entry)
      return () => void (entry.cancelled = true)
    }
    const fire = () => {
      for (const entry of due.splice(0)) if (!entry.cancelled) entry.fn()
    }
    return { schedule, due, fire }
  }

  test("a stored list is read back under its key", () => {
    const { storage } = store([{ id: "a", directory: "/w" }])
    expect(new TabListCore(storage).tabs).toEqual([{ id: "a", directory: "/w" }])
    expect(TABS_KEY).toBe("sessionTabs")
  })

  test("opening, closing, a confirmed deletion and a move are written at once", () => {
    const { storage, writes } = store()
    const list = new TabListCore(storage, TABS_KEY, undefined, timers().schedule)
    list.open(tab("a"))
    list.open(tab("b"))
    list.close("a")
    list.move("b", "/w/new")
    list.remove("b")
    expect(writes).toEqual([[tab("a")], [tab("a"), tab("b")], [tab("b")], [tab("b", "/w/new")], []])
  })

  test("titles and activity times are written once after a pause, and an open in between writes everything", () => {
    const { storage, writes } = store([tab("a")])
    const clock = timers()
    const list = new TabListCore(storage, TABS_KEY, undefined, clock.schedule)
    list.remember(() => ({ title: "A", last: 1 }))
    list.remember(() => ({ title: "A2", last: 2 }))
    expect(writes).toEqual([])
    expect(clock.due.map((entry) => entry.ms)).toEqual([REMEMBER_MS])
    clock.fire()
    expect(writes).toEqual([[tab("a", "/work/app", { title: "A2", last: 2 })]])
    list.remember(() => ({ title: "A3", last: 3 }))
    list.open(tab("b"))
    expect(writes).toHaveLength(2)
    // The pending write was folded into the open's.
    clock.fire()
    expect(writes).toHaveLength(2)
  })

  test("nothing changes, nothing is written; flush writes what is pending", () => {
    const { storage, writes } = store([tab("a", "/work/app", { title: "A", last: 1 })])
    const clock = timers()
    const list = new TabListCore(storage, TABS_KEY, undefined, clock.schedule)
    list.remember(() => ({ title: "A", last: 1 }))
    list.close("zzz")
    list.flush()
    expect(writes).toEqual([])
    list.remember(() => ({ title: "B", last: 2 }))
    list.flush()
    expect(writes).toHaveLength(1)
    clock.fire()
    expect(writes).toHaveLength(1)
  })

  test("without a saved server the tabs are kept in memory only", () => {
    const list = new TabListCore(NO_STORAGE)
    list.open(tab("a"))
    expect(list.tabs).toHaveLength(1)
    expect(new TabListCore(NO_STORAGE).tabs).toEqual([])
  })
})

describe("tab order", () => {
  const info: Record<string, { title: string; last: number }> = { a: { title: "A", last: 10 }, b: { title: "B", last: 30 }, c: { title: "C", last: 20 } }

  test("the most recently active session comes first", () => {
    expect(orderTabs([tab("a"), tab("b"), tab("c")], (id) => info[id])).toEqual(["b", "c", "a"])
  })

  test("a tab no list knows yet uses its remembered time; ties go by title, then id", () => {
    expect(orderTabs([tab("x", "/w", { last: 25 }), tab("a"), tab("b")], (id) => info[id])).toEqual(["b", "x", "a"])
    expect(orderTabs([tab("z", "/w", { title: "Same" }), tab("y", "/w", { title: "same" })], () => undefined)).toEqual(["y", "z"])
  })

  test("while held, tabs keep their places; a new tab is placed by the live order and a closed one leaves", () => {
    expect(heldOrder(undefined, ["b", "a"])).toEqual(["b", "a"])
    expect(heldOrder(["a", "b", "c"], ["c", "b", "a"])).toEqual(["a", "b", "c"])
    expect(heldOrder(["a", "b", "c"], ["d", "c", "a"])).toEqual(["d", "a", "c"])
  })
})

describe("fitting tabs", () => {
  const opts = { gap: 2, overflow: 30, min: 100, max: 200 }

  test("everything fits: one equal width, nothing hidden and no overflow button reserved", () => {
    expect(fitTabs(2, 302, opts)).toEqual({ visible: [0, 1], hidden: [], width: 150 })
    expect(fitTabs(3, 304, opts)).toEqual({ visible: [0, 1, 2], hidden: [], width: 100 })
    expect(fitTabs(0, 10, opts)).toEqual({ visible: [], hidden: [], width: 100 })
  })

  test("a wide strip caps every tab at the maximum", () => {
    expect(fitTabs(3, 2000, opts)).toEqual({ visible: [0, 1, 2], hidden: [], width: 200 })
  })

  test("what does not fit at the minimum goes to the overflow instead of squeezing, and the rest share the room evenly", () => {
    // 3 tabs need 304 at the minimum; 250 leaves 218 beside the overflow button: two tabs of 108.
    expect(fitTabs(3, 250, opts)).toEqual({ visible: [0, 1], hidden: [2], width: 108 })
    // Narrow or not, no visible tab is ever below the minimum while another could be hidden.
    for (let available = 100; available < 700; available += 7) {
      for (const active of [undefined, 0, 2, 5]) {
        const fit = fitTabs(6, available, { ...opts, active })
        if (fit.visible.length > 1) expect(fit.width).toBeGreaterThanOrEqual(100)
        expect(fit.width).toBeLessThanOrEqual(200)
        expect(fit.visible.length + fit.hidden.length).toBe(6)
        // The drawn tabs, the gaps and (when something is hidden) the overflow button fit in the room.
        const used = fit.visible.length * fit.width + (fit.visible.length - 1) * opts.gap + (fit.hidden.length ? opts.overflow + opts.gap : 0)
        if (fit.visible.length > 1) expect(used).toBeLessThanOrEqual(available + 1e-9)
        if (active !== undefined) expect(fit.visible).toContain(active)
      }
    }
  })

  test("the active tab is never hidden: tabs before it make room and it takes the last place, at the same width", () => {
    expect(fitTabs(4, 250, { ...opts, active: 3 })).toEqual({ visible: [0, 3], hidden: [1, 2], width: 108 })
    expect(fitTabs(4, 250, { ...opts, active: 1 })).toEqual({ visible: [0, 1], hidden: [2, 3], width: 108 })
  })

  test("one tab is drawn when even one does not fit at the minimum, and it takes the room there is", () => {
    expect(fitTabs(2, 70, opts)).toEqual({ visible: [0], hidden: [1], width: 38 })
    expect(fitTabs(2, 70, { ...opts, active: 1 })).toEqual({ visible: [1], hidden: [0], width: 38 })
    expect(fitTabs(1, 70, opts)).toEqual({ visible: [0], hidden: [], width: 70 })
  })
})

describe("a streamed answer costs the strip nothing", () => {
  const info = (id: string, updated: number, title = id.toUpperCase()): SessionInfo => ({ id, title, time: { created: 1, updated } }) as SessionInfo

  /** The chat state as the store holds it; only what the pane and the strip read. */
  function state(over: Partial<AppState> = {}): AppState {
    return {
      directory: "/w/app",
      folderName: "app",
      projectName: "App",
      sessions: [info("a", 5), info("b", 9)],
      archived: [info("z", 1)],
      showArchived: false,
      sessionsLoaded: true,
      running: [],
      waiting: [],
      workerRunning: {},
      target: { kind: "session", id: "a" },
      view: { turns: [], queued: [], loaded: true },
      ...over,
    } as unknown as AppState
  }

  test("a patch that replaces the state but no list gives back the same catalog and entries", () => {
    const catalogs = new ChatTabCatalog()
    const memo = new OwnSessionsMemo()
    const folders: FolderSessions[] = []
    const tabs = [tab("a", "/w/app"), tab("b", "/w/app"), tab("z", "/w/app"), tab("x", "/w/gone", { title: "Remembered" })]
    const derive = (s: AppState) => {
      const catalog = catalogs.build(s, folders, 60_000)
      const byId = new Map(catalog.sessions.map((row) => [row.id, row]))
      const own = memo.get(s.sessions, s.archived)
      const sessions = tabSessions(tabs, byId, own, { untitled: "Untitled", project: (d) => d })
      const entries: TabEntry[] = orderTabs(tabs, (id) => sessions.get(id)).map((id) => ({ kind: "session", session: sessions.get(id)! }))
      return { catalog, own, sessions, entries }
    }
    const before = state()
    const first = derive(before)
    // `applyStatePatch` copies the state and swaps only the patched keys: here the transcript.
    const streamed = { ...before, view: { turns: [{ id: "t", steps: [] }], queued: [], loaded: true } } as unknown as AppState
    const second = derive(streamed)
    expect(second.catalog).toBe(first.catalog)
    expect(second.own).toBe(first.own)
    expect(second.entries).toEqual(first.entries)
    expect([...second.sessions.values()]).toEqual([...first.sessions.values()])
    // The archived session and the unlisted tab still read right.
    expect(first.sessions.get("z")!.title).toBe("Z")
    expect(first.sessions.get("x")!.title).toBe("Remembered")
    // A real change (a renamed session) does give a new catalog.
    const renamed = derive({ ...before, sessions: [info("a", 5, "Renamed"), info("b", 9)] })
    expect(renamed.catalog).not.toBe(first.catalog)
  })

  test("measurements are compared before they are stored", () => {
    expect(sameNumbers([1, 2.5], [1, 2.5])).toBe(true)
    expect(sameNumbers([1, 2], [1, 3])).toBe(false)
    expect(sameNumbers([1], [1, 1])).toBe(false)
  })
})

describe("avatar and filter", () => {
  test("the avatar letter is the project's first letter or digit", () => {
    expect(avatarLetter("opencode-vscode")).toBe("O")
    expect(avatarLetter("  _my app")).toBe("M")
    expect(avatarLetter("2048")).toBe("2")
    expect(avatarLetter("ঢাকা")).toBe("ঢ")
    expect(avatarLetter("---")).toBe("?")
  })

  test("a project keeps its colour whatever the spelling of its folder", () => {
    const c = avatarColor("/work/app")
    expect(c).toBeGreaterThanOrEqual(0)
    expect(c).toBeLessThan(AVATAR_COLORS)
    expect(avatarColor("/work/app/")).toBe(c)
    expect(avatarColor("C:\\work\\app")).toBe(avatarColor("C:/work/app"))
  })

  test("the filter matches the title or the project, case-insensitively, in the given order", () => {
    const rows = [
      { title: "Fix login", project: "web" },
      { title: "Docs", project: "Website" },
      { title: "Tests", project: "api" },
    ]
    expect(filterTabSessions(rows, "  WEB ").map((r) => r.title)).toEqual(["Fix login", "Docs"])
    expect(filterTabSessions(rows, "")).toHaveLength(3)
  })
})

describe("catalogs", () => {
  const folder = (directory: string, name: string, sessions: PaneFolder["sessions"], active = false): PaneFolder => ({
    directory,
    name,
    active,
    sessions,
    running: new Set(),
    waiting: new Set(),
    workers: new Map(),
    loaded: true,
  })

  test("VS Code: the pane's rows in the pane's order, each with its project", () => {
    const single = buildPane([folder("/w/app", "app", [{ id: "a", title: "A", time: { created: 1, updated: 5 } }], true)], 10)
    expect(paneCatalog(single, "My App")).toEqual([{ id: "a", directory: "/w/app", title: "A", project: "My App", status: "read", last: 5 }])
    const multi = buildPane(
      [folder("/w/app", "app", [{ id: "a", title: "A", time: { created: 1, updated: 5 } }], true), folder("/w/api", "api", [{ id: "b", title: "B", time: { created: 1, updated: 9 } }])],
      10,
    )
    expect(paneCatalog(multi, "ignored").map((s) => [s.id, s.project])).toEqual([
      ["b", "api"],
      ["a", "app"],
    ])
  })

  test("VS Code: every id of the window's lists counts as listed, the archive and other folders included", () => {
    const s = (id: string): SessionInfo => ({ id, title: id, time: { created: 1, updated: 1 } }) as SessionInfo
    const app = {
      directory: "/w/app",
      folderName: "app",
      sessions: [s("a")],
      archived: [s("z")],
      showArchived: false,
      sessionsLoaded: true,
      running: [],
      waiting: [],
      workerRunning: {},
      target: { kind: "draft" },
    } as unknown as AppState
    const other: FolderSessions = { directory: "/w/api", sessions: [s("b")], running: [], waiting: [], workerRunning: {}, loaded: true }
    expect([...new ChatTabCatalog().build(app, [other], 0).listed].sort()).toEqual(["a", "b", "z"])
  })

  test("phone: the drawer's sessions, archived ones left out of the list but counted as listed", () => {
    const s = (id: string, directory: string, updated: number, archived?: number): SessionInfo =>
      ({ id, title: id.toUpperCase(), location: { directory }, time: { created: 1, updated, archived } }) as SessionInfo
    const data = { ...emptyOverview(), sessions: [s("a", "/w/app", 5), s("b", "/w/api", 9), s("c", "/w/app", 7, 8)].map(toOverviewSession) }
    const catalog = overviewCatalog(data, {}, false, 10)
    expect(catalog.sessions.map((row: TabSession) => [row.id, row.project])).toEqual([
      ["b", "api"],
      ["a", "app"],
    ])
    expect([...catalog.listed].sort()).toEqual(["a", "b", "c"])
    expect(overviewCatalog(undefined, {}, false, 10)).toEqual({ sessions: [], listed: new Set(), loading: true })
  })

  test("the phone keeps one tab list per server profile", () => {
    expect(tabsKey("p1")).toBe("occ.tabs.p1")
    expect(tabsKey("p1")).not.toBe(tabsKey("p2"))
  })
})

// Guards on the markup that no unit test can reach without a DOM.
describe("guards", () => {
  test("closing a tab never deletes or archives the session", () => {
    for (const file of ["packages/ui/src/components/SessionTabs.svelte", "packages/ui/src/components/TabsMenu.svelte"]) {
      const source = readFileSync(file, "utf8")
      expect(source).not.toContain("confirmDeleteSession")
      expect(source).not.toMatch(/type: "(deleteSession|archive|archiveSession)"/)
    }
  })

  test("the dropdown's lists hold only buttons: no listbox whose options carry a second button", () => {
    const menu = readFileSync("packages/ui/src/components/TabsMenu.svelte", "utf8")
    expect(menu).not.toContain(`role="listbox"`)
    expect(menu).not.toContain(`role="option"`)
  })

  test("a tab does not use the global link class (link colour, and the phone pads chat links to 44px)", () => {
    expect(readFileSync("packages/ui/src/components/SessionTabs.svelte", "utf8")).not.toMatch(/class="link"|^\s*\.link\b/m)
  })
})
