import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clickUrl } from "../src/format"
import { DEFAULT_CLICK_TEMPLATE, parseOptions } from "../src/options"

const TOPIC = "abcdefghijklmnop0123"

describe("parseOptions", () => {
  test("defaults", () => {
    const r = parseOptions({ ntfy: { topic: TOPIC } }, {}, "myhost")
    if (!r.ok) throw new Error(r.error)
    expect(r.options.ntfy.url).toBe("https://ntfy.sh/")
    expect(r.options.ntfy.token).toBeUndefined()
    expect(r.options.kinds).toEqual({ permission: true, question: true, finished: true, failed: true })
    expect(r.options.workers).toBe(false)
    expect(r.options.minDurationSeconds).toBe(0)
    expect(r.options.clickTemplate).toBe(DEFAULT_CLICK_TEMPLATE)
    expect(r.options.serverId).toBe("myhost")
    expect(r.warnings).toEqual([])
  })

  test("topic is required and validated", () => {
    expect(parseOptions({}, {}).ok).toBe(false)
    expect(parseOptions({ ntfy: {} }, {}).ok).toBe(false)
    expect(parseOptions({ ntfy: { topic: "has space" } }, {}).ok).toBe(false)
    expect(parseOptions({ ntfy: { topic: "a/b" } }, {}).ok).toBe(false)
    expect(parseOptions(null, {}).ok).toBe(false)
  })

  test("short topic and plain http warn", () => {
    const r = parseOptions({ ntfy: { topic: "short", url: "http://ntfy.example.com" } }, {})
    if (!r.ok) throw new Error(r.error)
    expect(r.warnings).toHaveLength(2)
  })

  test("localhost over http does not warn about http", () => {
    const r = parseOptions({ ntfy: { topic: TOPIC, url: "http://127.0.0.1:8080" } }, {})
    if (!r.ok) throw new Error(r.error)
    expect(r.warnings).toEqual([])
  })

  test("bad url", () => {
    expect(parseOptions({ ntfy: { topic: TOPIC, url: "nope" } }, {}).ok).toBe(false)
    expect(parseOptions({ ntfy: { topic: TOPIC, url: "ftp://x" } }, {}).ok).toBe(false)
  })

  test("{env:} and {file:} references are resolved", () => {
    const dir = mkdtempSync(join(tmpdir(), "push-opt-"))
    const file = join(dir, "token")
    writeFileSync(file, "tk_fromfile\n")
    const r = parseOptions({ ntfy: { topic: "{env:T}", token: `{file:${file}}` } }, { T: TOPIC })
    if (!r.ok) throw new Error(r.error)
    expect(r.options.ntfy.topic).toBe(TOPIC)
    expect(r.options.ntfy.token).toBe("tk_fromfile")
  })

  test("token falls back to the OPENCODE_PUSH_NTFY_TOKEN environment variable", () => {
    const r = parseOptions({ ntfy: { topic: TOPIC } }, { OPENCODE_PUSH_NTFY_TOKEN: "tk_env" })
    if (!r.ok) throw new Error(r.error)
    expect(r.options.ntfy.token).toBe("tk_env")
    const r2 = parseOptions({ ntfy: { topic: TOPIC, tokenEnv: "MY_TOKEN" } }, { MY_TOKEN: "tk_other", OPENCODE_PUSH_NTFY_TOKEN: "tk_env" })
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.options.ntfy.token).toBe("tk_other")
  })

  test("an unset {env:} reference means no token", () => {
    const r = parseOptions({ ntfy: { topic: TOPIC, token: "{env:NOPE}" } }, {})
    if (!r.ok) throw new Error(r.error)
    expect(r.options.ntfy.token).toBeUndefined()
  })

  test("toggles, workers, minDurationSeconds, details", () => {
    const r = parseOptions({ ntfy: { topic: TOPIC }, kinds: { finished: false }, workers: true, minDurationSeconds: 20, details: false }, {})
    if (!r.ok) throw new Error(r.error)
    expect(r.options.kinds.finished).toBe(false)
    expect(r.options.kinds.permission).toBe(true)
    expect(r.options.workers).toBe(true)
    expect(r.options.minDurationSeconds).toBe(20)
    expect(r.options.details).toBe(false)
  })
})

describe("clickUrl", () => {
  test("fills the placeholders", () => {
    expect(clickUrl(DEFAULT_CLICK_TEMPLATE, "ses_1", "office box")).toBe("opencode-mobile://session/ses_1?server=office%20box")
  })
  test("custom template and empty template", () => {
    expect(clickUrl("https://app.example/s/{sessionID}", "ses_1", "x")).toBe("https://app.example/s/ses_1")
    expect(clickUrl("", "ses_1", "x")).toBeUndefined()
  })
})
