import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { SessionFeed } from "@occ/core/feed"
import type { RawMessage } from "@occ/core/history"
import { messageListFake } from "../fakes/message-list"

const session = (id: string) => ({ id, title: `Title ${id}`, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory: "/w" } })

/** One turn: the prompt, the answer and the idle marker that ends it. */
const history: RawMessage[] = [
  { id: "m1", type: "user", text: "build the extension", time: { created: 1000 } },
  { id: "m2", type: "assistant", content: [{ type: "text", text: "on it" }], time: { created: 2000 } },
  { id: "m3", type: "idle", outcome: "succeeded", time: { created: 3000 } },
]

const failed = () => Promise.reject(new Error("Request failed"))

/** The server as a folder's controller sees it: one root session, one transcript. */
function server() {
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const { list } = messageListFake(history)
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async () => ({ data: [session("ses_a")] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID),
      inbox: { list: async () => [] },
    },
    command: { list: async () => empty },
    skill: { list: async () => empty },
    mcp: { list: async () => empty },
    permission: { request: { list: async () => empty } },
    form: { list: async () => empty },
    agent: { list: async () => empty },
    model: { list: async () => empty, default: unsupported },
    provider: { list: async () => empty },
    config: { get: unsupported },
    shell: { list: async () => empty },
    message: { list },
    event: { subscribe: async function* () {} },
  }
  return client
}

/** A controller whose startup sync runs against `client` (no stream: the test drives sync itself). */
async function synced(client: any, log?: (line: string) => void) {
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w", log })
  ;(ctl as any).client = client
  await ctl.sync()
  return ctl
}

/** The controller logs more than transcripts (folder sync, session count); these tests only look at the transcript lines. */
const transcriptLog = (lines: string[]) => (line: string) => {
  if (line.startsWith("Transcript of ")) lines.push(line)
}

/** The shape `@opencode/client` throws for a request that never reached the server. */
function transportError(): Error {
  return Object.assign(new Error("Transport: fetch failed"), {
    name: "ClientError",
    reason: "Transport",
    cause: new TypeError("fetch failed"),
  })
}

describe("a transcript that fails to load", () => {
  test("a stalled request during the startup sync is retried, so the session shows its messages", async () => {
    // The reported case: eight folders sync at once and one message.list stalls. Before the retry the view stayed
    // loaded and empty, which the transcript renders as "No messages yet." for a session full of messages.
    const client = server()
    const { list } = messageListFake(history)
    let calls = 0
    client.message.list = async (input: any) => {
      if (++calls === 1) throw new Error("Request failed")
      return list(input)
    }
    const ctl = await synced(client)
    const s = ctl.snapshot()
    expect(s.target).toEqual({ kind: "session", id: "ses_a" })
    expect(calls).toBe(2)
    expect(s.view.loaded).toBe(true)
    expect(s.view.turns.length).toBe(1)
    expect(s.view.turns[0]!.user?.text).toBe("build the extension")
    expect(s.error).toBeUndefined()
    expect(s.loadingView).toBe(false)
    ctl.detach()
  })

  test("an empty first page is asked for once more before an empty transcript is shown", async () => {
    const { list } = messageListFake(history)
    let calls = 0
    const client = {
      message: {
        list: async (input: any) => {
          calls++
          return calls === 1 ? { data: [], cursor: { next: null } } : list(input)
        },
      },
      session: { inbox: { list: async () => [] } },
    } as never
    const errors: string[] = []
    const feed = new SessionFeed(
      () => {},
      (m) => errors.push(m),
    )
    await feed.load(client, "ses_a")
    expect(calls).toBe(2)
    expect(feed.view.loaded).toBe(true)
    expect(feed.view.turns.length).toBe(1)
    expect(feed.loadError).toBeUndefined()
    expect(errors).toEqual([])
  })

  test("a load that keeps failing says so, and opening the session again retries it", async () => {
    const client = server()
    const { list } = messageListFake(history)
    client.message.list = failed
    const ctl = await synced(client)
    const bad = ctl.snapshot()
    expect(bad.view.loaded).toBe(true)
    expect(bad.view.turns).toEqual([])
    // The background sync must not wipe the reason: that is what made the empty transcript look like an empty session.
    expect(bad.error).toBe("Could not load the session: Request failed")

    client.message.list = list
    await ctl.open("ses_a")
    const good = ctl.snapshot()
    expect(good.view.turns.length).toBe(1)
    expect(good.error).toBeUndefined()
    ctl.detach()
  })

  test("a failed reload keeps the transcript that is already on screen", async () => {
    const { list } = messageListFake(history)
    const client = {
      message: { list },
      session: { inbox: { list: async () => [] } },
    } as any
    const errors: string[] = []
    const feed = new SessionFeed(
      () => {},
      (m) => errors.push(m),
    )
    await feed.load(client, "ses_a")
    expect(feed.view.turns.length).toBe(1)

    client.message.list = failed
    await feed.load(client, "ses_a")
    expect(feed.view.loaded).toBe(true)
    expect(feed.view.turns.length).toBe(1)
    expect(feed.loadError).toBe("Could not load the session: Request failed")
    expect(errors).toEqual(["Could not load the session: Request failed"])

    // Another session never inherits the old transcript: it starts blank instead.
    await feed.load(client, "ses_b")
    expect(feed.view.turns).toEqual([])
    expect(feed.view.loaded).toBe(true)
  })
})

describe("the log of a transcript load", () => {
  test("a first attempt that fails and a retry that works leave both lines, with the error chain", async () => {
    const client = server()
    const { list } = messageListFake(history)
    let calls = 0
    client.message.list = async (input: any) => {
      if (++calls === 1) throw transportError()
      return list(input)
    }
    const lines: string[] = []
    const ctl = await synced(client, transcriptLog(lines))
    expect(lines.length).toBe(2)
    expect(lines[0]).toMatch(/^Transcript of ses_a failed on attempt 1 after \d+ ms: ClientError: Transport: fetch failed \(reason: Transport\) <- TypeError: fetch failed$/)
    expect(lines[1]).toMatch(/^Transcript of ses_a loaded on attempt 2 after \d+ ms$/)
    ctl.detach()
  })

  test("a status error keeps its HTTP status in the line", async () => {
    const client = server()
    client.message.list = async () => {
      throw Object.assign(new Error("500"), { name: "ClientError", reason: "UnexpectedStatus", cause: { status: 500 } })
    }
    const lines: string[] = []
    const ctl = await synced(client, transcriptLog(lines))
    expect(lines.length).toBe(2)
    for (const line of lines) expect(line).toContain("(reason: UnexpectedStatus) <- status: 500")
    expect(lines.some((line) => line.startsWith("Transcript of ses_a loaded"))).toBe(false)
    ctl.detach()
  })

  test("a first load that works says nothing", async () => {
    const lines: string[] = []
    const ctl = await synced(server(), transcriptLog(lines))
    expect(lines).toEqual([])
    ctl.detach()
  })

  test("opening the session again after a failed load says that the later load worked", async () => {
    const client = server()
    const { list } = messageListFake(history)
    client.message.list = failed
    const lines: string[] = []
    const ctl = await synced(client, transcriptLog(lines))
    expect(lines.filter((line) => line.includes("failed on attempt"))).toHaveLength(2)

    lines.length = 0
    client.message.list = list
    await ctl.open("ses_a")
    expect(lines).toEqual([expect.stringMatching(/^Transcript of ses_a loaded on attempt 1 after \d+ ms$/)])
    ctl.detach()
  })
})
