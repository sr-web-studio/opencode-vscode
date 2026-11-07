import { afterEach, describe, expect, test } from "bun:test"
import { ev, harness } from "./helpers"

const stops: (() => void)[] = []
const setup = (...args: Parameters<typeof harness>) => {
  const h = harness(...args)
  stops.push(h.ntfy.stop)
  return h
}
afterEach(() => {
  while (stops.length) stops.pop()!()
})

describe("triggers", () => {
  test("permission asked -> needs permission", async () => {
    const h = setup()
    await h.engine.handle(ev.permission("ses_a"))
    expect(h.ntfy.requests).toHaveLength(1)
    const r = h.ntfy.requests[0]!
    expect(r.method).toBe("POST")
    expect(r.path).toBe("/")
    expect(r.json.topic).toBeTruthy()
    expect(r.json.title).toBe("Fix login bug needs permission")
    expect(r.json.message).toBe("Waiting for your approval (edit)\nmy-app")
    expect(r.json.priority).toBe(4)
    expect(r.json.click).toBe("opencode-mobile://session/ses_a?server=box")
  })

  test("question created -> has a question, with the first field text", async () => {
    const h = setup()
    await h.engine.handle(ev.question("ses_a"))
    const r = h.ntfy.requests[0]!
    expect(r.json.title).toBe("Fix login bug has a question")
    expect(r.json.message).toBe("Which database should I use?\nmy-app")
    expect(r.json.priority).toBe(4)
  })

  test("root turn succeeded -> finished (default priority)", async () => {
    const h = setup()
    await h.engine.handle(ev.succeeded("ses_a"))
    const r = h.ntfy.requests[0]!
    expect(r.json.title).toBe("Fix login bug finished")
    expect(r.json.message).toBe("Turn finished\nmy-app")
    expect(r.json.priority).toBe(3)
  })

  test("root turn failed -> failed with the first line of the error", async () => {
    const h = setup()
    await h.engine.handle(ev.failed("ses_a", "Provider returned 500\nstack trace line 2"))
    const r = h.ntfy.requests[0]!
    expect(r.json.title).toBe("Fix login bug failed")
    expect(r.json.message).toBe("Provider returned 500\nmy-app")
  })

  test("session unknown -> generic title, no folder", async () => {
    const h = setup()
    await h.engine.handle(ev.succeeded("ses_missing"))
    expect(h.ntfy.requests[0]!.json.title).toBe("OpenCode finished")
    expect(h.ntfy.requests[0]!.json.message).toBe("Turn finished")
  })

  test("lookup rejecting does not stop the push", async () => {
    const h = setup()
    ;(h.engine as any).deps.session = async () => {
      throw new Error("boom")
    }
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(h.ntfy.requests).toHaveLength(1)
  })

  test("events that are not triggers are ignored", async () => {
    const h = setup()
    await h.engine.handle({ type: "session.text.delta", data: { sessionID: "ses_a", delta: "hello" } })
    await h.engine.handle({ type: "permission.replied", data: { sessionID: "ses_a" } })
    await h.engine.handle({ type: "session.execution.started", data: { sessionID: "ses_a" } })
    expect(h.ntfy.requests).toHaveLength(0)
  })

  test("malformed events never throw", async () => {
    const h = setup()
    await h.engine.handle({ type: "permission.asked" })
    await h.engine.handle({ type: "form.created", data: { form: null } })
    await h.engine.handle({ type: "session.execution.failed", data: null })
    await h.engine.handle(null as any)
    expect(h.ntfy.requests).toHaveLength(0)
  })
})

describe("kind toggles", () => {
  test("each kind can be turned off", async () => {
    const h = setup({ options: { kinds: { permission: false, question: false, finished: false, failed: false } } })
    await h.engine.handle(ev.permission("ses_a"))
    await h.engine.handle(ev.question("ses_a"))
    await h.engine.handle(ev.succeeded("ses_a"))
    await h.engine.handle(ev.failed("ses_a"))
    expect(h.ntfy.requests).toHaveLength(0)
  })

  test("details off hides the question text and the error line", async () => {
    const h = setup({ options: { details: false } })
    await h.engine.handle(ev.question("ses_a"))
    h.clock.advance(10_000)
    await h.engine.handle(ev.failed("ses_a", "Provider returned 500"))
    expect(h.ntfy.requests[0]!.json.message).toBe("Needs your input\nmy-app")
    expect(h.ntfy.requests[1]!.json.message).toBe("The turn failed\nmy-app")
  })
})

describe("workers", () => {
  const sessions = { ses_w: { title: "Explore auth", parentID: "ses_a", directory: "/home/u/work/my-app" } }

  test("worker turn end is skipped by default", async () => {
    const h = setup({ sessions })
    await h.engine.handle(ev.succeeded("ses_w"))
    await h.engine.handle(ev.failed("ses_w"))
    expect(h.ntfy.requests).toHaveLength(0)
    expect(h.logs.some((l) => l.includes("worker turn"))).toBe(true)
  })

  test("worker turn end is pushed when workers is on", async () => {
    const h = setup({ sessions, options: { workers: true } })
    await h.engine.handle(ev.succeeded("ses_w"))
    expect(h.ntfy.requests).toHaveLength(1)
    expect(h.ntfy.requests[0]!.json.title).toBe("Explore auth finished")
  })

  test("a worker's permission request still pushes (the user must act)", async () => {
    const h = setup({ sessions })
    await h.engine.handle(ev.permission("ses_w"))
    expect(h.ntfy.requests).toHaveLength(1)
  })
})

