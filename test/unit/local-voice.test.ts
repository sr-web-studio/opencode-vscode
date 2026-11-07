import { describe, expect, test } from "bun:test"
import { DEFAULT_ENGINE, normalizeEngine } from "../../src/core/dictation"
import { appendSegment, clampThreads, concatFloat32, heardText, int16ToFloat32, micLabel, micTitle, startArgs, voiceReady } from "../../src/core/local-voice"
import { cycleLanguages } from "../../src/core/voice-catalog"
import { envWithNative, libraryPathVar } from "../../src/companion/sherpa"

describe("audio conversion", () => {
  test("Int16 → Float32 in [-1, 1)", () => {
    const f = int16ToFloat32(Int16Array.from([0, 16384, -16384, 32767, -32768]))
    expect([...f]).toEqual([0, 0.5, -0.5, 32767 / 32768, -1])
    expect(f).toBeInstanceOf(Float32Array)
    expect(int16ToFloat32(new Int16Array(0)).length).toBe(0)
  })
  test("concatFloat32 joins in order", () => {
    expect([...concatFloat32([Float32Array.of(1, 2), new Float32Array(0), Float32Array.of(3)])]).toEqual([1, 2, 3])
  })
})

describe("text assembly", () => {
  test("segments are space-separated; empty ones are ignored", () => {
    expect(appendSegment("", " আমি ")).toBe("আমি")
    expect(appendSegment("আমি", "যাই।")).toBe("আমি যাই।")
    expect(appendSegment("আমি", "  ")).toBe("আমি")
  })
  test("heard: final + partial reads right, with one space between", () => {
    expect(heardText("", "")).toEqual({ final: "", partial: "" })
    expect(heardText("", " এক ")).toEqual({ final: "", partial: "এক" })
    expect(heardText("এক", "দুই")).toEqual({ final: "এক", partial: " দুই" })
    expect(heardText("এক", "")).toEqual({ final: "এক", partial: "" })
    const h = heardText("এক", "দুই")
    expect(h.final + h.partial).toBe("এক দুই")
  })
})

describe("engine selection", () => {
  test("local is the default; anything but soniox is local", () => {
    expect(DEFAULT_ENGINE).toBe("local")
    expect(normalizeEngine(undefined)).toBe("local")
    expect(normalizeEngine("soniox")).toBe("soniox")
    expect(normalizeEngine("other")).toBe("local")
  })
  test("ready: local needs no key; soniox needs one; a computer without the local engine is not ready", () => {
    expect(voiceReady("local", false, undefined)).toBe(true)
    expect(voiceReady("local", false, { capture: true, local: true })).toBe(true)
    expect(voiceReady("local", true, { capture: true, local: false })).toBe(false)
    expect(voiceReady("local", false, { capture: true })).toBe(false) // an old companion answered without `local`
    expect(voiceReady("soniox", false, { capture: true, local: true })).toBe(false)
    expect(voiceReady("soniox", true, undefined)).toBe(true)
  })
  test("start arguments: local sends no key or model; soniox needs its key", () => {
    const l = startArgs({ id: "d1", engine: "local", languages: ["bn"], threads: 99 })
    expect(l).toEqual({ id: "d1", engine: "local", languages: ["bn"], localLanguage: "en", threads: 8 })
    expect("key" in l || "model" in l).toBe(false)
    expect(startArgs({ id: "d2", engine: "soniox", languages: ["bn", "en"], soniox: { key: "k", model: "m" } })).toEqual({ id: "d2", engine: "soniox", key: "k", model: "m", languages: ["bn", "en"] })
    expect(() => startArgs({ id: "d3", engine: "soniox", languages: [] })).toThrow()
  })
  test("threads are clamped; default 2", () => {
    expect(clampThreads(undefined)).toBe(2)
    expect(clampThreads(0)).toBe(1)
    expect(clampThreads(3.4)).toBe(3)
    expect(clampThreads(Number.NaN)).toBe(2)
  })
  test("start args use the current language: the first entry of the active list; after a switch the other one", () => {
    const active = ["en", "bn"]
    expect(startArgs({ id: "d1", engine: "local", languages: [], localLanguage: active[0] }).localLanguage).toBe("en")
    const switched = cycleLanguages(active)
    expect(startArgs({ id: "d2", engine: "local", languages: [], localLanguage: switched[0] }).localLanguage).toBe("bn")
    expect(startArgs({ id: "d3", engine: "local", languages: [], localLanguage: "ja" }).localLanguage).toBe("ja") // any catalog language, not only en/bn
    expect(startArgs({ id: "d4", engine: "local", languages: [], localLanguage: "auto" }).localLanguage).toBe("auto")
  })

  test("local start arguments carry the language; unknown or missing values mean English", () => {
    expect(startArgs({ id: "d1", engine: "local", languages: ["bn"], localLanguage: "bn" }).localLanguage).toBe("bn")
    expect(startArgs({ id: "d1", engine: "local", languages: [], localLanguage: " BN " }).localLanguage).toBe("bn")
    expect(startArgs({ id: "d1", engine: "local", languages: [] }).localLanguage).toBe("en")
    expect(startArgs({ id: "d1", engine: "local", languages: ["bn"], localLanguage: "klingon" }).localLanguage).toBe("en")
    expect(startArgs({ id: "d1", engine: "local", languages: [], localLanguage: 42 }).localLanguage).toBe("en")
    // Soniox never gets a local language.
    expect("localLanguage" in startArgs({ id: "d2", engine: "soniox", languages: ["bn"], localLanguage: "bn", soniox: { key: "k", model: "m" } })).toBe(false)
  })
})

