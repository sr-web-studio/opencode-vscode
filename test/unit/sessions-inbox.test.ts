import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { SessionStatus } from "@occ/core/session-status"
import {
  applyInboxOrder,
  buildInbox,
  clampInboxHeight,
  freezeInbox,
  inboxCandidates,
  inboxDefaultHeight,
  inboxHeightRange,
  INBOX_ROWS,
  inboxMinHeight,
  INBOX_SIZING,
  INBOX_STEP,
  INBOX_STEP_LARGE,
  inboxRank,
  showInbox,
  stepInboxHeight,
  type InboxItem,
  type InboxRow,
} from "@occ/core/sessions-inbox"

const now = new Date(2026, 10, 15, 12, 0, 0).getTime()
const m = 60_000

const item = (id: string, status: SessionStatus, last: number, title = id): InboxItem => ({ id, title, status, last })
const row = (id: string, status: SessionStatus, last: number, title = id, project = "Project"): InboxRow => ({ ...item(id, status, last, title), project })

describe("inbox contents", () => {
  test("waiting, then running, then unread, then the most recent of the rest", () => {
    const rows = [
      row("read-old", "read", now - 5 * 24 * 60 * m),
      row("unread", "unread", now - 3 * m),
      row("running", "running", now - 30 * m),
      row("waiting", "waiting", now - 2 * 60 * m),
      row("read-new", "read", now - m),
    ]
    expect(buildInbox(rows).map((entry) => entry.id)).toEqual(["waiting", "running", "unread", "read-new", "read-old"])
    expect(buildInbox(rows).map((entry) => entry.status)).toEqual(["waiting", "running", "unread", "read", "read"])
  })

  test("newest first inside each group, then the title", () => {
    const rows = [row("a", "waiting", now - 10 * m, "Alpha"), row("b", "waiting", now - m, "Beta"), row("c", "read", now - 2 * m, "Gamma"), row("d", "read", now - 2 * m, "Delta")]
    expect(buildInbox(rows).map((entry) => entry.id)).toEqual(["b", "a", "d", "c"])
  })

  test("only the recent group is capped, at five rows in all", () => {
    const rows = [
      row("waiting", "waiting", now),
      row("running", "running", now - m),
      row("unread", "unread", now - 2 * m),
      ...Array.from({ length: 6 }, (_, i) => row(`read-${i}`, "read", now - (3 + i) * m)),
    ]
    const inbox = buildInbox(rows)
    expect(inbox).toHaveLength(INBOX_ROWS)
    expect(inbox.map((entry) => entry.id)).toEqual(["waiting", "running", "unread", "read-0", "read-1"])
  })

  test("more than five urgent sessions all stay; the recent group gets no room", () => {
    const urgent = [
      ...Array.from({ length: 6 }, (_, i) => row(`waiting-${i}`, "waiting", now - i * m)),
      ...Array.from({ length: 3 }, (_, i) => row(`running-${i}`, "running", now - (10 + i) * m)),
      ...Array.from({ length: 2 }, (_, i) => row(`failed-${i}`, "failed", now - (20 + i) * m)),
    ]
    const inbox = buildInbox([...urgent, row("read", "read", now)])
    expect(inbox).toHaveLength(11)
    expect(inbox.map((entry) => entry.id)).not.toContain("read")
  })

  test("failed sits between running and unread, in the shared status order", () => {
    // The same order a project's badge uses (`STATUS_RANK`), so the two never disagree about what is urgent.
    expect(inboxRank({ status: "waiting" })).toBe(0)
    expect(inboxRank({ status: "running" })).toBe(1)
    expect(inboxRank({ status: "failed" })).toBe(2)
    expect(inboxRank({ status: "unread" })).toBe(3)
    expect(inboxRank({ status: "read" })).toBe(4)
    expect(buildInbox([row("read", "read", now), row("unread", "unread", now - m), row("failed", "failed", now - 2 * m), row("running", "running", now - 3 * m)]).map((entry) => entry.id)).toEqual([
      "running",
      "failed",
      "unread",
      "read",
    ])
  })

  test("a failed session is never cut, even when the urgent groups overflow", () => {
    const rows = [
      row("waiting", "waiting", now),
      row("running", "running", now - m),
      row("failed", "failed", now - 2 * m),
      row("unread", "unread", now - 3 * m),
      ...Array.from({ length: 5 }, (_, i) => row(`read-${i}`, "read", now - (4 + i) * m)),
    ]
    const inbox = buildInbox(rows)
    expect(inbox).toHaveLength(INBOX_ROWS)
    expect(inbox.map((entry) => entry.id)).toEqual(["waiting", "running", "failed", "unread", "read-0"])
    // With four urgent rows and room for one, a second read row would push the failed row out if it were cuttable.
    expect(buildInbox(rows, 3).map((entry) => entry.id)).toEqual(["waiting", "running", "failed", "unread"])
  })

  test("each row carries its project's name, because the inbox mixes projects", () => {
    const rows = inboxCandidates([
      { name: "Alpha", rows: [item("a1", "read", now), item("a2", "waiting", now)] },
      { name: "Bravo", rows: [item("b1", "running", now)] },
    ])
    expect(rows.map((entry) => [entry.id, entry.project])).toEqual([
      ["a1", "Alpha"],
      ["a2", "Alpha"],
      ["b1", "Bravo"],
    ])
    expect(buildInbox(rows).map((entry) => [entry.id, entry.project])).toEqual([
      ["a2", "Alpha"],
      ["b1", "Bravo"],
      ["a1", "Alpha"],
    ])
  })
})

