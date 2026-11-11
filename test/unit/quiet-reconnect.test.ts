import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { Controller, RESUME_QUIET_MS } from "@occ/core/controller"

const session = (id: string) => ({ id, title: `Title ${id}`, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory: "/w" } })

function server() {
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const client: any = {
    location: { get: unsupported },
    session: { list: async () => ({ data: [session("ses_a"), session("ses_b")] }), active: async () => ({}), get: async ({ sessionID }: { sessionID: string }) => session(sessionID) },
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
  }
  return client
}

async function ready() {
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
  ;(ctl as any).client = server()
  await ctl.sync()
  ctl.setConnection({ status: "connected" })
  return ctl
}

const status = (ctl: Controller) => ctl.snapshot().connection.status

afterEach(() => setSystemTime())

describe("a quiet (resume) reconnect", () => {
  test("keeps showing Connected while the stream is back within the window, and the real state afterwards", async () => {
    const ctl = await ready()
    const t0 = Date.now()
    setSystemTime(t0)
    ctl.reconnect({ quiet: true })
    ctl.setConnection({ status: "disconnected", message: "Event stream closed" })
    expect(status(ctl)).toBe("connected")
    setSystemTime(t0 + RESUME_QUIET_MS - 100)
    expect(status(ctl)).toBe("connected")
    // Still not back after the window: the outage shows.
    setSystemTime(t0 + RESUME_QUIET_MS + 1)
    expect(status(ctl)).toBe("disconnected")
    ctl.detach()
  })

  test("the stream comes back: connected, and a later real drop is not hidden", async () => {
    const ctl = await ready()
    const t0 = Date.now()
    setSystemTime(t0)
    ctl.reconnect({ quiet: true })
    ctl.setConnection({ status: "disconnected" })
    await ctl.onEvent({ type: "server.connected", data: {} } as any)
    expect(status(ctl)).toBe("connected")
    setSystemTime(t0 + 1000)
    ctl.setConnection({ status: "disconnected", message: "gone" })
    expect(status(ctl)).toBe("disconnected")
    ctl.detach()
  })

  test("an error (the sync failed) is never hidden", async () => {
    const ctl = await ready()
    ctl.reconnect({ quiet: true })
    ctl.setConnection({ status: "error", message: "boom" })
    expect(ctl.snapshot().connection).toEqual({ status: "error", message: "boom" })
    ctl.detach()
  })

  test("a plain reconnect() (the extension, the Try again button) shows the drop at once, as before", async () => {
    const ctl = await ready()
    ctl.reconnect()
    ctl.setConnection({ status: "disconnected" })
    expect(status(ctl)).toBe("disconnected")
    ctl.detach()
  })

  test("a connection that was already down is not made to look fine by a resume", async () => {
    const ctl = await ready()
    ctl.setConnection({ status: "disconnected", message: "real outage" })
    ctl.reconnect({ quiet: true })
    expect(status(ctl)).toBe("disconnected")
    ctl.detach()
  })
})

describe("the terminal badge (running shells of the open session)", () => {
  const created = { type: "shell.created", data: { info: { id: "sh_1", status: "running", metadata: { sessionID: "ses_a" } } } } as any
  const count = (ctl: Controller) => ctl.snapshot().runningShells

  test("counts a running shell, and drops it on shell.deleted", async () => {
    const ctl = await ready()
    await ctl.open("ses_a")
    await ctl.onEvent(created)
    expect(count(ctl)).toBe(1)
    await ctl.onEvent({ type: "shell.deleted", data: { id: "sh_1" } } as any)
    expect(count(ctl)).toBe(0)
    ctl.detach()
  })

  test("the shell → session map answers without a request, and keeps the session after the exit", async () => {
    const ctl = await ready()
    const calls: string[] = []
    ;(ctl as any).client.shell.get = async ({ id }: { id: string }) => {
      calls.push(id)
      return { data: { id, metadata: { sessionID: "ses_a" } } }
    }
    await ctl.onEvent(created)
    expect(ctl.shellSessionOf("sh_1")).toBe("ses_a")
    await ctl.onEvent({ type: "shell.exited", data: { id: "sh_1", status: "exited", exit: 0 } } as any)
    expect(ctl.shellSessionOf("sh_1")).toBe("ses_a")
    expect(calls).toEqual([])
    await ctl.onEvent({ type: "shell.deleted", data: { id: "sh_1" } } as any)
    expect(ctl.shellSessionOf("sh_1")).toBeUndefined()
    ctl.detach()
  })

  test("a turn that ends with the shell events lost no longer leaves the badge at 1 (the server list is the truth)", async () => {
    const ctl = await ready()
    await ctl.open("ses_a")
    await ctl.onEvent(created)
    expect(count(ctl)).toBe(1)
    // The server no longer has the shell (its exit/delete events never arrived).
    await ctl.onEvent({ type: "session.execution.interrupted", data: { sessionID: "ses_a" } } as any)
    await new Promise((r) => setTimeout(r, 0))
    expect(count(ctl)).toBe(0)
    ctl.detach()
  })

  test("a shell that is still running after the turn ended stays counted", async () => {
    const ctl = await ready()
    ;(ctl as any).client.shell.list = async () => ({ data: [{ id: "sh_1", status: "running", metadata: { sessionID: "ses_a" } }] })
    await ctl.open("ses_a")
    await ctl.onEvent(created)
    await ctl.onEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_a" } } as any)
    await new Promise((r) => setTimeout(r, 0))
    expect(count(ctl)).toBe(1)
    ctl.detach()
  })
})

describe("the current session of a project controller (Changes must follow it)", () => {
  test("opening another session switches currentSessionID and the title Changes shows", async () => {
    const ctl = await ready()
    await ctl.open("ses_a")
    expect(ctl.sessionMeta(ctl.currentSessionID ?? "")?.title).toBe("Title ses_a")
    await ctl.open("ses_b")
    expect(ctl.currentSessionID).toBe("ses_b")
    expect(ctl.sessionMeta(ctl.currentSessionID ?? "")?.title).toBe("Title ses_b")
    ctl.detach()
  })
})