describe("mic button texts", () => {
  test("local: on-device wording; soniox without key keeps today's wording", () => {
    expect(micTitle({ engine: "local", ready: true, recording: "off" })).toBe("Voice input (on-device)")
    expect(micLabel({ engine: "local", ready: true, recording: "off" })).toBe("Voice input (on-device)")
    expect(micTitle({ engine: "soniox", ready: true, recording: "off" })).toBe("Voice input")
    expect(micTitle({ engine: "soniox", ready: false, recording: "off" })).toBe("Voice input is off: click to add your Soniox API key")
    expect(micLabel({ engine: "soniox", ready: false, recording: "off" })).toBe("Voice input (set API key)")
    expect(micTitle({ engine: "local", ready: true, recording: "on" })).toBe("Listening: click to stop")
    expect(micTitle({ engine: "local", ready: true, recording: "starting" })).toContain("Starting")
    expect(micTitle({ engine: "local", ready: true, recording: "stopping" })).toContain("Finishing")
    expect(micLabel({ engine: "local", ready: true, recording: "on" })).toBe("Stop voice input")
    expect(micTitle({ engine: "local", ready: false, recording: "off" })).toContain("not available on this computer")
  })
})

describe("library search path for the native addon", () => {
  test("variable per platform; the native folder goes first, existing value kept", () => {
    expect(libraryPathVar("win32")).toBe("PATH")
    expect(libraryPathVar("linux")).toBe("LD_LIBRARY_PATH")
    expect(libraryPathVar("darwin")).toBe("DYLD_LIBRARY_PATH")
    expect(envWithNative({ LD_LIBRARY_PATH: "/x" }, "/n", "linux").LD_LIBRARY_PATH).toBe("/n:/x")
    expect(envWithNative({}, "/n", "linux").LD_LIBRARY_PATH).toBe("/n")
    expect(envWithNative({ DYLD_LIBRARY_PATH: "/x" }, "/n", "darwin").DYLD_LIBRARY_PATH).toBe("/n:/x")
    // Windows: `Path` is the usual spelling; the existing key is kept, no second `PATH` appears.
    const win = envWithNative({ Path: "C:\\Windows", OTHER: "1" }, "C:\\n", "win32")
    expect(win.Path).toBe("C:\\n;C:\\Windows")
    expect(Object.keys(win).filter((k) => k.toUpperCase() === "PATH")).toEqual(["Path"])
    const input = { A: "1" }
    envWithNative(input, "/n", "linux")
    expect(input).toEqual({ A: "1" })
  })
})
