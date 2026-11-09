import { describe, expect, test } from "bun:test"
import { MIN_WIDTH_MAX_STEPS, MIN_WIDTH_MIN_GROWTH_PX, MIN_WIDTH_STEP_PX, nextMinWidthStep, planMinWidth } from "@occ/core/min-width"

describe("min width: whether to start", () => {
  test("0, negative and non-finite mean off", () => {
    expect(planMinWidth({ minWidth: 0, width: 200, screenWidth: 1920, ran: false })).toEqual({ kind: "off" })
    expect(planMinWidth({ minWidth: -20, width: 200, screenWidth: 1920, ran: false })).toEqual({ kind: "off" })
    expect(planMinWidth({ minWidth: Number.NaN, width: 200, screenWidth: 1920, ran: false })).toEqual({ kind: "off" })
  })

  test("never runs twice in one window session", () => {
    expect(planMinWidth({ minWidth: 380, width: 200, screenWidth: 1920, ran: true })).toEqual({ kind: "already-ran" })
  })

  test("a view that is already wide enough is left alone", () => {
    expect(planMinWidth({ minWidth: 380, width: 380, screenWidth: 1920, ran: false })).toEqual({ kind: "wide-enough" })
    expect(planMinWidth({ minWidth: 380, width: 500, screenWidth: 1920, ran: false })).toEqual({ kind: "wide-enough" })
  })

  test("never grows past half of the screen", () => {
    expect(planMinWidth({ minWidth: 380, width: 900, screenWidth: 1600, ran: false })).toEqual({ kind: "over-half-screen" })
    // An unknown screen width does not block the feature.
    expect(planMinWidth({ minWidth: 380, width: 200, screenWidth: 0, ran: false })).toEqual({ kind: "start", maxSteps: 3 })
  })

  test("steps are ceil(missing / 60), capped at four", () => {
    expect(planMinWidth({ minWidth: 380, width: 379, screenWidth: 1920, ran: false })).toEqual({ kind: "start", maxSteps: 1 })
    expect(planMinWidth({ minWidth: 380, width: 200, screenWidth: 1920, ran: false })).toEqual({ kind: "start", maxSteps: 3 })
    expect(planMinWidth({ minWidth: 380, width: 100, screenWidth: 1920, ran: false })).toEqual({ kind: "start", maxSteps: 4 })
    expect(planMinWidth({ minWidth: 900, width: 100, screenWidth: 1920, ran: false })).toEqual({ kind: "start", maxSteps: MIN_WIDTH_MAX_STEPS })
    expect(MIN_WIDTH_STEP_PX).toBe(60)
  })
})

describe("min width: after a step", () => {
  const base = { minWidth: 380, width: 320, before: 260, steps: 1, maxSteps: 3, focused: true, screenWidth: 1920 }

  test("reaching the minimum is success", () => {
    expect(nextMinWidthStep({ ...base, width: 380 })).toEqual({ kind: "done", reason: "reached" })
    expect(nextMinWidthStep({ ...base, width: 400 })).toEqual({ kind: "done", reason: "reached" })
    // Reaching it wins even if focus moved on during the same step.
    expect(nextMinWidthStep({ ...base, width: 380, focused: false })).toEqual({ kind: "done", reason: "reached" })
  })

  test("another step while it is still too narrow", () => {
    expect(nextMinWidthStep(base)).toEqual({ kind: "step" })
  })

  test("aborts on the half-screen cap", () => {
    expect(nextMinWidthStep({ ...base, width: 900, screenWidth: 1600 })).toEqual({ kind: "stop", reason: "over-half-screen" })
  })

  test("aborts when the webview lost focus", () => {
    expect(nextMinWidthStep({ ...base, focused: false })).toEqual({ kind: "stop", reason: "unfocused" })
  })

  test("aborts when a step grew the view by less than 10px", () => {
    expect(nextMinWidthStep({ ...base, width: base.before + MIN_WIDTH_MIN_GROWTH_PX - 1 })).toEqual({ kind: "stop", reason: "no-growth" })
    expect(nextMinWidthStep({ ...base, width: base.before })).toEqual({ kind: "stop", reason: "no-growth" })
    expect(nextMinWidthStep({ ...base, width: base.before - 20 })).toEqual({ kind: "stop", reason: "no-growth" })
    expect(nextMinWidthStep({ ...base, width: base.before + MIN_WIDTH_MIN_GROWTH_PX })).toEqual({ kind: "step" })
  })

  test("aborts after the last allowed step", () => {
    expect(nextMinWidthStep({ ...base, steps: 3, maxSteps: 3 })).toEqual({ kind: "stop", reason: "max-steps" })
  })
})
