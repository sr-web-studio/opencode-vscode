import { describe, expect, test } from "bun:test"
import type { EventEnvelope } from "@occ/core/api"
import type { AppState } from "@occ/core/protocol"
import { applyStatePatch, diffState, type ItemPatchOps, type StepPatch, type StepPatchOps, type TurnPatchOps } from "@occ/core/state-post"
import { applyEvent, emptyView, prependView } from "@occ/core/transcript/reducer"
import type { SessionView, StepItem, StepView, TurnView } from "@occ/core/transcript/types"

/**
 * A streaming answer grows one text item inside one step. The patch must carry that item's tail, not the text so far,
 * and it must still apply to exactly the next state — the fuzz test at the bottom holds that for every shape the
 * reducer can produce.
 */

const text = (key: string, body: string, streaming = false): StepItem => ({ kind: "text", key, text: body, streaming })
const step = (id: string, items: StepItem[], extra: Partial<StepView> = {}): StepView => ({ id, items, ...extra })
const turn = (id: string, steps: StepView[], extra: Partial<TurnView> = {}): TurnView => ({ id, user: { id, text: `prompt ${id}` }, steps, outcome: "succeeded", ...extra })
const view = (turns: TurnView[], extra: Partial<SessionView> = {}): SessionView => ({ turns, queued: [], loaded: true, ...extra })

function state(v: SessionView): AppState {
  return {
    connection: { status: "connected" },
    settings: { fontSize: 14 },
    directory: "/w",
    folderName: "w",
    displayPath: "~/w",
    target: { kind: "session", id: "ses_a" },
    sessions: [],
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
    voice: { engine: "local", ready: true, capture: false, recording: "off", languages: ["en"] },
    commands: [],
    skills: [],
    mcp: {},
  } as unknown as AppState
}

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** The step ops chosen for the single changed step of one changed turn. */
function stepPatch(prev: SessionView, next: SessionView): StepPatch {
  const patch = diffState(state(prev), state(next))
  const turns = patch?.view?.turns
  expect(turns?.kind).toBe("changes")
  const changes = (turns as Extract<TurnPatchOps, { kind: "changes" }>).changes
  expect(changes).toHaveLength(1)
  expect(applyStatePatch(state(prev), roundTrip(patch!)).view).toEqual(next)
  const steps = (changes[0] as { steps?: StepPatchOps }).steps
  expect(steps?.kind).toBe("changes")
  const stepChanges = (steps as Extract<StepPatchOps, { kind: "changes" }>).changes
  expect(stepChanges).toHaveLength(1)
  return stepChanges[0]!
}

/** The item ops of one changed step. */
function itemPatch(prev: SessionView, next: SessionView): ItemPatchOps | undefined {
  const patch = stepPatch(prev, next)
  expect(patch.kind).toBe("partial")
  return (patch as Extract<StepPatch, { kind: "partial" }>).items
}

