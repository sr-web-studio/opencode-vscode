import { describe, expect, test } from "bun:test"
import type { AppState } from "@occ/core/protocol"
import { applyStatePatch, diffState, sameValue } from "@occ/core/state-post"
import type { SessionView, StepView, TextItem, TurnView } from "@occ/core/transcript/types"

/**
 * The host posts only what changed since the last state. These tests hold the contract the webview relies on: applying
 * a patch to the previous state gives the next state, and the patch is small for the shapes a streaming session makes.
 */

const text = (key: string, body: string, streaming = false): TextItem => ({ kind: "text", key, text: body, streaming })
const step = (id: string, items: StepView["items"]): StepView => ({ id, items })
const turn = (id: string, steps: StepView[], user = id): TurnView => ({ id, user: { id: user, text: `prompt ${user}` }, steps, outcome: "succeeded" })

const view = (turns: TurnView[], extra: Partial<SessionView> = {}): SessionView => ({ turns, queued: [], loaded: true, ...extra })

/** A full state with the fresh arrays `snapshot()` builds on every call. */
function state(v: SessionView): AppState {
  return {
    connection: { status: "connected" },
    settings: { fontSize: 14 },
    directory: "/w",
    folderName: "w",
    displayPath: "~/w",
    target: { kind: "session", id: "ses_a" },
    sessions: [{ id: "ses_a", title: "A", time: { created: 1, updated: 2 } } as never],
    archived: [],
    showArchived: false,
    sessionsLoaded: true,
    running: [],
    waiting: [],
    workerRunning: {},
    view: v,
    loadingView: false,
    permissions: [],
    agents: [],
    models: [],
    providers: [],
    sending: false,
    focusTick: 0,
    draftEpoch: 0,
    readOnly: false,
    workers: [],
    hiddenWorkers: [],
    runningShells: 0,
    pins: [],
    features: {},
    hasEarlier: false,
    loadingEarlier: false,
    sentTick: 0,
    enhance: { status: "idle" },
    enhanceDefault: undefined,
    voice: { engine: "local", ready: true, capture: false, recording: "off", languages: ["en"] },
    commands: [],
    skills: [],
    mcp: {},
  } as unknown as AppState
}

const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe("diffState", () => {
  test("nothing changed: no message at all, even though snapshot() rebuilds its arrays and records", () => {
    const prev = state(view([turn("t1", [step("s1", [text("k", "hi")])])]))
    const next = state(view([turn("t1", [step("s1", [text("k", "hi")])])]))
    // The transcript is the same objects in the real snapshot; here the rest of the state must still compare by value.
    next.view = prev.view
    expect(diffState(prev, next)).toBeUndefined()
  })

  test("a changed list carries only that list", () => {
    const prev = state(view([]))
    const next = { ...prev, running: ["ses_a"], workerRunning: { ses_a: 1 } }
    const patch = diffState(prev, next)!
    expect(Object.keys(patch).sort()).toEqual(["running", "workerRunning"])
    expect(applyStatePatch(prev, roundTrip(patch))).toEqual(next)
  })

  test("a streaming delta sends the changed step, not the transcript", () => {
    const before = view([turn("t1", [step("s1", [text("k", "a".repeat(4000))])]), turn("t2", [step("s2", [text("k2", "b".repeat(4000))])])])
    const prev = state(before)
    const after: SessionView = {
      ...before,
      turns: [before.turns[0]!, { ...before.turns[1]!, steps: [step("s2", [text("k2", "b".repeat(4000) + " more")])] }],
    }
    const next = state(after)
    const patch = diffState(prev, next)!
    const json = JSON.stringify(patch)
    // Only the changed step travels: not the other 4 KB turn, and none of the rest of the state.
    expect(json).not.toContain("a".repeat(100))
    expect(json.length).toBeLessThan(JSON.stringify(next).length / 2)
    expect(applyStatePatch(prev, roundTrip(patch))).toEqual(next)
  })

  test("a new turn is appended, and earlier turns are prepended", () => {
    const first = turn("t1", [step("s1", [text("k", "one")])])
    const prev = state(view([first]))
    const added = { ...prev, view: view([first, turn("t2", [step("s2", [text("k2", "two")])])]) }
    const appendPatch = diffState(prev, added)!
    expect(appendPatch.view?.turns).toMatchObject({ kind: "append", from: 1 })
    expect(applyStatePatch(prev, roundTrip(appendPatch))).toEqual(added)

    const older = turn("t0", [step("s0", [text("k0", "zero")])])
    const withOlder = { ...added, view: view([older, ...added.view.turns]) }
    const prependPatch = diffState(added, withOlder)!
    expect(prependPatch.view?.turns).toMatchObject({ kind: "prepend" })
    expect(applyStatePatch(added, roundTrip(prependPatch))).toEqual(withOlder)
  })

  test("a trimmed transcript (compaction) is sent whole", () => {
    const prev = state(view([turn("t1", [step("s1", [])]), turn("t2", [step("s2", [])])]))
    const next = { ...prev, view: view([turn("t2", [step("s2", [])])]) }
    const patch = diffState(prev, next)!
    expect(patch.view?.turns).toMatchObject({ kind: "full" })
    expect(applyStatePatch(prev, roundTrip(patch))).toEqual(next)
  })

  test("queued prompts, the loaded flag and a staged revert travel on their own", () => {
    const prev = state(view([]))
    const next = { ...prev, view: view([], { queued: [{ id: "q1", text: "later", delivery: "queue" as const }], loaded: false, revert: { messageID: "m1", files: 2 } }) }
    const patch = diffState(prev, next)!
    expect(patch.view).toEqual({ queued: next.view.queued, loaded: false, revert: { messageID: "m1", files: 2 } })
    expect(applyStatePatch(prev, roundTrip(patch))).toEqual(next)
  })

  test("a key that disappears is cleared", () => {
    const prev = { ...state(view([])), error: "boom" }
    const next = state(view([]))
    const patch = diffState(prev, next)!
    expect(patch.cleared).toContain("error")
    expect(applyStatePatch(prev, roundTrip(patch)).error).toBeUndefined()
  })
})

describe("applyStatePatch", () => {
  test("a patch that does not fit throws, so the webview can ask for a full state", () => {
    const prev = state(view([turn("t1", [step("s1", [])])]))
    const patch = { view: { turns: { kind: "append" as const, from: 5, turns: [] } } }
    expect(() => applyStatePatch(prev, patch)).toThrow()
  })
})

describe("sameValue", () => {
  test("compares by value for the small shapes snapshot() rebuilds, and by identity otherwise", () => {
    expect(sameValue([1, 2], [1, 2])).toBe(true)
    expect(sameValue([1, 2], [1, 3])).toBe(false)
    expect(sameValue({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true)
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameValue(undefined, undefined)).toBe(true)
    expect(sameValue(null, undefined)).toBe(false)
  })
})
