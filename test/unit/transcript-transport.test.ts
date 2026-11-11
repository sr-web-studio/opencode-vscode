import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { SessionFeed, isTransportError, retryDelay } from "@occ/core/feed"
import { FolderRegistry, type FolderEntry } from "@occ/core/folders"
import type { RawMessage } from "@occ/core/history"
import { messageListFake } from "../fakes/message-list"

/** One turn: the prompt, the answer and the idle marker that ends it. */
const history: RawMessage[] = [
  { id: "m1", type: "user", text: "build the extension", time: { created: 1000 } },
  { id: "m2", type: "assistant", content: [{ type: "text", text: "on it" }], time: { created: 2000 } },
  { id: "m3", type: "idle", outcome: "succeeded", time: { created: 3000 } },
]

const session = (id: string, directory: string) => ({ id, title: `Title ${id}`, projectID: "prj", time: { created: 1, updated: 1 }, location: { directory } })

/** The shape `@opencode/client` throws when the server closed the socket before answering. */
function transportError(): Error {
  return Object.assign(new Error("Transport: terminated"), {
    name: "ClientError",
    reason: "Transport",
    cause: Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("other side closed"), { name: "SocketError" }) }),
  })
}

const statusError = () => Object.assign(new Error("500"), { name: "ClientError", reason: "UnexpectedStatus", cause: { status: 500 } })

/** Wait for something the controller does in the background (a load it started without being awaited). */
async function until(condition: () => boolean, ms = 1000): Promise<void> {
  const end = Date.now() + ms
  while (!condition() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5))
}