describe("a changed step carries its items, not the step", () => {
  test("a text item that grew sends only its tail", () => {
    const before = view([turn("t1", [step("s1", [text("text:0", "x".repeat(9000), true)])])])
    const after = view([turn("t1", [step("s1", [text("text:0", "x".repeat(9000) + " more", true)])])])
    const items = itemPatch(before, after)!
    expect(items).toEqual({ kind: "changes", changes: [{ index: 0, from: 9000, text: " more" }] })
    // The whole 9 kB body is not in the message.
    expect(JSON.stringify(diffState(state(before), state(after)))).not.toContain("x".repeat(100))
  })

  test("a tool item next to the growing text is not sent again", () => {
    const tool: StepItem = { kind: "tool", id: "tool-1", name: "bash", status: "completed", input: {}, metadata: {}, output: "y".repeat(8000) }
    const before = view([turn("t1", [step("s1", [tool, text("text:0", "start", true)])])])
    const after = view([turn("t1", [step("s1", [tool, text("text:0", "start and more", true)])])])
    const patch = diffState(state(before), state(after))!
    expect(JSON.stringify(patch)).not.toContain("y".repeat(100))
    expect(itemPatch(before, after)).toEqual({ kind: "changes", changes: [{ index: 1, from: 5, text: " and more" }] })
  })

  test("an item that stops streaming without new text only carries the flag", () => {
    const before = view([turn("t1", [step("s1", [text("text:0", "done", true)])])])
    const after = view([turn("t1", [step("s1", [text("text:0", "done", false)])])])
    expect(itemPatch(before, after)).toEqual({ kind: "changes", changes: [{ index: 0, from: 4, text: "", streaming: false }] })
  })

  test("text that shrank or was rewritten sends the item whole", () => {
    const before = view([turn("t1", [step("s1", [text("text:0", "a long answer", true)])])])
    const shorter = view([turn("t1", [step("s1", [text("text:0", "a long", false)])])])
    expect(itemPatch(before, shorter)).toEqual({ kind: "changes", changes: [{ index: 0, item: text("text:0", "a long", false) }] })
    const rewritten = view([turn("t1", [step("s1", [text("text:0", "a different answer", false)])])])
    expect(itemPatch(before, rewritten)).toEqual({ kind: "changes", changes: [{ index: 0, item: text("text:0", "a different answer", false) }] })
  })

  test("a changed key or kind sends the item whole", () => {
    const before = view([turn("t1", [step("s1", [text("text:0", "abc", true)])])])
    const keyed = view([turn("t1", [step("s1", [text("text:1", "abcd", true)])])])
    expect(itemPatch(before, keyed)).toEqual({ kind: "changes", changes: [{ index: 0, item: text("text:1", "abcd", true) }] })
    const reasoning = view([turn("t1", [step("s1", [{ kind: "reasoning", key: "text:0", text: "abcd", streaming: true }])])])
    expect(itemPatch(before, reasoning)).toEqual({ kind: "changes", changes: [{ index: 0, item: { kind: "reasoning", key: "text:0", text: "abcd", streaming: true } }] })
  })

  test("a reasoning item that grew also sends only its tail", () => {
    const before = view([turn("t1", [step("s1", [{ kind: "reasoning", key: "reasoning:0", text: "thinking", streaming: true }])])])
    const after = view([turn("t1", [step("s1", [{ kind: "reasoning", key: "reasoning:0", text: "thinking hard", streaming: true }])])])
    expect(itemPatch(before, after)).toEqual({ kind: "changes", changes: [{ index: 0, from: 8, text: " hard" }] })
  })

  test("a new item is appended", () => {
    const one = text("text:0", "one")
    const before = view([turn("t1", [step("s1", [one])])])
    const after = view([turn("t1", [step("s1", [one, text("text:1", "two")])])])
    expect(itemPatch(before, after)).toEqual({ kind: "append", from: 1, items: [text("text:1", "two")] })
  })

  test("a step whose head changed but whose items did not sends no items", () => {
    const items = [text("text:0", "answer")]
    const before = view([turn("t1", [step("s1", items)])])
    const after = view([turn("t1", [step("s1", items, { completed: 10 })])])
    const change = stepPatch(before, after)
    expect(change.kind).toBe("partial")
    expect((change as Extract<StepPatch, { kind: "partial" }>).items).toBeUndefined()
    expect(change.step).toEqual({ id: "s1", completed: 10 })
  })

  test("a different step id sends the step whole", () => {
    const items = [text("text:0", "one")]
    const before = view([turn("t1", [step("s1", items)])])
    const after = view([turn("t1", [step("s2", items)])])
    expect(stepPatch(before, after)).toMatchObject({ kind: "whole", step: { id: "s2" } })
  })

  test("a field the new step no longer sets sends the step whole", () => {
    const items = [text("text:0", "one")]
    const before = view([turn("t1", [step("s1", items, { error: "boom" })])])
    const after = view([turn("t1", [step("s1", items)])])
    expect(stepPatch(before, after)).toMatchObject({ kind: "whole" })
  })

  test("a field the new turn no longer sets sends the turn whole", () => {
    const before = view([turn("t1", [step("s1", [])], { error: "boom" })])
    const after = view([turn("t1", [step("s1", [text("text:0", "hi")])])])
    const patch = diffState(state(before), state(after))!
    const changes = (patch.view!.turns as Extract<TurnPatchOps, { kind: "changes" }>).changes
    expect(changes[0]).toMatchObject({ turn: { id: "t1" } })
    expect((changes[0] as unknown as { turn: TurnView }).turn.steps).toBeDefined()
  })
})

