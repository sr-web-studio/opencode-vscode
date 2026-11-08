import { describe, expect, test } from "bun:test"
import { applySonioxMessage, isNewerVersion, mergeDictation, nothingHeard, pcmBytes, sonioxProtocols, sonioxStartMessage, spokenText } from "@occ/core/dictation"

describe("sonioxStartMessage", () => {
  test("raw 16 kHz mono PCM, Bangla and English by default, no key in the message", () => {
    const m = JSON.parse(sonioxStartMessage())
    expect(m).toEqual({ model: "stt-rt-v6", audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1, language_hints: ["bn", "en"], enable_endpoint_detection: true })
    expect(JSON.parse(sonioxStartMessage({ languages: ["hi"], model: "m" }))).toMatchObject({ language_hints: ["hi"], model: "m" })
    expect(sonioxProtocols("k")).toEqual(["soniox-api-key", "k"])
  })
})

describe("applySonioxMessage", () => {
  test("final tokens accumulate, non-final ones are replaced, markers are dropped", () => {
    let h = nothingHeard()
    h = applySonioxMessage(h, {
      tokens: [
        { text: "আমি", is_final: true },
        { text: " ভা", is_final: false },
      ],
    })
    expect(h).toMatchObject({ final: "আমি", partial: " ভা" })
    h = applySonioxMessage(h, {
      tokens: [
        { text: " ভালো", is_final: true },
        { text: "<end>", is_final: true },
        { text: " আছি", is_final: false },
      ],
    })
    expect(h).toMatchObject({ final: "আমি ভালো", partial: " আছি" })
    expect(spokenText(h)).toBe("আমি ভালো আছি")
    h = applySonioxMessage(h, { tokens: [], finished: true })
    expect(h).toMatchObject({ final: "আমি ভালো", partial: "", finished: true })
  })
  test("errors finish the stream with a readable reason", () => {
    const h = applySonioxMessage(nothingHeard(), { tokens: [], error_code: 402, error_type: "organization_balance_exhausted", error_message: "x" })
    expect(h.finished).toBe(true)
    expect(h.error).toContain("balance")
    expect(applySonioxMessage(nothingHeard(), { error_code: 401, error_type: "unauthenticated" }).error).toContain("rejected")
    expect(applySonioxMessage(nothingHeard(), null)).toEqual(nothingHeard())
  })
})

describe("mergeDictation", () => {
  test("replaces its own previous guess at the end of the box", () => {
    let r = mergeDictation("Fix this:", "", "open")
    expect(r).toEqual({ text: "Fix this: open", shown: " open" })
    r = mergeDictation(r.text, r.shown, " open the file")
    expect(r.text).toBe("Fix this: open the file")
  })
  test("when the user typed meanwhile, only the newly heard part is appended", () => {
    const first = mergeDictation("", "", "hello")
    const typed = first.text + " (typed)"
    const r = mergeDictation(typed, first.shown, "hello world")
    expect(r.text).toBe("hello (typed) world")
  })
  test("an empty box gets no leading space", () => {
    expect(mergeDictation("", "", "hi").text).toBe("hi")
  })
})

describe("pcmBytes", () => {
  test("little-endian 16-bit samples", () => {
    expect([...pcmBytes(new Int16Array([1, -2, 0x1234]))]).toEqual([1, 0, 0xfe, 0xff, 0x34, 0x12])
  })
})

describe("isNewerVersion", () => {
  test("only a strictly newer version upgrades the companion (no downgrade ping-pong)", () => {
    expect(isNewerVersion("0.3.6", "0.3.4")).toBe(true)
    expect(isNewerVersion("0.3.4", "0.3.6")).toBe(false)
    expect(isNewerVersion("0.3.6", "0.3.6")).toBe(false)
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true)
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true)
    expect(isNewerVersion("0.3.6-test5", "0.3.6")).toBe(false)
  })
  test("test builds (prerelease) order among themselves and below the release", () => {
    expect(isNewerVersion("0.3.7-test.12", "0.3.7-test.11")).toBe(true)
    expect(isNewerVersion("0.3.7-test.11", "0.3.7-test.12")).toBe(false)
    expect(isNewerVersion("0.3.7-test.11", "0.3.7-test.11")).toBe(false)
    expect(isNewerVersion("0.3.7-test.11", "0.3.6")).toBe(true)
    expect(isNewerVersion("0.3.7", "0.3.7-test.11")).toBe(true)
    expect(isNewerVersion("0.3.7-test.11", "0.3.7")).toBe(false)
    expect(isNewerVersion("0.3.7-test.10", "0.3.7-test.9")).toBe(true)
  })
  test("unreadable versions", () => {
    expect(isNewerVersion("0.3.6", "")).toBe(true)
    expect(isNewerVersion("", "0.3.6")).toBe(false)
    expect(isNewerVersion("x", "y")).toBe(false)
  })
})