describe("inbox visibility", () => {
  const rows = [row("a", "waiting", now)]

  test("two or more projects are the point of it", () => {
    expect(showInbox(1, "", rows)).toBe(false)
    expect(showInbox(2, "", rows)).toBe(true)
    expect(showInbox(0, "", rows)).toBe(false)
  })

  test("a search hides it: the filtered project list is the answer", () => {
    expect(showInbox(4, "fix", rows)).toBe(false)
    expect(showInbox(4, "   ", rows)).toBe(true)
  })

  test("nothing to show means no section", () => {
    expect(showInbox(4, "", [])).toBe(false)
  })
})

describe("inbox stable order", () => {
  test("a row that becomes urgent keeps its place while the pane stays open", () => {
    const open = buildInbox([row("a", "read", now), row("b", "read", now - m), row("c", "read", now - 2 * m)])
    expect(open.map((entry) => entry.id)).toEqual(["a", "b", "c"])
    const frozen = freezeInbox(open)
    const live = buildInbox([row("a", "read", now), row("b", "waiting", now + m, "B new"), row("c", "read", now - 2 * m)])
    expect(live.map((entry) => entry.id)).toEqual(["b", "a", "c"])
    const held = applyInboxOrder(live, frozen)
    expect(held.map((entry) => entry.id)).toEqual(["a", "b", "c"])
    // The place is held; the title and the status are live.
    expect(held[1]).toMatchObject({ id: "b", title: "B new", status: "waiting" })
  })

  test("a new urgent row is slotted by the current order, a gone one disappears", () => {
    const frozen = freezeInbox(buildInbox([row("a", "read", now), row("b", "read", now - m), row("c", "read", now - 2 * m)]))
    const live = buildInbox([row("a", "read", now), row("b", "read", now - m), row("d", "waiting", now + m)])
    expect(live.map((entry) => entry.id)).toEqual(["d", "a", "b"])
    expect(applyInboxOrder(live, frozen).map((entry) => entry.id)).toEqual(["d", "a", "b"])
  })

  test("freezing nothing keeps nothing", () => {
    expect(freezeInbox([])).toEqual([])
    expect(applyInboxOrder([], [])).toEqual([])
  })
})