describe("applyStatePatch item ops", () => {
  test("a tail that does not continue the text throws", () => {
    const prev = state(view([turn("t1", [step("s1", [text("text:0", "abc")])])]))
    const patch = {
      view: {
        turns: {
          kind: "changes" as const,
          changes: [
            {
              index: 0,
              turn: { id: "t1" },
              steps: {
                kind: "changes" as const,
                changes: [{ index: 0, kind: "partial" as const, step: { id: "s1" }, items: { kind: "changes" as const, changes: [{ index: 0, from: 99, text: "x" }] } }],
              },
            },
          ],
        },
      },
    }
    expect(() => applyStatePatch(prev, patch as never)).toThrow()
  })

  test("an item index out of range throws", () => {
    const prev = state(view([turn("t1", [step("s1", [text("text:0", "abc")])])]))
    const patch = {
      view: {
        turns: {
          kind: "changes" as const,
          changes: [
            {
              index: 0,
              turn: { id: "t1" },
              steps: {
                kind: "changes" as const,
                changes: [{ index: 0, kind: "partial" as const, step: { id: "s1" }, items: { kind: "changes" as const, changes: [{ index: 3, item: text("text:3", "x") }] } }],
              },
            },
          ],
        },
      },
    }
    expect(() => applyStatePatch(prev, patch as never)).toThrow()
  })
})

/* ------------------------------------------------------------------ fuzz */

/** mulberry32: the same seed replays the same walk, so a failure names its seed. */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(rand: () => number, list: readonly T[]): T | undefined => (list.length === 0 ? undefined : list[Math.floor(rand() * list.length)])
const WORDS = ["alpha", "beta", " ", "gamma", "\n", "delta", "é", "🙂"]
const word = (rand: () => number): string => WORDS[Math.floor(rand() * WORDS.length)]!

function stepsOf(v: SessionView): StepView[] {
  return v.turns.flatMap((t) => t.steps)
}

/** One event the reducer understands, aimed at what the current view holds. */
function randomEvent(rand: () => number, v: SessionView): EventEnvelope {
  const steps = stepsOf(v)
  const target = pick(rand, steps)
  const messageID = target?.id ?? `m${Math.floor(rand() * 4)}`
  const texts = target?.items.filter((i) => i.kind === "text") ?? []
  const ordinal = texts.length > 0 && rand() < 0.7 ? Number((pick(rand, texts) as { key: string }).key.slice("text:".length)) : Math.floor(rand() * 3)
  const tools = target?.items.filter((i) => i.kind === "tool") ?? []
  const tool = pick(rand, tools) as { id: string } | undefined
  const toolID = tool?.id ?? `tool-${Math.floor(rand() * 3)}`
  const created = 1000 + Math.floor(rand() * 1000)
  const kind = Math.floor(rand() * 27)
  switch (kind) {
    case 0:
    case 1:
    case 2:
      return { type: "session.text.delta", created, data: { assistantMessageID: messageID, ordinal, delta: word(rand) } }
    case 3:
      return { type: "session.text.started", created, data: { assistantMessageID: messageID, ordinal } }
    case 4:
    case 5: {
      const current = target?.items.find((i) => i.kind === "text" && i.key === `text:${ordinal}`) as { text?: string } | undefined
      const body = current?.text ?? ""
      // Sometimes the final text is shorter than what streamed: the item must travel whole.
      const next = rand() < 0.25 ? body.slice(0, Math.floor(body.length / 2)) : body + word(rand)
      return { type: "session.text.ended", created, data: { assistantMessageID: messageID, ordinal, text: next } }
    }
    case 6:
    case 7:
      return { type: "session.reasoning.delta", created, data: { assistantMessageID: messageID, ordinal: Math.floor(rand() * 2), delta: word(rand) } }
    case 8:
      return { type: "session.reasoning.ended", created, data: { assistantMessageID: messageID, ordinal: Math.floor(rand() * 2), text: `thought ${word(rand)}` } }
    case 9:
      return { type: "session.tool.called", created, data: { assistantMessageID: messageID, id: toolID, input: { command: word(rand) } } }
    case 10:
      return {
        type: "session.tool.success",
        created,
        data: { assistantMessageID: messageID, id: toolID, content: [{ type: "text", text: `${word(rand)} output`.repeat(1 + Math.floor(rand() * 5)) }] },
      }
    case 11:
      return { type: "session.tool.failed", created, data: { assistantMessageID: messageID, id: toolID, error: { message: word(rand) }, content: [{ type: "text", text: word(rand) }] } }
    case 12:
      return { type: "session.tool.progress", created, data: { assistantMessageID: messageID, id: toolID, metadata: { line: Math.floor(rand() * 9) } } }
    case 13:
      return { type: "session.tool.input.delta", created, data: { assistantMessageID: messageID, id: toolID, delta: word(rand) } }
    case 14:
      return { type: "session.step.started", created, data: { assistantMessageID: messageID, agent: "build" } }
    case 15:
      return { type: "session.step.ended", created, data: { assistantMessageID: messageID, finish: "stop" } }
    case 16:
      return { type: "session.step.failed", created, data: { assistantMessageID: messageID, error: { message: word(rand) } } }
    case 17:
      return { type: "session.execution.succeeded", created, data: {} }
    case 18:
      return { type: "session.execution.failed", created, data: { error: { message: word(rand) } } }
    case 19:
      return { type: "session.execution.interrupted", created, data: {} }
    case 20:
      return { type: "session.inbox.enqueued", created, data: { inboxID: `q${Math.floor(rand() * 3)}`, item: { type: "user", payload: { text: `queued ${word(rand)}` } } } }
    case 21:
      return { type: "session.inbox.delivery.changed", created, data: { inboxID: `q${Math.floor(rand() * 3)}`, delivery: rand() < 0.5 ? "steer" : "queue" } }
    case 22:
      return { type: "session.inbox.delivered", created, data: { inboxID: `q${Math.floor(rand() * 3)}` } }
    case 23:
      return { type: "session.inbox.cancelled", created, data: { inboxID: `q${Math.floor(rand() * 3)}` } }
    case 24:
      return { type: "session.compaction.started", created, data: { reason: word(rand) } }
    case 25:
      return { type: "session.compaction.delta", created, data: { text: word(rand), reason: "auto" } }
    default:
      return { type: rand() < 0.5 ? "session.compaction.ended" : "session.compaction.failed", created, data: { text: `summary ${word(rand)}`, reason: "auto" } }
  }
}

