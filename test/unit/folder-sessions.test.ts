import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import type { SessionInfo } from "@occ/core/api"

/**
 * The sessions pane needs every folder's rows on every refresh, so the controller offers a light summary: the same
 * rows `snapshot()` would give, without building the transcript, the workers, the features or reading globalState.
 */

const session = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, title: `Title ${id}`, projectID: "prj", time: { created: 1, updated: 2 }, location: { directory: "/w" }, ...extra }) as SessionInfo

function ready() {
  let pinsReads = 0
  const ctl = new Controller({
    directory: "/w",
    folderName: "w",
    displayPath: "/w",
    pins: {
      get: () => {
        pinsReads++
        return []
      },
      set: () => {},
    },
  })
  ;(ctl as any).sessions = [session("ses_a"), session("ses_kid", { parentID: "ses_a" }), session("ses_old", { time: { created: 1, updated: 1, archived: 5 } })]
  ;(ctl as any).running = new Set(["ses_a"])
  ;(ctl as any).permissions.set("ses_a", [{}])
  ;(ctl as any).sessionsLoaded = true
  return { ctl, pinsRead: () => pinsReads }
}

describe("the light folder summary", () => {
  test("lists the root sessions the pane shows, with running, waiting and loaded", () => {
    const { ctl } = ready()
    const summary = ctl.folderSessions()
    expect(summary.sessions.map((s) => s.id)).toEqual(["ses_a"])
    expect(summary.sessions[0]).toMatchObject({ title: "Title ses_a", outcome: undefined })
    expect(summary.running).toEqual(["ses_a"])
    expect(summary.waiting).toEqual(["ses_a"])
    expect(summary.loaded).toBe(true)
  })

  test("does not build the whole snapshot: no globalState reads, no transcript work", () => {
    const { ctl, pinsRead } = ready()
    ctl.folderSessions()
    expect(pinsRead()).toBe(0)
    ctl.snapshot()
    expect(pinsRead()).toBeGreaterThan(0)
  })

  test("workers of a root session still count as running", () => {
    const { ctl } = ready()
    ;(ctl as any).workerChildren.set("ses_w", "ses_a")
    ;(ctl as any).running = new Set(["ses_w"])
    expect(ctl.folderSessions().workerRunning).toEqual({ ses_a: 1 })
  })

  test("reuses the rows while the session list is unchanged, and rebuilds them when it changes", () => {
    const { ctl } = ready()
    const rows = ctl.folderSessions().sessions
    expect(ctl.folderSessions().sessions).toBe(rows)
    ;(ctl as any).sessions = [...(ctl as any).sessions, session("ses_new")]
    const next = ctl.folderSessions().sessions
    expect(next).not.toBe(rows)
    expect(next.map((s) => s.id)).toContain("ses_new")
  })
})
