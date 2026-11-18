import { describe, expect, test } from "bun:test"
import { Controller, QUEUED_NOT_REMOVED, QUEUED_UNKNOWN } from "@occ/core/controller"
import { isMessageGone } from "@occ/core/errors"

const sessionOf = (id: string) => ({ id, title: id, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory: "/w" } })
const unsupported = () => Promise.reject(new Error("404 not found"))
const empty = { data: [] }
/** The error `message.get` throws on 2.3.0 for a message that does not exist (checked against a live server). */
const notFound = () => Object.assign(new Error("Message not found"), { _tag: "MessageNotFoundError", name: "MessageNotFoundError" })

const userMessage = (id: string, text: string, created: number) => ({ id, type: "user", text, time: { created } })
const assistantMessage = (id: string, created: number) => ({ id, type: "assistant", time: { created }, content: [], agent: "build", model: { id: "m", providerID: "p" } })
const idleMessage = (id: string, created: number) => ({ id, type: "idle", outcome: "completed", time: { created } })

type Fake = {
  /** Ids `inbox.list` answers with after the cancel. */
  pending?: string[]
  /** Ids of prompts that are already the newest thing in the history. */
  history?: string[]
  /** The whole history, oldest first (wins over `history`). */
  messages?: any[]
  list?: () => Promise<unknown>
  get?: () => Promise<unknown>
  cancel?: () => Promise<unknown>
  /** Runs inside `inbox.list`, to let something happen during the awaits. */
  during?: () => Promise<void> | void
}

