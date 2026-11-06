import { beforeEach, describe, expect, test } from "bun:test"
import { COALESCE_MS, NotificationEngine, noticeID } from "../../src/core/notifications/engine"
import { defaultNotificationSettings, type Notice, type Notifier, type NotificationSettings, type SessionMeta, type UiState } from "../../src/core/notifications/types"

const DIR = "/proj"
const loc = { directory: DIR }

class Recorder implements Notifier {
  shown: Notice[] = []
  dismissed: string[] = []
  show(n: Notice) { this.shown.push(n) }
  dismiss(id: string) { this.dismissed.push(id) }
}

let rec: Recorder
let settings: NotificationSettings
let ui: UiState
let clock: number
let sessions: Record<string, SessionMeta>
let shells: Record<string, string>
let engine: NotificationEngine

beforeEach(() => {
  rec = new Recorder()
  settings = { ...defaultNotificationSettings }
  ui = { windowFocused: false }
  clock = 1_000_000
  sessions = { root: { title: "Fix login", directory: DIR }, child: { title: "Worker", parentID: "root", directory: DIR }, other: { title: "Elsewhere", directory: "/other" } }
  shells = { sh1: "root", sh2: "other" }
  engine = new NotificationEngine({ directory: DIR, settings: () => settings, ui: () => ui, notifier: rec, now: () => clock, session: (id) => sessions[id], shellSession: (id) => shells[id] })
})

const permission = (id = "per_1", sessionID = "root", location: any = loc) => ({ type: "permission.asked", location, data: { id, sessionID, action: "shell", resources: ["rm -rf dist"] } })
const form = (id = "frm_1", sessionID = "root") => ({ type: "form.created", location: loc, data: { form: { id, sessionID, title: "Questions", fields: [{ key: "q0", title: "Color", description: "Red or blue?", type: "string" }] } } })
const done = (sessionID = "root", type = "session.execution.succeeded", extra: any = {}) => ({ type, location: loc, data: { sessionID, ...extra } })

describe("triggers and defaults", () => {
  test("permission → warning with Open/Allow/Deny", async () => {
    await engine.handle(permission())
    const n = rec.shown[0]!
    expect(n.severity).toBe("warning")
    expect(n.kind).toBe("permission")
    expect(n.title).toBe("Fix login needs permission")
    expect(n.actions.map((a) => a.id)).toEqual(["open", "allow", "deny"])
    expect(n.body).toContain("rm -rf dist")
  })
  test("question → warning with Open only", async () => {
    await engine.handle(form())
    expect(rec.shown[0]!.kind).toBe("question")
    expect(rec.shown[0]!.actions.map((a) => a.id)).toEqual(["open"])
    expect(rec.shown[0]!.body).toBe("Red or blue?")
  })
  test("root success/failure → info", async () => {
    await engine.handle(done())
    expect(rec.shown[0]).toMatchObject({ kind: "completed", severity: "info", title: "Fix login finished" })
    clock += COALESCE_MS
    await engine.handle(done("root", "session.execution.failed", { error: { message: "rate limited\nmore" } }))
    expect(rec.shown[1]).toMatchObject({ kind: "failed", severity: "info", title: "Fix login failed", body: "rate limited" })
  })
  test("workers and shells are off by default", async () => {
    await engine.handle(done("child"))
    await engine.handle({ type: "shell.exited", location: loc, data: { id: "sh1", exit: 0, status: "exited" } })
    expect(rec.shown).toHaveLength(0)
  })
  test("workers on: child sessions notify as worker", async () => {
    settings.workers = true
    await engine.handle(done("child"))
    expect(rec.shown[0]).toMatchObject({ kind: "worker", sessionID: "child" })
    expect(rec.shown[0]!.actions.map((a) => a.id)).toEqual(["open"])
  })
  test("shells on: only shells belonging to a known session of this project", async () => {
    settings.shells = true
    await engine.handle({ type: "shell.exited", location: loc, data: { id: "sh1", exit: 2, status: "exited" } })
    expect(rec.shown[0]).toMatchObject({ kind: "shell", title: "Fix login failed", body: "Background shell exited with code 2" })
    await engine.handle({ type: "shell.exited", location: loc, data: { id: "unknown", exit: 0 } })
    await engine.handle({ type: "shell.exited", location: { directory: "/other" }, data: { id: "sh2", exit: 0 } })
    expect(rec.shown).toHaveLength(1)
  })
  test("settings gate each kind", async () => {
    settings.attention = false
    await engine.handle(permission())
    await engine.handle(form())
    settings.completed = false
    await engine.handle(done())
    expect(rec.shown).toHaveLength(0)
    settings = { ...defaultNotificationSettings, enabled: false }
    await engine.handle(permission())
    expect(rec.shown).toHaveLength(0)
  })
})

