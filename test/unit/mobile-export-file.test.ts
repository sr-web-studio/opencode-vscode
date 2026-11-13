import { describe, expect, test } from "bun:test"
import { isShareCancel } from "../../apps/mobile/src/lib/share-cancel"

describe("a dismissed share sheet", () => {
  test("cancel → no error: the plugin's own rejection is recognised", () => {
    // @capacitor/share 8.0.3 rejects with exactly this message and no code, on Android and iOS.
    expect(isShareCancel(new Error("Share canceled"))).toBe(true)
    expect(isShareCancel("Share canceled")).toBe(true)
    // A CapacitorException is an Error, but a plain object with a message is treated the same.
    expect(isShareCancel({ message: "Share canceled" })).toBe(true)
    expect(isShareCancel(new Error("Share cancelled"))).toBe(true)
  })

  test("another error → error: every other failure is not a cancel", () => {
    expect(isShareCancel(new Error("only file urls are supported"))).toBe(false)
    expect(isShareCancel(new Error("Share API not available in this browser"))).toBe(false)
    expect(isShareCancel(new Error("Can't share while sharing is in progress"))).toBe(false)
    expect(isShareCancel(undefined)).toBe(false)
    expect(isShareCancel(null)).toBe(false)
    expect(isShareCancel({})).toBe(false)
  })
})
