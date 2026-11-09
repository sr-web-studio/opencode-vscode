import { describe, expect, test } from "bun:test"
import { defaultViewSettings } from "@occ/core/protocol"
import {
  ENHANCE_KEY_PREFIX,
  FONT_MAX,
  FONT_MIN,
  FONT_SIZES,
  VIEW_KEY,
  enhanceModelKey,
  enhanceModelLabel,
  parseEnhanceModel,
  parseViewSettings,
  patchViewSettings,
  resetSettingKeys,
} from "../../apps/mobile/src/lib/app-settings"

describe("chat display settings", () => {
  test("missing, junk or non-object storage gives the defaults", () => {
    expect(parseViewSettings(undefined)).toEqual(defaultViewSettings)
    expect(parseViewSettings(null)).toEqual(defaultViewSettings)
    expect(parseViewSettings("not json")).toEqual(defaultViewSettings)
    expect(parseViewSettings([1, 2, 3])).toEqual(defaultViewSettings)
  })

  test("keeps saved values of the right type and ignores unknown fields", () => {
    const saved = parseViewSettings({
      collapseCompletedSteps: false,
      expandToolDetails: true,
      showReasoning: "expanded",
      fontSize: 17,
      todoDefaultExpanded: true,
      terminalFontFamily: "Fira Code",
      extra: "ignored",
    })
    expect(saved).toEqual({
      collapseCompletedSteps: false,
      expandToolDetails: true,
      showReasoning: "expanded",
      fontSize: 17,
      todoDefaultExpanded: true,
      terminalFontFamily: "Fira Code",
    })
  })

  test("wrong types fall back field by field", () => {
    const saved = parseViewSettings({ collapseCompletedSteps: "no", showReasoning: "loud", fontSize: "big", todoDefaultExpanded: 1, terminalFontFamily: 4 })
    expect(saved).toEqual(defaultViewSettings)
  })

  test("a transcript size outside the offered range is clamped and rounded", () => {
    expect(parseViewSettings({ fontSize: 5 }).fontSize).toBe(FONT_MIN)
    expect(parseViewSettings({ fontSize: 99 }).fontSize).toBe(FONT_MAX)
    expect(parseViewSettings({ fontSize: 15.6 }).fontSize).toBe(16)
    expect(parseViewSettings({ fontSize: Number.NaN }).fontSize).toBe(defaultViewSettings.fontSize)
    expect(parseViewSettings({ fontSize: Number.POSITIVE_INFINITY }).fontSize).toBe(defaultViewSettings.fontSize)
  })

  test("the offered sizes are a sane ascending range", () => {
    expect(FONT_SIZES[0]).toBe(FONT_MIN)
    expect(FONT_SIZES[FONT_SIZES.length - 1]).toBe(FONT_MAX)
    expect(FONT_SIZES).toContain(defaultViewSettings.fontSize)
    expect([...FONT_SIZES].sort((a, b) => a - b)).toEqual([...FONT_SIZES])
  })

  test("a patch merges into the saved values and is validated like storage", () => {
    const next = patchViewSettings(defaultViewSettings, { fontSize: 18, showReasoning: "hidden" })
    expect(next).toEqual({ ...defaultViewSettings, fontSize: 18, showReasoning: "hidden" })
    // The saved object is not changed.
    expect(defaultViewSettings.fontSize).toBe(14)
    // A bad patch value does not reach the controller.
    expect(patchViewSettings(next, { fontSize: 500 }).fontSize).toBe(FONT_MAX)
    expect(patchViewSettings(next, { showReasoning: "loud" as never }).showReasoning).toBe("collapsed")
  })
})

describe("enhance prompt model", () => {
  test("each server has its own key", () => {
    expect(enhanceModelKey("srv-1")).toBe(`${ENHANCE_KEY_PREFIX}srv-1`)
    expect(enhanceModelKey("srv-1")).not.toBe(enhanceModelKey("srv-2"))
  })

  test("a saved model is read defensively", () => {
    expect(parseEnhanceModel({ id: "claude-sonnet-4-5", providerID: "anthropic" })).toEqual({ id: "claude-sonnet-4-5", providerID: "anthropic" })
    expect(parseEnhanceModel({ id: "claude-sonnet-4-5", providerID: "anthropic", variant: "high" })).toEqual({ id: "claude-sonnet-4-5", providerID: "anthropic", variant: "high" })
    expect(parseEnhanceModel({ id: "", providerID: "anthropic" })).toBeUndefined()
    expect(parseEnhanceModel({ id: "x" })).toBeUndefined()
    expect(parseEnhanceModel("x")).toBeUndefined()
    expect(parseEnhanceModel(null)).toBeUndefined()
  })

  test("the label names the server default or the saved model", () => {
    expect(enhanceModelLabel(undefined)).toBe("Server default")
    expect(enhanceModelLabel({ id: "gpt-5", providerID: "openai" })).toBe("openai/gpt-5")
    expect(enhanceModelLabel({ id: "gpt-5", providerID: "openai", variant: "high" })).toBe("openai/gpt-5 · high")
  })
})

describe("reset", () => {
  test("clears the display settings and every server's enhancement model, nothing else", () => {
    expect(resetSettingKeys([])).toEqual([VIEW_KEY])
    expect(resetSettingKeys(["a", "b"])).toEqual([VIEW_KEY, `${ENHANCE_KEY_PREFIX}a`, `${ENHANCE_KEY_PREFIX}b`])
    // Servers, sessions, passwords and notification switches have other keys and are never in this list.
    expect(resetSettingKeys(["a"])).not.toContain("occ.notify")
    expect(resetSettingKeys(["a"]).some((k) => k.includes("profiles"))).toBe(false)
  })
})
