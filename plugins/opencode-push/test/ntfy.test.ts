import { afterEach, describe, expect, test } from "bun:test"
import { LOG_EVERY_MS, NtfyClient } from "../src/ntfy"
import { clock, fakeNtfy, options, TOPIC } from "./helpers"

const stops: (() => void)[] = []
afterEach(() => {
  while (stops.length) stops.pop()!()
})

const msg = { title: "T", body: "B", priority: 3, tags: ["x"], click: "opencode-mobile://session/ses_a?server=box" }

function make(raw: Record<string, unknown>, handler?: (n: number) => Response | Promise<Response>) {
  const ntfy = fakeNtfy(handler)
  stops.push(ntfy.stop)
  const c = clock()
  const logs: string[] = []
  const o = options({ ntfy: { url: ntfy.url, topic: TOPIC, ...raw } })
  return { ntfy, c, logs, client: new NtfyClient(o.ntfy, (l, m) => logs.push(`${l}: ${m}`), c.now) }
}

describe("publish", () => {
  test("posts JSON to the server root with topic, title, message, priority, tags, click", async () => {
    const { ntfy, client } = make({})
    expect(await client.send(msg)).toBe(true)
    const r = ntfy.requests[0]!
    expect(r.method).toBe("POST")
    expect(r.path).toBe("/")
    expect(r.headers["content-type"]).toContain("application/json")
    expect(r.headers.authorization).toBeUndefined()
    expect(r.json).toEqual({ topic: TOPIC, title: "T", message: "B", priority: 3, tags: ["x"], click: msg.click })
  })

  test("bearer token", async () => {
    const { ntfy, client } = make({ token: "tk_abc123" })
    await client.send(msg)
    expect(ntfy.requests[0]!.headers.authorization).toBe("Bearer tk_abc123")
  })

  test("basic auth when only username and password are set", async () => {
    const { ntfy, client } = make({ username: "phil", password: "pw" })
    await client.send(msg)
    expect(ntfy.requests[0]!.headers.authorization).toBe(`Basic ${Buffer.from("phil:pw").toString("base64")}`)
  })

  test("non-ASCII titles survive (JSON body, not headers)", async () => {
    const { ntfy, client } = make({})
    await client.send({ ...msg, title: "লগইন ঠিক করা finished ✅" })
    expect(ntfy.requests[0]!.json.title).toBe("লগইন ঠিক করা finished ✅")
  })

  test("no click key when the template is empty", async () => {
    const { ntfy, client } = make({})
    await client.send({ ...msg, click: undefined })
    expect("click" in ntfy.requests[0]!.json).toBe(false)
  })
})

describe("failures", () => {
  test("HTTP error: returns false, never throws, logs once per minute", async () => {
    const { ntfy, client, logs, c } = make({}, () => new Response("no", { status: 500 }))
    expect(await client.send(msg)).toBe(false)
    for (let i = 0; i < 5; i++) await client.send(msg)
    expect(ntfy.requests).toHaveLength(6) // no retry storm: one attempt per send
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain("HTTP 500")
    c.advance(LOG_EVERY_MS + 1)
    await client.send(msg)
    expect(logs).toHaveLength(2)
    expect(logs[1]).toContain("5 more failures")
  })

  test("401 hints at the token", async () => {
    const { client, logs } = make({}, () => new Response("no", { status: 401 }))
    await client.send(msg)
    expect(logs[0]).toContain("ntfy.token")
  })

  test("connection refused is swallowed and logged without the URL", async () => {
    const o = options({ ntfy: { url: "http://127.0.0.1:1", topic: TOPIC, token: "tk_secret" } })
    const logs: string[] = []
    const client = new NtfyClient(o.ntfy, (l, m) => logs.push(m))
    expect(await client.send(msg)).toBe(false)
    expect(logs).toHaveLength(1)
    expect(logs[0]).not.toContain("127.0.0.1")
    expect(logs[0]).not.toContain("tk_secret")
    expect(logs[0]).not.toContain(TOPIC)
  })

  test("a hanging server times out", async () => {
    const ntfy = fakeNtfy(() => new Promise<Response>(() => {}))
    stops.push(ntfy.stop)
    const o = options({ ntfy: { url: ntfy.url, topic: TOPIC, timeoutMs: 500 } })
    const logs: string[] = []
    const client = new NtfyClient(o.ntfy, (l, m) => logs.push(m))
    const t0 = Date.now()
    expect(await client.send(msg)).toBe(false)
    expect(Date.now() - t0).toBeLessThan(3_000)
    expect(logs[0]).toContain("did not answer within 500 ms")
  })

  test("a throwing logger does not escape", async () => {
    const o = options({ ntfy: { url: "http://127.0.0.1:1", topic: TOPIC } })
    const client = new NtfyClient(o.ntfy, () => {
      throw new Error("log broke")
    })
    expect(await client.send(msg)).toBe(false)
  })
})