/** Eight folders of one multi-root window, each with one root session and a transcript. */
function multiRoot() {
  const { list } = messageListFake(history)
  const calls: string[] = []
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const idOf = (directory: string) => `ses_${directory.split("/").pop()}`
  const client: any = {
    location: { get: unsupported },
    session: {
      // The server filters on the exact directory it is asked for.
      list: async ({ directory }: { directory?: string }) => ({ data: directory ? [session(idOf(directory), directory)] : [] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID, "/w/a"),
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
    message: {
      list: async (input: { sessionID: string }) => {
        calls.push(input.sessionID)
        return list(input)
      },
    },
    event: { subscribe: async function* () {} },
  }
  return { client, calls, idOf }
}

const entry = (directory: string): FolderEntry => ({ directory, folderName: directory.split("/").pop() || directory, displayPath: directory })

/** The eight controllers of a window, synced the way startup does it: all at once, one after the other attached. */
async function window(count: number) {
  const { client, calls, idOf } = multiRoot()
  const made: Controller[] = []
  const folders = new FolderRegistry<Controller>({
    make: (folder) => {
      const controller = new Controller({ directory: folder.directory, folderName: folder.folderName, displayPath: folder.displayPath })
      made.push(controller)
      return controller
    },
  })
  const entries = Array.from({ length: count }, (_, i) => entry(`/w/${String.fromCharCode(97 + i)}`))
  folders.sync(entries)
  for (const controller of made) (controller as any).client = client
  await Promise.all(made.map((controller) => controller.sync()))
  return { folders, made, calls, idOf }
}

describe("a multi-root window at startup", () => {
  test("only the folder on screen loads its transcript", async () => {
    const { folders, made, calls, idOf } = await window(8)
    expect(made.length).toBe(8)
    expect(calls).toEqual([idOf("/w/a")])
    expect(made[0]!.snapshot().view.loaded).toBe(true)
    expect(made[0]!.snapshot().view.turns.length).toBe(1)
    for (const controller of made.slice(1)) {
      expect(controller.snapshot().view.loaded).toBe(false)
      expect(controller.snapshot().view.turns).toEqual([])
    }
    folders.dispose()
  })

  test("a background folder still lists its sessions and running state", async () => {
    const { folders, made } = await window(8)
    const background = made[1]!.snapshot()
    expect(background.sessionsLoaded).toBe(true)
    expect(background.sessions.map((s) => s.id)).toEqual(["ses_b"])
    expect(background.target).toEqual({ kind: "session", id: "ses_b" })
    expect(background.loadingView).toBe(false)
    expect(background.error).toBeUndefined()
    folders.dispose()
  })

  test("switching to a folder loads the transcript it skipped, and switching back does not fetch it again", async () => {
    const { folders, made, calls, idOf } = await window(8)
    expect(folders.setActive("/w/c")).toBe(true)
    await until(() => made[2]!.snapshot().view.loaded)
    expect(calls).toEqual([idOf("/w/a"), idOf("/w/c")])
    expect(made[2]!.snapshot().view.turns.length).toBe(1)
    // The folder that was on screen keeps what it has.
    expect(made[0]!.snapshot().view.turns.length).toBe(1)

    expect(folders.setActive("/w/c")).toBe(false)
    expect(folders.setActive("/w/a")).toBe(true)
    expect(folders.setActive("/w/c")).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual([idOf("/w/a"), idOf("/w/c")])
    folders.dispose()
  })
})

describe("a transcript request that never got an answer", () => {
  const feed = (waits: number[]) =>
    new SessionFeed(
      () => {},
      () => {},
      undefined,
      async (ms) => void waits.push(ms),
    )

  test("is retried after a pause, and after a longer pause before the last try", async () => {
    const waits: number[] = []
    let calls = 0
    const client = {
      message: {
        list: async () => {
          calls++
          throw transportError()
        },
      },
      session: { inbox: { list: async () => [] } },
    } as any
    const subject = feed(waits)
    await subject.load(client, "ses_a")
    expect(calls).toBe(3)
    expect(waits).toEqual([retryDelay(1), retryDelay(2)])
    expect(subject.view.loaded).toBe(true)
    expect(subject.loadError).toContain("Could not load the session")
  })

  test("loads the transcript when the retry works", async () => {
    const { list } = messageListFake(history)
    const waits: number[] = []
    let calls = 0
    const client = {
      message: { list: async (input: any) => (++calls === 1 ? Promise.reject(transportError()) : list(input)) },
      session: { inbox: { list: async () => [] } },
    } as any
    const subject = feed(waits)
    await subject.load(client, "ses_a")
    expect(calls).toBe(2)
    expect(waits).toEqual([retryDelay(1)])
    expect(subject.view.loaded).toBe(true)
    expect(subject.view.turns.length).toBe(1)
    expect(subject.loadError).toBeUndefined()
  })

  test("a status error is asked for once more only: its answer will not change", async () => {
    const waits: number[] = []
    let calls = 0
    const client = {
      message: {
        list: async () => {
          calls++
          throw statusError()
        },
      },
      session: { inbox: { list: async () => [] } },
    } as any
    const subject = feed(waits)
    await subject.load(client, "ses_a")
    expect(calls).toBe(2)
    expect(waits).toEqual([retryDelay(1)])
  })
})

describe("the retry timing", () => {
  test("doubles per attempt and stops growing", () => {
    expect(retryDelay(1)).toBe(750)
    expect(retryDelay(2)).toBe(1500)
    expect(retryDelay(3)).toBe(3000)
    expect(retryDelay(9)).toBe(3000)
  })

  test("only a request that never got an answer counts as transport", () => {
    expect(isTransportError(transportError())).toBe(true)
    expect(isTransportError(statusError())).toBe(false)
    expect(isTransportError(new Error("Request failed"))).toBe(false)
    expect(isTransportError(undefined)).toBe(false)
  })
})

describe("a click on a session of another folder", () => {
  /** Two folders; the second lists two sessions, so the one the click opens is not the one it remembers. */
  async function clickable() {
    const calls: string[] = []
    const byDirectory: Record<string, Array<{ id: string; title: string; projectID: string; time: { created: number; updated: number }; location: { directory: string } }>> = {
      "/w/a": [session("ses_a", "/w/a")],
      "/w/b": [session("ses_b1", "/w/b"), session("ses_b2", "/w/b")],
    }
    const { list } = messageListFake(history)
    const unsupported = () => Promise.reject(new Error("404 not found"))
    const empty = { data: [] }
    const client: any = {
      location: { get: unsupported },
      session: {
        list: async ({ directory }: { directory?: string }) => ({ data: directory ? (byDirectory[directory] ?? []) : [] }),
        active: async () => ({}),
        get: async ({ sessionID }: { sessionID: string }) => byDirectory["/w/b"]!.find((s) => s.id === sessionID) ?? session(sessionID, "/w/a"),
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
      message: {
        list: async (input: { sessionID: string }) => {
          calls.push(input.sessionID)
          return list(input)
        },
      },
      event: { subscribe: async function* () {} },
    }
    const folders = new FolderRegistry<Controller>({
      make: (folder) => new Controller({ directory: folder.directory, folderName: folder.folderName, displayPath: folder.displayPath }),
    })
    folders.sync([entry("/w/a"), entry("/w/b")])
    for (const controller of folders.controllers()) (controller as any).client = client
    await Promise.all(folders.controllers().map((controller) => controller.sync()))
    return { folders, calls }
  }

  test("loads the clicked session once, not the folder's remembered one first", async () => {
    const { folders, calls } = await clickable()
    expect(calls).toEqual(["ses_a"])
    calls.length = 0
    // What `view.ts` does for `openSessionInFolder`: switch the folder, then open the row in the same tick.
    const controller = folders.activateForSession("ses_b2", "/w/b")
    await controller.open("ses_b2")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual(["ses_b2"])
    folders.dispose()
  })
})