describe("minDurationSeconds", () => {
  test("short turns do not push 'finished'", async () => {
    const h = setup({ options: { minDurationSeconds: 30 } })
    await h.engine.handle(ev.started("ses_a"))
    h.clock.advance(5_000)
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(h.ntfy.requests).toHaveLength(0)
  })

  test("long turns push", async () => {
    const h = setup({ options: { minDurationSeconds: 30 } })
    await h.engine.handle(ev.started("ses_a"))
    h.clock.advance(31_000)
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(h.ntfy.requests).toHaveLength(1)
  })

  test("failures always push, however short", async () => {
    const h = setup({ options: { minDurationSeconds: 30 } })
    await h.engine.handle(ev.started("ses_a"))
    h.clock.advance(1_000)
    await h.engine.handle(ev.failed("ses_a"))
    expect(h.ntfy.requests).toHaveLength(1)
  })

  test("unknown start time (plugin loaded mid-turn) pushes", async () => {
    const h = setup({ options: { minDurationSeconds: 30 } })
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(h.ntfy.requests).toHaveLength(1)
  })
})

describe("coalescing", () => {
  test("finished right after finished is dropped, later one goes through", async () => {
    const h = setup()
    await h.engine.handle(ev.succeeded("ses_a"))
    h.clock.advance(1_000)
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(h.ntfy.requests).toHaveLength(1)
    h.clock.advance(5_000)
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(h.ntfy.requests).toHaveLength(2)
  })

  test("attention wins inside the window", async () => {
    const h = setup()
    await h.engine.handle(ev.succeeded("ses_a"))
    h.clock.advance(500)
    await h.engine.handle(ev.permission("ses_a"))
    expect(h.ntfy.requests.map((r) => r.json.title)).toEqual(["Fix login bug finished", "Fix login bug needs permission"])
  })

  test("finished right after attention is dropped", async () => {
    const h = setup()
    await h.engine.handle(ev.question("ses_a"))
    h.clock.advance(500)
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(h.ntfy.requests).toHaveLength(1)
  })

  test("sessions are independent", async () => {
    const h = setup({ sessions: { ses_b: { title: "Other", directory: "/x/other" } } })
    await h.engine.handle(ev.succeeded("ses_a"))
    await h.engine.handle(ev.succeeded("ses_b"))
    expect(h.ntfy.requests).toHaveLength(2)
  })

  test("two racing events for one session send one push", async () => {
    const h = setup()
    await Promise.all([h.engine.handle(ev.succeeded("ses_a")), h.engine.handle(ev.succeeded("ses_a"))])
    expect(h.ntfy.requests).toHaveLength(1)
  })

  test("the same request id is announced once, even outside the window", async () => {
    const h = setup()
    const e = ev.permission("ses_a", { id: "per_same" })
    await h.engine.handle(e)
    h.clock.advance(60_000)
    await h.engine.handle(e)
    expect(h.ntfy.requests).toHaveLength(1)
  })

  test("session.deleted clears the window", async () => {
    const h = setup()
    await h.engine.handle(ev.succeeded("ses_a"))
    await h.engine.handle(ev.deleted("ses_a"))
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(h.ntfy.requests).toHaveLength(2)
  })
})

describe("no content leak", () => {
  test("nothing but title, short text, folder name and click reaches ntfy", async () => {
    const h = setup()
    const secretPath = "/secret/path/.env"
    await h.engine.handle(
      ev.permission("ses_a", {
        resources: [secretPath, "rm -rf /"],
        message: "Run cat ~/.ssh/id_rsa",
        metadata: { input: { command: "curl -H 'Authorization: Bearer sk-live-AAAAAAAAAAAAAAAA' x" } },
        save: ["*"],
      }),
    )
    h.clock.advance(10_000)
    await h.engine.handle(ev.question("ses_a", { metadata: { transcript: "TRANSCRIPT-SECRET" } }))
    const all = JSON.stringify(h.ntfy.requests)
    for (const needle of [secretPath, "rm -rf", "id_rsa", "sk-live", "TRANSCRIPT-SECRET", "Authorization: Bearer", "/home/u/work"]) {
      expect(all).not.toContain(needle)
    }
    expect(Object.keys(h.ntfy.requests[0]!.json).sort()).toEqual(["click", "message", "priority", "tags", "title", "topic"])
  })

  test("the full folder path is never sent, only its name", async () => {
    const h = setup()
    await h.engine.handle(ev.succeeded("ses_a"))
    expect(JSON.stringify(h.ntfy.requests[0]!.json)).not.toContain("/home/u")
    expect(h.ntfy.requests[0]!.json.message).toContain("my-app")
  })

  test("an error line that contains a credential is redacted", async () => {
    const h = setup()
    await h.engine.handle(ev.failed("ses_a", "401 Unauthorized: Bearer sk-abcdefghijklmnopqrstuvwxyz0123456789"))
    const msg = h.ntfy.requests[0]!.json.message as string
    expect(msg).not.toContain("sk-abcdefgh")
    expect(msg).toContain("[redacted]")
  })

  test("a long question is clipped", async () => {
    const h = setup()
    await h.engine.handle(ev.question("ses_a", { fields: [{ key: "a", type: "string", description: "x ".repeat(300) }] }))
    expect((h.ntfy.requests[0]!.json.message as string).split("\n")[0]!.length).toBeLessThanOrEqual(140)
  })

  test("logs never contain the topic or token", async () => {
    const h = setup({ options: { ntfy: { url: "http://127.0.0.1:1", topic: "test-topic-0123456789abcdef", token: "tk_supersecrettoken1234" } } })
    await h.engine.handle(ev.succeeded("ses_a"))
    const logs = h.logs.join("\n")
    expect(logs).not.toContain("tk_supersecret")
    expect(logs).not.toContain("test-topic-0123456789abcdef")
  })
})
