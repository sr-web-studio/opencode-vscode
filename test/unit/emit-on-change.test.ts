import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import type { AppState, SessionInfo } from "@occ/core/protocol"

/**
 * In a multi-root window every folder's controller sees every frame of the stream. A frame that changes nothing this
 * folder shows must cost no snapshot and no webview post: that is what made a busy window expensive.
 */

const session = (id: string): SessionInfo => ({ id, title: `Title ${id}`, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory: "/w" } }) as SessionInfo

function server() {
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  // Sessions made by an event, so `session.get` can answer with their real parent.
  const created = new Map<string, SessionInfo>()
  return {
    created,
    location: { get: unsupported },
    session: {
      list: async () => ({ data: [session("ses_a"), session("ses_b")] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => created.get(sessionID) ?? session(sessionID),
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
    message: { list: async () => ({ data: [], cursor: { next: null, previous: null } }) },
    event: { subscribe: async function* () {} },
  } as any
}

async function ready() {
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
  ;(ctl as any).client = server()
  await ctl.sync()
  ctl.setConnection({ status: "connected" })
  return ctl
}

/** The emit is debounced, so a frame's snapshot arrives a moment later. */
const settle = () => new Promise((r) => setTimeout(r, 60))

const delta = (sessionID: string, text: string) => ({ type: "session.text.delta", created: 2, data: { sessionID, assistantMessageID: "msg_1", ordinal: 0, delta: text } }) as any

function record(ctl: Controller) {
  const seen: AppState[] = []
  const off = ctl.subscribe((s) => seen.push(s))
  seen.length = 0
  return { seen, off }
}

describe("a frame that changes nothing here posts no snapshot", () => {
  test("a delta of a listed session that is not on screen, and of a session this folder does not list", async () => {
    const ctl = await ready()
    const { seen, off } = record(ctl)
    await ctl.onEvent(delta("ses_b", "elsewhere"))
    await ctl.onEvent(delta("ses_ghost", "not ours"))
    await settle()
    expect(seen).toHaveLength(0)
    off()
    ctl.detach()
  })

  test("an event of another folder's session is still ignored", async () => {
    const ctl = await ready()
    const { seen, off } = record(ctl)
    await ctl.onEvent({ type: "session.execution.started", created: 9_000, location: { directory: "/other" }, data: { sessionID: "ses_other" } } as any)
    await settle()
    expect(seen).toHaveLength(0)
    off()
    ctl.detach()
  })
})

describe("a frame that changes what this folder shows posts one snapshot", () => {
  test("a session starts executing", async () => {
    const ctl = await ready()
    const { seen, off } = record(ctl)
    await ctl.onEvent({ type: "session.execution.started", created: 5_000, data: { sessionID: "ses_a" } } as any)
    await settle()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.running).toContain("ses_a")
    off()
    ctl.detach()
  })

  test("the session on screen streams, and the post carries the new text", async () => {
    const ctl = await ready()
    await ctl.open("ses_a")
    const { seen, off } = record(ctl)
    await ctl.onEvent({ type: "session.step.started", created: 2, data: { sessionID: "ses_a", assistantMessageID: "msg_1", started: 2 } } as any)
    await settle()
    await ctl.onEvent(delta("ses_a", "hello"))
    await settle()
    expect(seen.length).toBeGreaterThanOrEqual(2)
    const text = seen
      .at(-1)!
      .view.turns.flatMap((t) => t.steps.flatMap((s) => s.items.filter((i) => i.kind === "text").map((i) => i.text ?? "")))
      .join("")
    expect(text).toBe("hello")
    off()
    ctl.detach()
  })
})

describe("the listed-session index covers every way a session belongs here", () => {
  test("a root in the list, an archived one, a worker of a listed root, and a child of a listed root", async () => {
    const ctl = await ready()
    await ctl.open("ses_a")
    expect(ctl.listsSession("ses_a")).toBe(true)
    expect(ctl.listsSession("ses_ghost")).toBe(false)
    ;(ctl as any).archived = [session("ses_old")]
    expect(ctl.listsSession("ses_old")).toBe(true)
    ;(ctl as any).archived = []
    expect(ctl.listsSession("ses_old")).toBe(false)
    ;(ctl as any).client.created.set("ses_kid", { ...session("ses_kid"), parentID: "ses_a" })
    await ctl.onEvent({ type: "session.created", created: 3, data: { sessionID: "ses_kid", parentID: "ses_a" } } as any)
    expect(ctl.listsSession("ses_kid")).toBe(true)
    expect(ctl.snapshot().workers.map((w) => w.sessionID)).toContain("ses_kid")
    // A worker of a session this folder does not list stays out.
    ;(ctl as any).client.created.set("ses_kid2", { ...session("ses_kid2"), parentID: "ses_ghost" })
    await ctl.onEvent({ type: "session.created", created: 4, data: { sessionID: "ses_kid2", parentID: "ses_ghost" } } as any)
    expect(ctl.listsSession("ses_kid2")).toBe(false)
    ctl.detach()
  })

  test("a deleted session stops being listed and a stale index does not keep it", async () => {
    const ctl = await ready()
    expect(ctl.listsSession("ses_b")).toBe(true)
    await ctl.onEvent({ type: "session.deleted", created: 6, data: { sessionID: "ses_b" } } as any)
    expect(ctl.listsSession("ses_b")).toBe(false)
    ctl.detach()
  })
})