describe("inbox height", () => {
  test("the default fits five rows and the header, the minimum two rows", () => {
    expect(inboxDefaultHeight()).toBe(INBOX_SIZING.header + 5 * INBOX_SIZING.row)
    expect(inboxMinHeight()).toBe(INBOX_SIZING.header + 2 * INBOX_SIZING.row)
    expect(inboxDefaultHeight()).toBe(170)
    expect(inboxMinHeight()).toBe(86)
    expect(INBOX_STEP).toBe(16)
    expect(INBOX_STEP_LARGE).toBe(64)
  })

  test("the maximum leaves the project list about 120 px", () => {
    expect(inboxHeightRange(600)).toEqual({ min: 86, max: 474 })
    expect(inboxHeightRange(900)).toEqual({ min: 86, max: 774 })
    // A view too short for both still answers with the minimum, never with a negative height.
    expect(inboxHeightRange(200)).toEqual({ min: 86, max: 86 })
    expect(inboxHeightRange(Number.NaN)).toEqual({ min: 86, max: 474 })
  })

  test("a height is clamped both ways and a saved one comes back usable", () => {
    expect(clampInboxHeight(100, 600)).toBe(100)
    expect(clampInboxHeight(10, 600)).toBe(86)
    expect(clampInboxHeight(999, 600)).toBe(474)
    expect(clampInboxHeight(Number.NaN, 600)).toBe(170)
    expect(clampInboxHeight(170, 200)).toBe(86)
  })

  test("the arrows step by 16 px, Shift by 64, and stop at the bounds", () => {
    expect(stepInboxHeight(200, 1, 600)).toBe(216)
    expect(stepInboxHeight(200, -1, 600)).toBe(184)
    expect(stepInboxHeight(200, 1, 600, true)).toBe(264)
    expect(stepInboxHeight(86, -1, 600)).toBe(86)
    expect(stepInboxHeight(470, 1, 600)).toBe(474)
  })

  test("the phone measures from its own finger-sized rows", () => {
    // An inbox row carries the project line, so it is 59 px; the drawer passes exactly these numbers.
    const phone = { ...INBOX_SIZING, row: 59, header: 48, sash: 48 }
    expect(inboxDefaultHeight(phone)).toBe(343)
    expect(inboxMinHeight(phone)).toBe(166)
    expect(inboxHeightRange(608, phone)).toEqual({ min: 166, max: 440 })
    expect(clampInboxHeight(1000, 608, phone)).toBe(440)
  })
})