async function ready(delivery: "queue" | "steer", fake: Fake = {}) {
  const calls: string[] = []
  // The server's history, oldest first. `history: ["q1"]` is a history that holds just that prompt.
  const messages: any[] = fake.messages ?? (fake.history ?? []).map((id) => userMessage(id, "later", 100))
  let loads = 0
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async () => ({ data: [sessionOf("ses_a"), sessionOf("ses_b")] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => sessionOf(sessionID),
      inbox: {
        list: async () => {
          calls.push("inbox.list")
          await fake.during?.()
          if (fake.list) return fake.list()
          return (fake.pending ?? []).map((id) => ({ id, type: "user", delivery, payload: { text: "later" } }))
        },
        cancel: async (i: { sessionID: string; inboxID: string }) => {
          calls.push(`inbox.cancel ${i.sessionID} ${i.inboxID}`)
          return fake.cancel ? fake.cancel() : undefined
        },
      },
      message: {
        get: async (i: { messageID: string }) => {
          calls.push("message.get")
          if (fake.get) return fake.get()
          return messages.find((m) => m.id === i.messageID) ?? Promise.reject(notFound())
        },
      },
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
    message: {
      list: async (i: { limit?: number }) => {
        // The one-message probe for "is it the newest" is not a transcript load.
        if (i.limit !== 1) loads++
        const newestFirst = [...messages].reverse()
        return { data: i.limit ? newestFirst.slice(0, i.limit) : newestFirst, cursor: { next: null, previous: null } }
      },
    },
    event: { subscribe: async function* () {} },
  }
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w", sleep: async () => {} })
  ;(ctl as any).client = client
  await ctl.sync()
  await ctl.open("ses_a")
  const enqueue = (id: string, text = "later") => ctl.onEvent({ type: "session.inbox.enqueued", data: { sessionID: "ses_a", inboxID: id, item: { type: "user", delivery, payload: { text } } } } as any)
  await enqueue("q1")
  await enqueue("q2", "other")
  calls.length = 0
  loads = 0
  return { ctl, calls, enqueue, messages, loads: () => loads }
}

const queued = (ctl: Controller) => ctl.snapshot().view.queued.map((q) => q.id)
const turns = (ctl: Controller) => ctl.snapshot().view.turns.map((t) => [t.id, t.user?.text])
const cancel = (ctl: Controller, id = "q1") => ctl.dispatch({ type: "queued", inboxID: id, op: "cancel" })

describe("MessageNotFoundError", () => {
  test("is recognised as a missing message, and a timeout or a 5xx is not", () => {
    expect(isMessageGone(notFound())).toBe(true)
    expect(isMessageGone({ _tag: "MessageNotFoundError" })).toBe(true)
    expect(isMessageGone(Object.assign(new Error("Transport"), { _tag: "ClientError" }))).toBe(false)
    expect(isMessageGone(new Error("503 unavailable"))).toBe(false)
    // A bare 404 (a wrong URL, a proxy) says nothing about the message; a 404 that names it does.
    expect(isMessageGone({ status: 404 })).toBe(false)
    expect(isMessageGone(Object.assign(new Error("404 not found"), { status: 404 }))).toBe(false)
    expect(isMessageGone(Object.assign(new Error("Message not found: msg_1"), { status: 404 }))).toBe(true)
    expect(isMessageGone({ status: 404, body: { message: "Message not found" } })).toBe(true)
    expect(isMessageGone(undefined)).toBe(false)
  })
})

describe("Remove on a queued prompt", () => {
  for (const delivery of ["queue", "steer"] as const) {
    test(`a ${delivery} item the server cancelled leaves the list at once; other rows stay`, async () => {
      const { ctl, calls } = await ready(delivery)
      await cancel(ctl)
      expect(calls[0]).toBe("inbox.cancel ses_a q1")
      expect(queued(ctl)).toEqual(["q2"])
      expect(ctl.snapshot().error).toBeUndefined()
      await ctl.onEvent({ type: "session.inbox.cancelled", data: { sessionID: "ses_a", inboxID: "q1" } } as any)
      expect(queued(ctl)).toEqual(["q2"])
    })
  }

  test("an item the server still holds stays and the user is told", async () => {
    const { ctl } = await ready("steer", { pending: ["q1"] })
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q1", "q2"])
    expect(ctl.snapshot().error).toBe(QUEUED_NOT_REMOVED)
  })

  test("an item already delivered becomes its turn, with no reload of the transcript, and the other rows survive", async () => {
    const { ctl, loads } = await ready("steer", { history: ["q1"] })
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q2"])
    expect(turns(ctl)).toEqual([["q1", "later"]])
    expect(loads()).toBe(0)
    expect(ctl.snapshot().view.loaded).toBe(true)
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("a failed cancel request shows the server's message and keeps the row; a retry then works", async () => {
    let fail = true
    const { ctl, calls } = await ready("queue", { cancel: () => (fail ? Promise.reject(new Error("503 busy")) : Promise.resolve()) })
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q1", "q2"])
    expect(ctl.snapshot().error).toContain("503")
    fail = false
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q2"])
    expect(ctl.snapshot().error).toBeUndefined()
    expect(calls.filter((c) => c.startsWith("inbox.cancel"))).toHaveLength(2)
  })

  test("a failing inbox.list keeps the row and reports a neutral error, never 'gone'", async () => {
    const { ctl } = await ready("steer", { list: () => Promise.reject(new Error("504 timeout")) })
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q1", "q2"])
    expect(ctl.snapshot().error).toBe(QUEUED_UNKNOWN)
  })

  test("message.get failing with something other than not-found keeps the row", async () => {
    for (const err of [new Error("500 internal"), Object.assign(new Error("401"), { status: 401 }), Object.assign(new Error("Transport"), { _tag: "ClientError" })]) {
      const { ctl } = await ready("queue", { get: () => Promise.reject(err) })
      await cancel(ctl)
      expect(queued(ctl)).toEqual(["q1", "q2"])
      expect(ctl.snapshot().error).toBe(QUEUED_UNKNOWN)
    }
  })

  test("an event that settles the row during the awaits is not applied twice or turned into an error", async () => {
    const { ctl, loads } = await ready("steer", {
      pending: ["q1"],
      during: async () => {
        await ctl.onEvent({ type: "session.inbox.cancelled", data: { sessionID: "ses_a", inboxID: "q1" } } as any)
      },
    })
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q2"])
    expect(ctl.snapshot().error).toBeUndefined()
    expect(loads()).toBe(0)
  })

  test("a delivered event during the awaits wins: one turn, no duplicate", async () => {
    const { ctl } = await ready("steer", {
      history: ["q1"],
      during: async () => {
        await ctl.onEvent({ type: "session.inbox.delivered", created: 5, data: { sessionID: "ses_a", inboxID: "q1" } } as any)
      },
    })
    await cancel(ctl)
    expect(turns(ctl)).toEqual([["q1", "later"]])
    expect(queued(ctl)).toEqual(["q2"])
  })

  test("switching session during the awaits leaves the other session's view alone", async () => {
    // `during` also runs for the inbox read of every transcript load: it acts once, on the read of the cancel.
    let armed = false
    let switched = false
    const { ctl } = await ready("steer", {
      during: async () => {
        if (!armed || switched) return
        switched = true
        await ctl.open("ses_b")
      },
    })
    armed = true
    await cancel(ctl)
    expect(ctl.currentSessionID).toBe("ses_b")
    expect(queued(ctl)).toEqual([])
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("a second Remove after the first finished asks again and changes nothing more", async () => {
    const { ctl, calls } = await ready("queue")
    await cancel(ctl)
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q2"])
    expect(calls.filter((c) => c.startsWith("inbox.cancel"))).toHaveLength(2)
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("a second click while the first request is out sends one cancel", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { ctl, calls } = await ready("steer", { cancel: () => gate })
    const first = cancel(ctl)
    const second = cancel(ctl)
    release()
    await Promise.all([first, second])
    expect(calls.filter((c) => c.startsWith("inbox.cancel"))).toHaveLength(1)
    expect(queued(ctl)).toEqual(["q2"])
  })

  test("a prompt dropped after a cancel that the server delivers after all comes back, from the history", async () => {
    const { ctl, loads, messages } = await ready("steer")
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q2"])
    expect(turns(ctl)).toEqual([])
    // The server wrote the prompt after all.
    messages.push(userMessage("q1", "later", 100))
    await ctl.onEvent({ type: "session.inbox.delivered", created: 9, data: { sessionID: "ses_a", inboxID: "q1" } } as any)
    expect(turns(ctl)).toEqual([["q1", "later"]])
    expect(ctl.snapshot().error).toBeUndefined()
    const reloaded = loads()
    expect(reloaded).toBeGreaterThan(0)
    // A delivery for a prompt this client never dropped does not reload.
    await ctl.onEvent({ type: "session.inbox.delivered", created: 10, data: { sessionID: "ses_a", inboxID: "unknown" } } as any)
    expect(loads()).toBe(reloaded)
  })

  test("what was dropped is forgotten when the session changes", async () => {
    const { ctl, loads } = await ready("steer")
    await cancel(ctl)
    await ctl.open("ses_b")
    await ctl.open("ses_a")
    const before = loads()
    await ctl.onEvent({ type: "session.inbox.delivered", created: 9, data: { sessionID: "ses_a", inboxID: "q1" } } as any)
    expect(loads()).toBe(before)
  })
})

describe("Remove on a prompt the server already delivered", () => {
  const history = (...tail: any[]) => [userMessage("u0", "first", 10), assistantMessage("a0", 11), ...tail]

  test("the newest message of a running turn: the row follows the live path and settles that turn", async () => {
    const { ctl, loads } = await ready("steer", { messages: history(userMessage("q1", "later", 20)) })
    expect(turns(ctl).map((t) => t[0])).toEqual(["u0", "q1"])
    const before = loads()
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q2"])
    expect(loads()).toBe(before)
    expect(turns(ctl).map((t) => t[0])).toEqual(["u0", "q1"])
    expect(ctl.snapshot().view.turns[0]!.outcome).toBeDefined()
  })

  test("a prompt answered long ago is placed by a reload, after the turn it follows and before its own answer", async () => {
    // The server's inbox still holds q2, so the reload keeps that row.
    const { ctl, loads } = await ready("steer", { pending: ["q2"], messages: history(idleMessage("i0", 12), userMessage("q1", "later", 20), assistantMessage("a1", 21), idleMessage("i1", 22)) })
    // The view was loaded with the whole history; show the row as the missed event left it.
    await ctl.onEvent({ type: "session.inbox.enqueued", data: { sessionID: "ses_a", inboxID: "q1", item: { type: "user", delivery: "steer", payload: { text: "later" } } } } as any)
    const before = loads()
    await cancel(ctl)
    expect(loads()).toBeGreaterThan(before)
    expect(queued(ctl)).toEqual(["q2"])
    expect(turns(ctl).map((t) => t[0])).toEqual(["u0", "q1"])
    expect(ctl.snapshot().view.turns[1]!.steps).toHaveLength(1)
    expect(ctl.snapshot().error).toBeUndefined()
  })

  test("a prompt answered long ago while the last turn still runs does not settle that turn or land after its answer", async () => {
    const { ctl, messages } = await ready("steer", { pending: ["q2"], messages: history() })
    expect(ctl.snapshot().view.turns[0]!.outcome).toBeUndefined()
    // The server went on: the prompt and its answer are in the history, the event was missed.
    messages.push(userMessage("q1", "later", 20), assistantMessage("a1", 21))
    await cancel(ctl)
    expect(queued(ctl)).toEqual(["q2"])
    const shown = ctl.snapshot().view.turns
    expect(shown.map((t) => t.id)).toEqual(["u0", "q1"])
    expect(shown[1]!.steps).toHaveLength(1)
    expect(shown[1]!.user?.text).toBe("later")
  })

  test("a failing reload keeps the row's turn out and reports the transcript error, which a later load clears", async () => {
    const { ctl, messages } = await ready("steer", { messages: history() })
    messages.push(userMessage("q1", "later", 20), assistantMessage("a1", 21))
    const original = (ctl as any).client.message.list
    ;(ctl as any).client.message.list = async (i: { limit?: number }) => {
      if (i.limit === 1) return original(i)
      throw new Error("503 unavailable")
    }
    await cancel(ctl)
    expect(ctl.snapshot().error).toContain("Could not load")
    ;(ctl as any).client.message.list = original
    await ctl.dispatch({ type: "refresh" })
    await ctl.open("ses_b")
    await ctl.open("ses_a")
    expect(ctl.snapshot().error).toBeUndefined()
  })
})
