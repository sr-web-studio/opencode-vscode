import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import type { Action, AppState, ToWebview } from "@occ/core/protocol"
import { createBridge, MOBILE_CAPABILITIES, VOICE_LATER, WORKER_READ_ONLY, type KeyValueStore, type MobileHost, type Surface } from "../../apps/mobile/src/lib/bridge"

const session = (id: string, updated: number) => ({ id, title: `Title ${id}`, projectID: "prj", time: { created: 1, updated }, location: { directory: "/w" } })

/** A fake server with two root sessions. Enough for a controller to sync. */
function fakeClient(removed: string[] = []) {
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  return {
    location: { get: unsupported },
    session: {
      list: async () => ({ data: [session("ses_a", 3), session("ses_b", 2)] }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => session(sessionID, 1),
      remove: async ({ sessionID }: { sessionID: string }) => void removed.push(sessionID),
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

async function readyController(removed: string[] = []) {
  const ctl = new Controller({ directory: "/w", folderName: "w", displayPath: "/w" })
  ;(ctl as any).client = fakeClient(removed)
  await ctl.sync()
  return ctl
}

const surfaceOf = (ctl: Controller): Surface => ({
  subscribe: (l) => ctl.subscribe(l),
  dispatch: (a: Action) => ctl.dispatch(a),
  sessionID: () => ctl.currentSessionID,
  isWorker: (id) => !!ctl.sessionMeta(id)?.parentID,
})

function recordingHost(answers: { revert?: boolean; del?: boolean } = {}) {
  const log: Array<[string, ...unknown[]]> = []
  const rec =
    (name: string, ret?: unknown) =>
    (...a: unknown[]) => {
      log.push([name, ...a])
      return ret
    }
  const host: MobileHost = {
    openFile: rec("openFile") as any,
    imageData: (async (...a: unknown[]) => (log.push(["imageData", ...a]), "data:image/png;base64,AAAA")) as any,
    openImage: rec("openImage") as any,
    openDiff: rec("openDiff") as any,
    openChanges: rec("openChanges") as any,
    showTerminal: rec("showTerminal") as any,
    openWorker: rec("openWorker") as any,
    pickFiles: (async () => [{ uri: "data:text/plain;base64,aGk=", name: "a.txt", mime: "text/plain" }]) as any,
    confirmRevert: (async () => (log.push(["confirmRevert"]), answers.revert ?? false)) as any,
    confirmDeleteSession: (async (t: string) => (log.push(["confirmDeleteSession", t]), answers.del ?? false)) as any,
    openExternal: rec("openExternal") as any,
    notify: rec("notify") as any,
    reconnect: rec("reconnect") as any,
  }
  return { host, log }
}

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe("in-process bridge", () => {
  test("onMessage delivers the controller state; postToHost runs the action in the same context", async () => {
    const ctl = await readyController()
    const { host } = recordingHost()
    const bridge = createBridge(surfaceOf(ctl), host, memoryStore())
    const seen: AppState[] = []
    const off = bridge.onMessage((m: ToWebview) => m.type === "state" && seen.push(m.state))
    expect(seen.at(-1)?.sessions.map((s) => s.id)).toEqual(["ses_a", "ses_b"]) // subscribe replays the current state
    bridge.postToHost({ type: "action", action: { type: "openSession", id: "ses_b" } })
    await settle()
    expect(ctl.currentSessionID).toBe("ses_b")
    expect(seen.at(-1)?.target).toEqual({ kind: "session", id: "ses_b" })
    off()
    const n = seen.length
    await ctl.dispatch({ type: "openSession", id: "ses_a" })
    expect(seen.length).toBe(n) // unsubscribed
  })

  test("the UI's first action (ready) is answered with a state", async () => {
    const ctl = await readyController()
    const bridge = createBridge(surfaceOf(ctl), recordingHost().host, memoryStore())
    let states = 0
    bridge.onMessage(() => void states++)
    const before = states
    bridge.postToHost({ type: "action", action: { type: "ready" } })
    await settle()
    expect(states).toBeGreaterThan(before)
  })

  test("editor integrations become the app's screens", async () => {
    const ctl = await readyController()
    const { host, log } = recordingHost()
    const b = createBridge(surfaceOf(ctl), host, memoryStore())
    b.openFile("src/a.ts", 7)
    b.openDiff("src/a.ts", ["p1"])
    b.openChanges([{ file: "a", patches: ["p"] }], "T")
    b.showTerminal("shl_1", "ls")
    b.openSession("ses_kid", { readOnly: true })
    b.openExternal("https://example.com")
    b.notify("warning", "careful")
    b.openImage({ messageID: "msg_1", index: 0 }, "pic.png")
    expect(log).toEqual([
      ["openFile", "src/a.ts", 7],
      ["openDiff", "src/a.ts", ["p1"]],
      ["openChanges", [{ file: "a", patches: ["p"] }], "T"],
      ["showTerminal", "shl_1", "ls", "ses_a"],
      ["openWorker", "ses_kid"],
      ["openExternal", "https://example.com"],
      ["notify", "warning", "careful"],
      ["openImage", "ses_a", { messageID: "msg_1", index: 0 }, "pic.png"],
    ])
    expect(await b.imageData({ messageID: "msg_1", index: 0 })).toBe("data:image/png;base64,AAAA")
    expect(log.at(-1)).toEqual(["imageData", "ses_a", { messageID: "msg_1", index: 0 }])
    expect(await b.pickFiles()).toEqual([{ uri: "data:text/plain;base64,aGk=", name: "a.txt", mime: "text/plain" }])
  })

  test("a writable session opened through the bridge becomes the chat's session", async () => {
    const ctl = await readyController()
    const b = createBridge(surfaceOf(ctl), recordingHost().host, memoryStore())
    b.openSession("ses_b", { readOnly: false })
    await settle()
    expect(ctl.currentSessionID).toBe("ses_b")
  })

  test("a worker opened without readOnly still becomes the read-only worker screen", async () => {
    const ctl = await readyController()
    const { host, log } = recordingHost()
    const b = createBridge(surfaceOf(ctl), host, memoryStore())
    ;(ctl as any).children.set("ses_kid", { ...session("ses_kid", 1), parentID: "ses_a" })
    b.openSession("ses_kid", { readOnly: false })
    b.postToHost({ type: "action", action: { type: "openSession", id: "ses_kid" } })
    b.postToHost({ type: "host", request: { type: "openSession", id: "ses_kid", readOnly: false } })
    await settle()
    expect(log).toEqual([
      ["openWorker", "ses_kid"],
      ["openWorker", "ses_kid"],
      ["openWorker", "ses_kid"],
    ])
    expect(ctl.currentSessionID).not.toBe("ses_kid")
  })

  test("a prompt sent while a worker is the screen is refused with a calm message", async () => {
    const dispatched: Action[] = []
    const { host, log } = recordingHost()
    const surface: Surface = { subscribe: () => () => {}, dispatch: async (a) => void dispatched.push(a), sessionID: () => "ses_w", isWorker: () => true }
    createBridge(surface, host, memoryStore()).postToHost({ type: "action", action: { type: "send", text: "hello" } })
    await settle()
    expect(dispatched).toEqual([])
    expect(log).toEqual([["notify", "warning", WORKER_READ_ONLY]])
  })

  test("delete: only the modal's yes deletes; cancel does nothing", async () => {
    const removed: string[] = []
    const ctl = await readyController(removed)
    const no = recordingHost({ del: false })
    createBridge(surfaceOf(ctl), no.host, memoryStore()).confirmDeleteSession("ses_b", "Title ses_b")
    await settle()
    expect(no.log).toEqual([["confirmDeleteSession", "Title ses_b"]])
    expect(removed).toEqual([])
    const yes = recordingHost({ del: true })
    createBridge(surfaceOf(ctl), yes.host, memoryStore()).confirmDeleteSession("ses_b", "Title ses_b")
    await settle()
    expect(removed).toEqual(["ses_b"])
    expect(ctl.snapshot().sessions.map((s) => s.id)).toEqual(["ses_a"])
  })

  test("revert: the modal's yes dispatches revert; cancel does not", async () => {
    const dispatched: Action[] = []
    const surface: Surface = { subscribe: () => () => {}, dispatch: async (a) => void dispatched.push(a), sessionID: () => "ses_a" }
    createBridge(surface, recordingHost({ revert: false }).host, memoryStore()).confirmRevert("msg_1")
    await settle()
    expect(dispatched).toEqual([])
    createBridge(surface, recordingHost({ revert: true }).host, memoryStore()).confirmRevert("msg_1")
    await settle()
    expect(dispatched).toEqual([{ type: "revert", messageID: "msg_1" }])
  })

  test("host requests that arrive as messages are routed the same way", async () => {
    const dispatched: Action[] = []
    const surface: Surface = { subscribe: () => () => {}, dispatch: async (a) => void dispatched.push(a), sessionID: () => "ses_a" }
    const { host, log } = recordingHost({ revert: true, del: true })
    const b = createBridge(surface, host, memoryStore())
    b.postToHost({ type: "host", request: { type: "openFile", path: "x.ts", line: 3 } })
    b.postToHost({ type: "host", request: { type: "openSession", id: "k", readOnly: true } })
    b.postToHost({ type: "host", request: { type: "showTerminal", shellID: "s1" } })
    b.postToHost({ type: "host", request: { type: "reconnect" } })
    b.postToHost({ type: "host", request: { type: "confirmRevert", messageID: "m" } })
    b.postToHost({ type: "host", request: { type: "confirmDeleteSession", sessionID: "ses_b", title: "T" } })
    // The VS Code only ones are ignored without a crash.
    b.postToHost({ type: "host", request: { type: "openGlobalConfig" } })
    b.postToHost({ type: "host", request: { type: "setCliPath" } })
    await settle()
    expect(log.map((l) => l[0])).toEqual(["openFile", "openWorker", "showTerminal", "reconnect", "confirmRevert", "confirmDeleteSession"])
    expect(log[2]).toEqual(["showTerminal", "s1", undefined, "ses_a"])
    expect(dispatched).toEqual([
      { type: "revert", messageID: "m" },
      { type: "deleteSession", sessionID: "ses_b" },
    ])
  })

  test("the mic says the voice feature comes later; nothing is dispatched", () => {
    const { host, log } = recordingHost()
    const b = createBridge({ subscribe: () => () => {}, dispatch: async () => {}, sessionID: () => undefined }, host, memoryStore())
    b.voice()
    b.voiceLanguage()
    b.postToHost({ type: "host", request: { type: "voice" } })
    expect(log).toEqual([
      ["notify", "info", VOICE_LATER],
      ["notify", "info", VOICE_LATER],
      ["notify", "info", VOICE_LATER],
    ])
  })

  test("without a session nothing opens an image and nothing throws", async () => {
    const { host, log } = recordingHost()
    const b = createBridge({ subscribe: () => () => {}, dispatch: async () => {}, sessionID: () => undefined }, host, memoryStore())
    b.openImage({ messageID: "m", index: 0 })
    expect(await b.imageData({ messageID: "m", index: 0 })).toBeUndefined()
    expect(log).toEqual([])
  })

  test("a failing image loader or file picker gives the UI an empty answer, not an exception", async () => {
    const { host } = recordingHost()
    host.imageData = async () => {
      throw new Error("gone")
    }
    host.pickFiles = async () => {
      throw new Error("cancelled")
    }
    const b = createBridge({ subscribe: () => () => {}, dispatch: async () => {}, sessionID: () => "ses_a" }, host, memoryStore())
    expect(await b.imageData({ messageID: "m", index: 0 })).toBeUndefined()
    expect(await b.pickFiles()).toEqual([])
  })

  test("UI state is kept in the key/value store under its own prefix", () => {
    const store = memoryStore()
    const b = createBridge({ subscribe: () => () => {}, dispatch: async () => {}, sessionID: () => undefined }, recordingHost().host, store)
    expect(b.storage.get("x")).toBeUndefined()
    b.storage.set("x", { a: [1, 2] })
    expect(b.storage.get("x")).toEqual({ a: [1, 2] })
    expect([...store.data.keys()]).toEqual(["occ.ui.x"])
    store.data.set("occ.ui.bad", "{not json")
    expect(b.storage.get("bad")).toBeUndefined()
  })

  test("capabilities: no mic, no config editor, no MCP sign-in; Enter adds a line; shell output screen", () => {
    const b = createBridge({ subscribe: () => () => {}, dispatch: async () => {}, sessionID: () => undefined }, recordingHost().host, memoryStore())
    expect(b.capabilities).toEqual(MOBILE_CAPABILITIES)
    expect(MOBILE_CAPABILITIES).toEqual({ voice: false, editConfig: false, mcpSignIn: false, enterSends: false, shellView: "output" })
  })
})