describe("inbox wiring", () => {
  const pane = readFileSync("packages/ui/src/components/SessionsPane.svelte", "utf8")
  const inbox = readFileSync("packages/ui/src/components/SessionsInbox.svelte", "utf8")
  const drawer = readFileSync("apps/mobile/src/components/Drawer.svelte", "utf8")
  const prefs = readFileSync("apps/mobile/src/lib/drawer-prefs.ts", "utf8")
  const changelog = readFileSync("CHANGELOG.md", "utf8")

  test("both hosts draw the same core answer and freeze it while open", () => {
    for (const host of [pane, drawer]) {
      expect(host).toContain("buildInbox(inboxCandidates(")
      expect(host).toContain("showInbox(")
      expect(host).toContain("freezeInbox(inboxRows)")
      expect(host).toContain("applyInboxOrder(")
    }
  })

  test("the editor remembers the height and the collapse in the webview state", () => {
    expect(pane).toContain(`const INBOX_HEIGHT_KEY = "inboxHeight"`)
    expect(pane).toContain(`const INBOX_COLLAPSED_KEY = "inboxCollapsed"`)
    expect(pane).toContain("store.bridge.storage.set(INBOX_HEIGHT_KEY, wantedInbox)")
    expect(pane).toContain("store.bridge.storage.set(INBOX_COLLAPSED_KEY, inboxCollapsed)")
    expect(pane).toContain("oncommit={commitInboxHeight}")
    expect(pane).toContain("viewHeight={listArea}")
    expect(pane).toContain("bind:clientHeight={paneHeight}")
    expect(pane).toContain("bind:clientHeight={headHeight}")
  })

  test("the inbox is a header, rows from the caller's snippet, and a horizontal separator", () => {
    expect(inbox).toContain(`<span class="itext">Active ({rows.length})</span>`)
    expect(inbox).toContain("aria-expanded={!collapsed}")
    expect(inbox).toContain(`role="separator"`)
    expect(inbox).toContain(`aria-orientation="horizontal"`)
    expect(inbox).toContain("aria-valuenow={height}")
    expect(inbox).toContain("aria-valuemin={range.min}")
    expect(inbox).toContain("aria-valuemax={range.max}")
    expect(inbox).toContain(`tabindex="0"`)
    expect(inbox).toContain("sash?.setPointerCapture(e.pointerId)")
    expect(inbox).toContain(`e.key !== "ArrowUp" && e.key !== "ArrowDown"`)
    expect(inbox).toContain("oncommit(pending)")
    expect(inbox).toContain("ondblclick={() => {")
    expect(inbox).toContain("oncommit(next)")
    expect(inbox).toContain("cursor: row-resize")
    // A fixed height, not a max-height: a max-height never grows past the rows, so dragging up looked dead.
    expect(inbox).toContain("height: var(--oc-inbox-height)")
    expect(inbox).not.toContain("max-height: var(--oc-inbox-height)")
    expect(inbox).toMatch(/\.inbox\.collapsed \{\s*height: auto;/)
    expect(drawer).not.toContain("max-height: var(--oc-inbox-height)")
    expect(drawer).toContain(`class="inbox" class:collapsed={inboxCollapsed}`)
    expect(inbox).toContain("{@render row(entry)}")
  })

  test("the editor's inbox rows reveal their actions on hover or focus, so the title keeps the room", () => {
    // Scoped inside the section: the project list above keeps its always-visible buttons.
    expect(inbox).toContain(".inbox :global(.row .icon.ren),")
    expect(inbox).toContain(".inbox :global(.row:hover .icon.ren),")
    expect(inbox).toContain(".inbox :global(.row:focus-within .icon.ren),")
    expect(inbox).toContain(".inbox :global(.row .icon.del) {")
  })

  test("the phone remembers the height per app and the collapse per server", () => {
    expect(prefs).toContain(`export const INBOX_HEIGHT_KEY = "occ.drawer.inboxHeight"`)
    expect(prefs).toContain("return `occ.drawer.inbox.${profileID}`")
    expect(drawer).toContain('inboxCollapsedKey(model.profile?.id ?? "")')
    expect(drawer).toContain("setInboxHeight(inboxPending)")
    expect(drawer).toContain("localStorage.setItem(INBOX_HEIGHT_KEY, serializeInboxHeight(inboxHeightWanted))")
    expect(drawer).toContain("bind:clientHeight={drawerHeight}")
    expect(drawer).toContain("bind:clientHeight={headHeight}")
    expect(drawer).toContain("bind:clientHeight={searchHeight}")
    expect(drawer).toContain("bind:clientHeight={footHeight}")
  })

  test("the phone's handle is a finger-sized target that does not scroll the list", () => {
    expect(drawer).toContain("height: var(--touch)")
    expect(drawer).toContain("touch-action: none")
    expect(drawer).toContain("const PHONE_INBOX: InboxSizing")
    expect(drawer).toContain("sash: 48")
    expect(drawer).toContain("ondblclick={resetInboxHeight}")
    expect(drawer).toContain("aria-valuemin={inboxHeightRange(listArea, PHONE_INBOX).min}")
    // A collapsed section has no handle to drag.
    expect(drawer).toMatch(/\{#if !inboxCollapsed\}[\s\S]*?class="isash"[\s\S]*?\{\/if\}/)
  })

  test("the row says its project, on both hosts", () => {
    expect(pane).toContain(`{#if row.project}<span class="proj" title={row.project}>{row.project}</span>{/if}`)
    expect(drawer).toContain(`{#if project}<span class="proj">{project}</span>{/if}`)
    expect(drawer).toContain("{@render sessionRow(session, session.directory, session.project)}")
  })

  test("the changelog announces it in a section newer than 0.3.19", () => {
    // Checks the position, not the heading, so the test survives "Unreleased" becoming a version at release time.
    const entry = changelog.indexOf("An Active section at the bottom of the sessions list")
    expect(entry).toBeGreaterThan(-1)
    expect(entry).toBeLessThan(changelog.indexOf("## 0.3.19 (preview)"))
  })
})