/** An edit the reducer would not make: the diff must still be exact, or fall back to sending the step whole. */
function mutate(rand: () => number, v: SessionView): SessionView {
  const turns = v.turns
  if (turns.length === 0) return v
  const turnIndex = Math.floor(rand() * turns.length)
  const target = turns[turnIndex]!
  const kind = Math.floor(rand() * 12)
  if (kind === 0 && target.steps.length > 0) {
    const at = Math.floor(rand() * target.steps.length)
    const step = target.steps[at]!
    if (step.items.length === 0) return v
    const itemAt = Math.floor(rand() * step.items.length)
    const item = step.items[itemAt]!
    // A rewritten body: shorter, longer but different, or the same length.
    const body = "abc".repeat(Math.floor(rand() * 4))
    const items = step.items.slice()
    items[itemAt] = item.kind === "text" || item.kind === "reasoning" ? { ...item, text: body, streaming: !item.streaming } : { ...item, output: body }
    return { ...v, turns: turns.map((t, i) => (i === turnIndex ? { ...t, steps: t.steps.map((s, j) => (j === at ? { ...s, items } : s)) } : t)) }
  }
  if (kind === 1 && target.steps.length > 0) {
    const at = Math.floor(rand() * target.steps.length)
    const step = target.steps[at]!
    if (step.items.length === 0) return v
    const items = step.items.filter((_, i) => i !== Math.floor(rand() * step.items.length))
    return { ...v, turns: turns.map((t, i) => (i === turnIndex ? { ...t, steps: t.steps.map((s, j) => (j === at ? { ...s, items } : s)) } : t)) }
  }
  if (kind === 2 && target.steps.length > 0) {
    const at = Math.floor(rand() * target.steps.length)
    const step = target.steps[at]!
    const copy = step.items.length > 0 ? step.items[Math.floor(rand() * step.items.length)]! : text("text:9", "x")
    const items = step.items.slice()
    items.splice(Math.floor(rand() * (items.length + 1)), 0, copy)
    return { ...v, turns: turns.map((t, i) => (i === turnIndex ? { ...t, steps: t.steps.map((s, j) => (j === at ? { ...s, items } : s)) } : t)) }
  }
  if (kind === 3) {
    // A step with a new id in the same place: a different step, sent whole.
    return { ...v, turns: turns.map((t, i) => (i === turnIndex ? { ...t, steps: t.steps.map((s, j) => (j === 0 ? { ...s, id: `${s.id}-other` } : s)) } : t)) }
  }
  if (kind === 4 && target.steps.length > 0) {
    const steps = target.steps.filter((_, i) => i !== Math.floor(rand() * target.steps.length))
    return { ...v, turns: turns.map((t, i) => (i === turnIndex ? { ...t, steps } : t)) }
  }
  if (kind === 5) {
    const steps = target.steps.slice()
    steps.unshift(step(`inserted-${rand()}`, [text("text:0", "inserted")]))
    return { ...v, turns: turns.map((t, i) => (i === turnIndex ? { ...t, steps } : t)) }
  }
  if (kind === 6) {
    // A field dropped from a step: `undefined` is not JSON, so the step must go whole.
    return { ...v, turns: turns.map((t, i) => (i === turnIndex ? { ...t, steps: t.steps.map((s) => ({ ...s, error: undefined })) } : t)) }
  }
  if (kind === 7) {
    return { ...v, turns: turns.map((t, i) => (i === turnIndex ? { ...t, error: rand() < 0.5 ? "boom" : undefined, ended: 5 } : t)) }
  }
  if (kind === 8) {
    // A turn inserted in the middle: not an append, not a prepend.
    const turnsNext = turns.slice()
    turnsNext.splice(Math.max(0, Math.floor(rand() * turns.length)), 0, turn(`inserted-${rand()}`, [step(`s-${rand()}`, [text("text:0", "hi")])], { outcome: undefined }))
    return { ...v, turns: turnsNext }
  }
  if (kind === 9) {
    return { ...v, turns: turns.filter((_, i) => i !== turnIndex) }
  }
  if (kind === 10) {
    return { ...v, revert: rand() < 0.5 ? { messageID: target.user?.id ?? target.id, files: Math.floor(rand() * 3) } : undefined }
  }
  return { ...v, queued: rand() < 0.5 ? [{ id: `q${Math.floor(rand() * 3)}`, text: word(rand), delivery: rand() < 0.5 ? "queue" : "steer" }] : [] }
}

