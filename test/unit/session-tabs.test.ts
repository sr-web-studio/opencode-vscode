import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { SessionInfo } from "@occ/core/api"
import { buildPane, type PaneFolder } from "@occ/core/sessions-pane"
import {
  AVATAR_COLORS,
  LIST_PAGE,
  MAX_TABS,
  avatarColor,
  avatarLetter,
  closeTab,
  filterTabSessions,
  fitTabs,
  folderProof,
  heldOrder,
  nextAfterClose,
  openTab,
  orderTabs,
  paneCatalog,
  parseTabs,
  pruneTabs,
  rememberTabs,
  type SessionTab,
  type TabSession,
} from "@occ/core/session-tabs"
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

  test("the list is capped; the tab opened longest ago goes first", () => {
    let tabs: SessionTab[] = []
    for (let i = 0; i < MAX_TABS + 3; i++) tabs = openTab(tabs, tab(`s${i}`))
    expect(tabs).toHaveLength(MAX_TABS)
    expect(tabs[0]!.id).toBe("s3")
    expect(tabs.at(-1)!.id).toBe(`s${MAX_TABS + 2}`)
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

  test("remembering titles and times changes the list only when something differs", () => {
    const tabs = [tab("a", "/w", { title: "A", last: 1 }), tab("b")]
    expect(rememberTabs(tabs, (id) => (id === "a" ? { title: "A", last: 1 } : undefined))).toBe(tabs)
    const next = rememberTabs(tabs, (id) => (id === "b" ? { title: "B", last: 7 } : undefined))
    expect(next[1]).toEqual({ id: "b", directory: "/work/app", title: "B", last: 7 })
    expect(next[0]).toBe(tabs[0])
  })
})

