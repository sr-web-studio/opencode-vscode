import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { sessionStatus } from "@occ/core/session-status"
import { messageListFake } from "../fakes/message-list"

const session = (id: string, idle?: number) => ({
  id,
  title: `Title ${id}`,
  projectID: "prj",
  outcome: idle === undefined ? undefined : ("succeeded" as const),
  time: { created: 1, updated: 1, ...(idle === undefined ? {} : { idle }) },
  location: { directory: "/w" },
})

/** The server as a folder's controller sees it. `views` records every `session.view` call. */
function server(idle: number | null = 30) {
  const at = idle === null ? undefined : idle
  const views: Array<{ sessionID: string; idle: number }> = []
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const { list } = messageListFake([])
  const client: any = {
    location: { get: unsupported },
    session: {
      list: async () => ({ data: [session("ses_a", at), session("ses_b", at)] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID, at),
      view: async (input: { sessionID: string; idle: number }) => {
        views.push(input)
        return { data: {} }
      },
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
  return { client, views }
}

/** A synced controller on the session `ses_a`, whose server record ends its last turn at `idle`. */
async function synced(idle: number | null = 30) {
  const { client, views } = server(idle)
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
  ;(ctl as any).client = client
  await ctl.sync()
  // The chat view is on screen, as the host reports it (`setVisible`). Set after the sync so its view stamp of the
  // already-loaded session does not count as one of the test's own.
  ;(ctl as any).visible = true
  return { ctl, views }
}

const event = (type: string, sessionID: string, created: number, data: Record<string, unknown> = {}) => ({
  type,
  created,
  location: { directory: "/w" },
  data: { sessionID, ...data },
})

describe("a session the user opens is marked read on the server", () => {
  test("opening the session on screen calls session.view with the last turn's idle stamp", async () => {
    const { ctl, views } = await synced()
    // `sync` already opened the remembered/first session; opening it again is still a look at it.
    await ctl.open("ses_a")
    expect(views).toEqual([{ sessionID: "ses_a", idle: 30 }])
    const record = ctl.snapshot().sessions.find((s) => s.id === "ses_a")!
    expect(record.time.viewed).toBe(30)
    expect(sessionStatus(record, { running: new Set(), waiting: new Set() }, 40)).toBe("read")
  })

  test("a view stamp is never sent twice for the same turn", async () => {
    const { ctl, views } = await synced()
    await ctl.open("ses_a")
    await ctl.open("ses_a")
    ctl.setVisible(true)
    expect(views).toHaveLength(1)
  })

  test("a session with nothing finished yet sends no view stamp", async () => {
    const { ctl, views } = await synced(null)
    await ctl.open("ses_a")
    expect(views).toEqual([])
  })
})

describe("a turn that ends while the chat is on screen is seen", () => {
  test("the turn end of the session on screen marks it read", async () => {
    const { ctl, views } = await synced()
    await ctl.onEvent(event("session.execution.succeeded", "ses_a", 40))
    expect(views).toEqual([{ sessionID: "ses_a", idle: 40 }])
  })

  test("a turn end while the view is hidden stays unread until the view comes back", async () => {
    const { ctl, views } = await synced()
    ctl.setVisible(false)
    await ctl.onEvent(event("session.execution.succeeded", "ses_a", 40))
    expect(views).toEqual([])
    const record = ctl.snapshot().sessions.find((s) => s.id === "ses_a")!
    expect(sessionStatus(record, { running: new Set(), waiting: new Set() }, 40)).toBe("unread")
    // Back in front: the session on screen is looked at again.
    ctl.setVisible(true)
    expect(views).toEqual([{ sessionID: "ses_a", idle: 40 }])
  })

  test("the server's idle stamp wins over the execution event and marks the same turn", async () => {
    const { ctl, views } = await synced()
    ctl.setVisible(false)
    await ctl.onEvent(event("session.idle", "ses_a", 41))
    expect(views).toEqual([])
    expect(ctl.snapshot().sessions.find((s) => s.id === "ses_a")?.time.idle).toBe(41)
    ctl.setVisible(true)
    expect(views).toEqual([{ sessionID: "ses_a", idle: 41 }])
  })

  test("a turn of another session never marks the one on screen", async () => {
    const { ctl, views } = await synced()
    await ctl.onEvent(event("session.execution.succeeded", "ses_b", 40))
    expect(views).toEqual([])
  })
})

describe("another client marking a session read", () => {
  test("session.viewed moves the local stamp without a server call of our own", async () => {
    const { ctl, views } = await synced()
    await ctl.onEvent(event("session.viewed", "ses_b", 40, { idle: 30 }))
    expect(views).toEqual([])
    const record = ctl.snapshot().sessions.find((s) => s.id === "ses_b")!
    expect(record.time.viewed).toBe(30)
    expect(sessionStatus(record, { running: new Set(), waiting: new Set() }, 40)).toBe("read")
  })
})
