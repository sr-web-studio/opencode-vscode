import { describe, expect, test } from "bun:test"
import { SONIOX_TEMP_KEY_URL, checkSonioxKey, keyShapeProblem } from "@occ/core/voice"

const KEY = "0123456789abcdef0123456789abcdef"
const answer = (status: number) => {
  const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = []
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init })
    return { status, ok: status >= 200 && status < 300 }
  }
  return { fetch, calls }
}

describe("keyShapeProblem", () => {
  test("empty, spaces and too short are refused before any network call", () => {
    expect(keyShapeProblem("  ")).toBeDefined()
    expect(keyShapeProblem("abc def ghi jkl mno")).toBeDefined()
    expect(keyShapeProblem("short")).toBeDefined()
    expect(keyShapeProblem(`  ${KEY}  `)).toBeUndefined()
  })
})

describe("checkSonioxKey", () => {
  test("a valid key: one temporary-key request with the trimmed key as Bearer", async () => {
    const { fetch, calls } = answer(201)
    expect(await checkSonioxKey(fetch, ` ${KEY}\n`)).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(SONIOX_TEMP_KEY_URL)
    expect(calls[0]!.init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ usage_type: "transcribe_websocket", expires_in_seconds: 60 })
  })
  test("401 and 403 mean the key is rejected", async () => {
    for (const s of [401, 403]) {
      const r = await checkSonioxKey(answer(s).fetch, KEY)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain("rejected")
    }
  })
  test("other answers and network errors are not called an invalid key", async () => {
    const r500 = await checkSonioxKey(answer(500).fetch, KEY)
    expect(r500.ok).toBe(false)
    if (!r500.ok) expect(r500.reason).toContain("HTTP 500")
    const down = await checkSonioxKey(async () => { throw new Error("ENOTFOUND") }, KEY)
    expect(down.ok).toBe(false)
    if (!down.ok) expect(down.reason).toContain("Could not reach Soniox")
  })
  test("a bad shape never calls the network", async () => {
    const { fetch, calls } = answer(201)
    expect((await checkSonioxKey(fetch, "")).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
  test("the error text never contains the key", async () => {
    const r = await checkSonioxKey(async () => { throw new Error("boom") }, KEY)
    expect(JSON.stringify(r)).not.toContain(KEY)
  })
})
