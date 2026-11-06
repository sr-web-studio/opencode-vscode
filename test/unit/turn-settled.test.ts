import { describe, expect, test } from "bun:test"
import fixtureA from "../fixtures/simple-edit-shell.json"
import fixtureB from "../fixtures/grep-glob-subagent-question.json"
import { viewFromMessages } from "../../src/core/transcript/reducer"
import { lastActivity, settledTurn } from "../../src/core/transcript/turn"
import type { TurnView } from "../../src/core/transcript/types"
import { moment, turnStamp, type TimeEnv } from "../../src/core/turn-time"

const env: TimeEnv = { now: Date.UTC(2026, 10, 6, 9, 30), locale: "en-US", timeZone: "Asia/Dhaka" }
const at = (h: number, m = 0) => Date.UTC(2026, 10, 6, h - 6, m) // Dhaka is UTC+6

const text = (t: string) => ({ kind: "text" as const, key: "text:0", text: t, streaming: false })
const step = (id: string, started: number, completed: number | undefined, items: TurnView["steps"][number]["items"]) => ({ id, started, completed, items })

describe("settledTurn", () => {
  const base = (): TurnView => ({ id: "u", user: { id: "u", text: "..", created: at(14, 0) }, started: at(14, 0), steps: [step("a", at(14, 0), at(14, 1), [text("done")])] })

  test("a turn without an execution marker gets outcome and end time from its last step", () => {
    const t = settledTurn(base(), { last: false, running: false })
    expect(t.outcome).toBe("succeeded")
    expect(t.ended).toBe(at(14, 1))
    expect(turnStamp(t, env)!.text).toBe("2:01 PM · 1m 00s")
  })

  test("the end time prefers the latest tool or step time", () => {
    const turn: TurnView = {
      ...base(),
      steps: [
        step("a", at(14, 0), at(14, 0), [{ kind: "tool", id: "t", name: "shell", status: "completed", input: {}, metadata: {}, output: "", created: at(14, 0), completed: at(14, 5) }]),
        step("b", at(14, 6), undefined, [text("answer")]),
      ],
    }
    expect(lastActivity(turn)).toBe(at(14, 6))
    expect(settledTurn(turn, { last: false, running: false }).ended).toBe(at(14, 6))
  })

  test("the running turn (last, session running) is left alone and shows no stamp", () => {
    const t = settledTurn(base(), { last: true, running: true })
    expect(t.outcome).toBeUndefined()
    expect(turnStamp(t, env)).toBeUndefined()
  })

  test("the last turn of an idle session is settled", () => {
    expect(settledTurn(base(), { last: true, running: false }).outcome).toBe("succeeded")
  })

  test("a turn with nothing in it, a compaction and an already finished turn are returned as they are", () => {
    const empty: TurnView = { id: "e", user: { id: "e", text: "x" }, steps: [] }
    expect(settledTurn(empty, { last: false, running: false })).toBe(empty)
    const compaction: TurnView = { id: "c", compaction: { summary: "s" }, steps: [] }
    expect(settledTurn(compaction, { last: false, running: false })).toBe(compaction)
    const done: TurnView = { ...base(), outcome: "failed", ended: at(14, 3) }
    expect(settledTurn(done, { last: false, running: false })).toBe(done)
  })

  test("a settled turn without any time anywhere keeps the outcome and just has no stamp", () => {
    const turn: TurnView = { id: "n", user: { id: "n", text: "x" }, steps: [{ id: "a", items: [text("ok")] }] }
    const t = settledTurn(turn, { last: false, running: false })
    expect(t.outcome).toBe("succeeded")
    expect(turnStamp(t, env)).toBeUndefined()
  })
})

describe("turns loaded from history", () => {
  test("every finished turn of the fixtures has a stamp", () => {
    for (const fixture of [fixtureA, fixtureB]) {
      const view = viewFromMessages(fixture.messages as any)
      const finished = view.turns.filter((t) => t.outcome)
      expect(finished.length).toBeGreaterThan(0)
      for (const t of finished) expect(turnStamp(t, { ...env, now: (t.ended ?? 0) + 1000 })).toBeDefined()
    }
  })

  test("history that lost its idle markers still ends each earlier turn when the next prompt starts", () => {
    const messages = (fixtureA.messages as any[]).filter((m) => m.type !== "idle")
    const view = viewFromMessages(messages)
    expect(view.turns.length).toBe(2)
    expect(view.turns[0]!.outcome).toBe("succeeded")
    expect(view.turns[0]!.ended).toBeDefined()
    expect(turnStamp(view.turns[0]!, env)).toBeDefined()
    // The last turn has no marker: it may still be running, so the view leaves it open ...
    expect(view.turns[1]!.outcome).toBeUndefined()
    // ... and the UI settles it only when the session is not running.
    const idle = settledTurn(view.turns[1]!, { last: true, running: false })
    expect(turnStamp(idle, env)).toBeDefined()
    expect(turnStamp(settledTurn(view.turns[1]!, { last: true, running: true }), env)).toBeUndefined()
  })

  test("a turn whose prompt text is just '..' still gets its time and a duration", () => {
    const messages: any[] = [
      { id: "u1", type: "user", text: "..", time: { created: at(14, 0) } },
      { id: "a1", type: "assistant", content: [{ type: "tool", id: "t1", name: "read", state: { status: "completed", input: {}, content: [] }, time: { created: at(14, 0), completed: at(14, 0) } }], time: { created: at(14, 0), completed: at(14, 0) } },
      { id: "a2", type: "assistant", content: [{ type: "text", text: "all good" }], time: { created: at(14, 0), completed: at(14, 0) + 19_000 } },
    ]
    const v = viewFromMessages(messages)
    const t = settledTurn(v.turns[0]!, { last: true, running: false })
    expect(turnStamp(t, env)!.text).toBe("2:00 PM · 19s")
  })
})

describe("moment (prompt time in the card header)", () => {
  test("compact text and a full-date title", () => {
    const m = moment(at(14, 41), env)!
    expect(m.text).toBe("2:41 PM")
    expect(m.title).toContain("November 6, 2026")
  })
  test("a prompt from another day shows the date", () => {
    expect(moment(Date.UTC(2026, 10, 3, 8, 41), env)!.text).toBe("Nov 3, 2:41 PM")
  })
  test("no time gives nothing", () => {
    expect(moment(undefined, env)).toBeUndefined()
    expect(moment(NaN, env)).toBeUndefined()
  })
})