describe("pruning deleted sessions", () => {
  const tabs = [tab("a", "/work/app"), tab("b", "/work/app"), tab("c", "/work/other")]

  test("a complete list of the tab's folder that lacks the session closes its tab", () => {
    expect(pruneTabs(tabs, [{ directory: "/work/app", ids: new Set(["a"]), complete: true }]).map((t) => t.id)).toEqual(["a", "c"])
  })

  test("a list that is still loading or was cut off proves nothing", () => {
    expect(pruneTabs(tabs, [{ directory: "/work/app", ids: new Set(), complete: false }])).toBe(tabs)
  })

  test("another folder's list proves nothing about this folder's tabs; the spelling of a folder does not matter", () => {
    expect(pruneTabs(tabs, [{ directory: "/work/app/", ids: new Set(["a", "b"]), complete: true }])).toBe(tabs)
  })

  test("a server-wide list (no folder) covers every tab", () => {
    expect(pruneTabs(tabs, [{ ids: new Set(["b"]), complete: true }]).map((t) => t.id)).toEqual(["b"])
  })

  test("the session on screen keeps its tab even before the list has it", () => {
    expect(pruneTabs(tabs, [{ ids: new Set(), complete: true }], new Set(["c"])).map((t) => t.id)).toEqual(["c"])
  })

  test("the chat's folder proves gone only with its archive included and a list under one page", () => {
    const s = (id: string) => ({ id, time: { created: 1, updated: 1 } }) as SessionInfo
    const proof = folderProof({ directory: "/work/app", sessions: [s("a")], archived: [s("b")], sessionsLoaded: true })
    expect(proof.complete).toBe(true)
    expect([...proof.ids]).toEqual(["a", "b"])
    expect(folderProof({ directory: "/w", sessions: [], archived: [], sessionsLoaded: false }).complete).toBe(false)
    const full = Array.from({ length: LIST_PAGE }, (_, i) => s(`s${i}`))
    expect(folderProof({ directory: "/w", sessions: full, archived: [], sessionsLoaded: true }).complete).toBe(false)
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
  const opts = { gap: 2, overflow: 30 }

  test("everything fits: nothing is hidden and no overflow button is reserved", () => {
    expect(fitTabs([100, 100], 202, opts)).toEqual({ visible: [0, 1], hidden: [] })
    expect(fitTabs([], 10, opts)).toEqual({ visible: [], hidden: [] })
  })

  test("what does not fit goes to the overflow, which takes its own room", () => {
    // 3 × 100 + gaps = 304 > 250; with the overflow button (30 + gap) only two fit.
    expect(fitTabs([100, 100, 100], 250, opts)).toEqual({ visible: [0, 1], hidden: [2] })
  })

  test("tabs shrink to their minimum before any is hidden", () => {
    expect(fitTabs([200, 200, 200], 310, { ...opts, min: 100 })).toEqual({ visible: [0, 1, 2], hidden: [] })
    expect(fitTabs([200, 200, 200], 250, { ...opts, min: [100, 100, 100] })).toEqual({ visible: [0, 1], hidden: [2] })
  })

  test("the active tab is never hidden: tabs before it make room and it takes the last place", () => {
    expect(fitTabs([100, 100, 100, 100], 250, { ...opts, active: 3 })).toEqual({ visible: [0, 3], hidden: [1, 2] })
    expect(fitTabs([100, 100, 100, 100], 250, { ...opts, active: 1 })).toEqual({ visible: [0, 1], hidden: [2, 3] })
  })

  test("at least one tab is drawn even when nothing fits", () => {
    expect(fitTabs([300, 300], 100, opts)).toEqual({ visible: [0], hidden: [1] })
    expect(fitTabs([300, 300], 100, { ...opts, active: 1 })).toEqual({ visible: [1], hidden: [0] })
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

  test("phone: the drawer's sessions, archived ones left out of the list but kept as proof", () => {
    const s = (id: string, directory: string, updated: number, archived?: number): SessionInfo =>
      ({ id, title: id.toUpperCase(), location: { directory }, time: { created: 1, updated, archived } }) as SessionInfo
    const data = { ...emptyOverview(), sessions: [s("a", "/w/app", 5), s("b", "/w/api", 9), s("c", "/w/app", 7, 8)].map(toOverviewSession) }
    const catalog = overviewCatalog(data, {}, false, 500, 10)
    expect(catalog.sessions.map((row: TabSession) => [row.id, row.project])).toEqual([
      ["b", "api"],
      ["a", "app"],
    ])
    expect(catalog.proofs).toHaveLength(1)
    expect(catalog.proofs[0]!.complete).toBe(true)
    expect([...catalog.proofs[0]!.ids].sort()).toEqual(["a", "b", "c"])
    expect(overviewCatalog(data, {}, false, 3, 10).proofs[0]!.complete).toBe(false)
    expect(overviewCatalog(undefined, {}, false, 500, 10)).toEqual({ sessions: [], proofs: [], loading: true })
  })

  test("the phone keeps one tab list per server profile", () => {
    expect(tabsKey("p1")).toBe("occ.tabs.p1")
    expect(tabsKey("p1")).not.toBe(tabsKey("p2"))
  })
})

describe("wiring", () => {
  const app = readFileSync("packages/ui/src/App.svelte", "utf8")
  const strip = readFileSync("packages/ui/src/components/SessionTabs.svelte", "utf8")
  const switcher = readFileSync("packages/ui/src/components/SessionSwitcher.svelte", "utf8")
  const chatTabs = readFileSync("packages/ui/src/chat-tabs.svelte.ts", "utf8")
  const chat = readFileSync("apps/mobile/src/screens/ChatScreen.svelte", "utf8")
  const phone = readFileSync("apps/mobile/src/lib/session-tabs.svelte.ts", "utf8")

  test("the strip sits above the breadcrumb, which no longer carries the pane toggle or +", () => {
    expect(app.indexOf("<SessionTabs")).toBeGreaterThan(0)
    expect(app.indexOf("<SessionTabs")).toBeLessThan(app.indexOf("<SessionSwitcher"))
    expect(switcher).not.toContain("layout-sidebar-left")
    expect(switcher).not.toContain(`aria-label="New session"`)
  })

  test("closing a tab never deletes or archives the session", () => {
    for (const source of [strip, readFileSync("packages/ui/src/components/TabsMenu.svelte", "utf8")]) {
      expect(source).not.toContain("confirmDeleteSession")
      expect(source).not.toMatch(/type: "(deleteSession|archive|archiveSession)"/)
    }
  })

  test("VS Code opens a tab through the pane's path and toggles the pane", () => {
    expect(chatTabs).toContain("store.bridge.openSessionInFolder(id, directory)")
    expect(chatTabs).toContain("toggle: () => pane.toggle()")
  })

  test("the phone opens a tab through the drawer's path and its first button opens the drawer", () => {
    expect(chat).toContain("<App {bridge} {tabs} />")
    expect(chat).toContain("openSession: (dir, id) => model.openSession(dir, id)")
    expect(chat).toContain("openDrawer: () => model.openDrawer()")
    expect(phone).toContain("tabsKey(profileID)")
  })

  test("the status icons are the sessions pane's", () => {
    const icon = readFileSync("packages/ui/src/components/SessionStatusIcon.svelte", "utf8")
    for (const name of [`"loading" spin`, `"bell-dot"`, `"error"`, `"circle-filled"`, `"check"`]) expect(icon).toContain(`<Codicon name=${name}`)
    expect(strip).toContain("<SessionStatusIcon")
  })

  test("a tab does not use the global link class (link colour, and the phone pads chat links to 44px)", () => {
    expect(strip).not.toMatch(/class="link"|^\s*\.link\b/m)
  })
})