describe("diff/apply fuzz", () => {
  const WALKS = 400
  const STEPS = 25
  test(`${WALKS} random walks of ${STEPS} reducer events and edits apply exactly`, () => {
    let patches = 0
    let tails = 0
    for (let seed = 1; seed <= WALKS; seed++) {
      const rand = random(seed * 7919)
      let current: SessionView = emptyView()
      for (let i = 0; i < STEPS; i++) {
        const next = rand() < 0.25 ? mutate(rand, current) : applyEvent(current, randomEvent(rand, current))
        if (next === current) continue
        const before = state(current)
        const after = state(next)
        const patch = diffState(before, after)
        if (patch) {
          patches++
          const json = JSON.stringify(patch)
          const applied = applyStatePatch(before, JSON.parse(json))
          // A message is JSON: compare the two states as the webview would hold them.
          expect({ seed, step: i, applied: roundTrip(applied) }).toEqual({ seed, step: i, applied: roundTrip(after) })
          tails += json.split('"from"').length - 1
        } else {
          expect({ seed, step: i, applied: roundTrip(before) }).toEqual({ seed, step: i, applied: roundTrip(after) })
        }
        current = next
      }
    }
    // The walk must actually exercise the lean path, not only whole steps.
    expect(patches).toBeGreaterThan(WALKS * 5)
    expect(tails).toBeGreaterThan(WALKS)
  })

  test("a long streaming answer stays small from the first token to the last", () => {
    let current: SessionView = emptyView()
    const sizes: number[] = []
    const rand = random(42)
    for (let i = 0; i < 500; i++) {
      const next = applyEvent(current, { type: "session.text.delta", created: i, data: { assistantMessageID: "m1", ordinal: 0, delta: `chunk ${i}: ${word(rand)} ` } })
      const patch = diffState(state(current), state(next))
      sizes.push(patch ? JSON.stringify(patch).length : 0)
      current = next
    }
    const total = (from: number, to: number) => sizes.slice(from, to).reduce((n, size) => n + size, 0)
    const full = JSON.stringify(state(current).view).length
    // A patch is the protocol's own overhead plus the tail: it does not grow with the answer.
    expect(Math.max(...sizes)).toBeLessThan(400)
    expect(total(400, 500)).toBeLessThan(total(0, 100) * 2)
    expect(full).toBeGreaterThan(Math.max(...sizes) * 20)
  })

  test("show earlier prepends the older turns and stays exact", () => {
    const current = view([turn("t2", [step("s2", [text("text:0", "answer", true)])])])
    const older = view([turn("t1", [step("s1", [text("text:0", "older")])])])
    const next = prependView(current, older)
    const patch = diffState(state(current), state(next))!
    expect(patch.view?.turns).toMatchObject({ kind: "prepend" })
    expect(applyStatePatch(state(current), roundTrip(patch)).view).toEqual(next)
  })
})