describe("per-project filtering", () => {
  test("other project's event location is ignored", async () => {
    await engine.handle(permission("per_9", "other", { directory: "/other" }))
    expect(rec.shown).toHaveLength(0)
  })
  test("falls back to the session's directory when the event has no location", async () => {
    await engine.handle({ type: "session.execution.succeeded", data: { sessionID: "other" } })
    await engine.handle({ type: "session.execution.succeeded", data: { sessionID: "root" } })
    expect(rec.shown.map((n) => n.sessionID)).toEqual(["root"])
  })
  test("unknown session without location is skipped", async () => {
    await engine.handle({ type: "session.execution.succeeded", data: { sessionID: "ghost" } })
    expect(rec.shown).toHaveLength(0)
  })
})

describe("focus suppression", () => {
  test("focused window with the session on screen is quiet by default", async () => {
    ui = { windowFocused: true, visibleSessionID: "root" }
    await engine.handle(permission())
    await engine.handle(done())
    expect(rec.shown).toHaveLength(0)
  })
  test("focused but a different session is on screen → notify", async () => {
    ui = { windowFocused: true, visibleSessionID: "child" }
    await engine.handle(done())
    expect(rec.shown).toHaveLength(1)
  })
  test("unfocused window → notify", async () => {
    ui = { windowFocused: false, visibleSessionID: "root" }
    await engine.handle(done())
    expect(rec.shown).toHaveLength(1)
  })
  test("whenFocused=always notifies anyway", async () => {
    settings.whenFocused = "always"
    ui = { windowFocused: true, visibleSessionID: "root" }
    await engine.handle(done())
    expect(rec.shown).toHaveLength(1)
  })
})

describe("coalescing", () => {
  test("one notification per session per 5 s for non-attention events", async () => {
    await engine.handle(done())
    clock += 1000
    await engine.handle(done("root", "session.execution.failed", { error: { message: "x" } }))
    expect(rec.shown).toHaveLength(1)
    clock += COALESCE_MS
    await engine.handle(done())
    expect(rec.shown).toHaveLength(2)
  })
  test("attention replaces an earlier notification inside the window", async () => {
    await engine.handle(done())
    clock += 500
    await engine.handle(permission())
    expect(rec.shown.map((n) => n.kind)).toEqual(["completed", "permission"])
    expect(rec.shown[1]!.id).toBe(rec.shown[0]!.id) // same id → the notifier replaces it
  })
  test("a later completion does not hide a waiting permission", async () => {
    await engine.handle(permission())
    clock += 1000
    await engine.handle(done())
    expect(rec.shown).toHaveLength(1)
  })
  test("different sessions do not coalesce", async () => {
    settings.workers = true
    await engine.handle(done("root"))
    await engine.handle(done("child"))
    expect(rec.shown).toHaveLength(2)
  })
  test("a replayed request is not announced twice", async () => {
    await engine.handle(permission("per_1"))
    clock += 60_000
    await engine.handle(permission("per_1"))
    expect(rec.shown).toHaveLength(1)
    await engine.handle(permission("per_2"))
    expect(rec.shown).toHaveLength(2)
  })
})

describe("auto-clear", () => {
  test("permission.replied dismisses the matching notice", async () => {
    await engine.handle(permission("per_1"))
    await engine.handle({ type: "permission.replied", data: { sessionID: "root", requestID: "per_1", reply: "once" } })
    expect(rec.dismissed).toEqual([noticeID("root")])
  })
  test("form.replied and form.cancelled dismiss the question", async () => {
    await engine.handle(form("frm_1"))
    await engine.handle({ type: "form.replied", data: { id: "frm_1", sessionID: "root", answer: {} } })
    expect(rec.dismissed).toHaveLength(1)
    clock += 10_000
    await engine.handle(form("frm_2"))
    await engine.handle({ type: "form.cancelled", data: { id: "frm_2", sessionID: "root" } })
    expect(rec.dismissed).toHaveLength(2)
  })
  test("a reply for a different request leaves the notice alone", async () => {
    await engine.handle(permission("per_2"))
    await engine.handle({ type: "permission.replied", data: { sessionID: "root", requestID: "per_1", reply: "once" } })
    expect(rec.dismissed).toHaveLength(0)
  })
  test("nothing to clear is a no-op", async () => {
    await engine.handle({ type: "form.cancelled", data: { id: "x", sessionID: "root" } })
    expect(rec.dismissed).toHaveLength(0)
  })
})

describe("actions", () => {
  test("open, allow, deny map to host commands", async () => {
    await engine.handle(permission("per_1"))
    const n = rec.shown[0]!
    expect(engine.resolveAction(n, "open")).toEqual({ type: "open", sessionID: "root" })
    expect(engine.resolveAction(n, "allow")).toEqual({ type: "permission.reply", sessionID: "root", requestID: "per_1", decision: "once" })
    expect(engine.resolveAction(n, "deny")).toEqual({ type: "permission.reply", sessionID: "root", requestID: "per_1", decision: "reject" })
    expect(engine.resolveAction(n, undefined)).toBeUndefined()
  })
  test("allow/deny are not available for non-permission notices", async () => {
    await engine.handle(done())
    expect(engine.resolveAction(rec.shown[0]!, "allow")).toBeUndefined()
  })
})
