import { describe, expect, test } from "bun:test"
import { Workspace, type ProjectInfo } from "../../apps/mobile/src/lib/workspace"
import { canPop, directoriesInUse, pop, popKey, push, stackForSession, stackForWorker, top, type Entry } from "../../apps/mobile/src/lib/nav"

class FakeController {
  attached = 0
  detached = 0
  reconnected = 0
  constructor(readonly project: ProjectInfo) {}
  attach() {
    this.attached++
  }
  detach() {
    this.detached++
  }
  reconnect() {
    this.reconnected++
  }
}

const info = (directory: string): ProjectInfo => ({ directory, folderName: directory.split("/").pop()!, displayPath: directory })
const client = {} as any

describe("workspace: one live controller per open project", () => {
  test("a project's controller is created and attached once, however often it is asked for", () => {
    const made: FakeController[] = []
    const ws = new Workspace(client, (p) => (made.push(new FakeController(p)), made.at(-1)!))
    const a = ws.acquire(info("/a"))
    expect(ws.acquire(info("/a"))).toBe(a)
    expect(made.length).toBe(1)
    expect(a.attached).toBe(1)
    ws.acquire(info("/b"))
    expect(ws.directories).toEqual(["/a", "/b"])
  })

  test("leaving a project disposes its controller (detach) and keeps the others", () => {
    const ws = new Workspace(client, (p) => new FakeController(p))
    const a = ws.acquire(info("/a"))
    const b = ws.acquire(info("/b"))
    expect(ws.keepOnly(new Set(["/b"]))).toEqual(["/a"])
    expect([a.detached, b.detached]).toEqual([1, 0])
    expect(ws.get("/a")).toBeUndefined()
    expect(ws.get("/b")).toBe(b)
    // Coming back makes a fresh controller.
    const a2 = ws.acquire(info("/a"))
    expect(a2).not.toBe(a)
    expect(a2.attached).toBe(1)
  })

  test("resume reconnects every open project's stream", () => {
    const ws = new Workspace(client, (p) => new FakeController(p))
    const a = ws.acquire(info("/a"))
    const b = ws.acquire(info("/b"))
    ws.resume()
    ws.resume()
    expect([a.reconnected, b.reconnected]).toEqual([2, 2])
  })

  test("dispose detaches everything and refuses new projects", () => {
    const ws = new Workspace(client, (p) => new FakeController(p))
    const a = ws.acquire(info("/a"))
    ws.dispose()
    expect(a.detached).toBe(1)
    expect(ws.directories).toEqual([])
    expect(() => ws.acquire(info("/a"))).toThrow(/closed/)
  })
})

describe("screen stack", () => {
  const keys = () => {
    let n = 0
    return () => ++n
  }
  const names = (s: Entry[]) => s.map((e) => e.screen.kind)

  test("push and back; the bottom screen stays", () => {
    const k = keys()
    let s: Entry[] = [{ key: k(), screen: { kind: "servers" } }]
    expect(canPop(s)).toBe(false)
    s = push(s, { kind: "projects" }, k())
    s = push(s, { kind: "sessions", directory: "/a" }, k())
    expect(names(s)).toEqual(["servers", "projects", "sessions"])
    s = pop(pop(s))
    expect(names(pop(s))).toEqual(["servers"])
    expect(top(s)).toEqual({ kind: "servers" })
  })

  test("popKey closes only the screen that asked, not the one on top of it now", () => {
    const k = keys()
    let s: Entry[] = [{ key: k(), screen: { kind: "servers" } }]
    s = push(s, { kind: "projects" }, 10)
    s = push(s, { kind: "sessions", directory: "/a" }, 11)
    expect(names(popKey(s, 10))).toEqual(["servers", "projects", "sessions"])
    expect(names(popKey(s, 11))).toEqual(["servers", "projects"])
  })

  test("the folders still in use are those of the screens on the stack", () => {
    const k = keys()
    let s: Entry[] = [
      { key: k(), screen: { kind: "servers" } },
      { key: k(), screen: { kind: "projects" } },
    ]
    expect([...directoriesInUse(s)]).toEqual([])
    s = push(s, { kind: "sessions", directory: "/a" }, k())
    s = push(s, { kind: "chat", directory: "/a" }, k())
    s = push(s, { kind: "worker", directory: "/a", sessionID: "ses_w" }, k())
    expect([...directoriesInUse(s)]).toEqual(["/a"])
    // Going back to the project list closes the project: its controller is disposed by the caller.
    s = s.slice(0, 2)
    expect(directoriesInUse(s).size).toBe(0)
  })

  test("a deep link builds the whole path, so back walks out step by step", () => {
    const s = stackForSession("/a", keys())
    expect(names(s)).toEqual(["servers", "projects", "sessions", "chat"])
    expect(new Set(s.map((e) => e.key)).size).toBe(4)
    expect(names(pop(pop(s)))).toEqual(["servers", "projects"])
    expect(top(s)).toEqual({ kind: "chat", directory: "/a", sessionID: undefined })
    expect(top(stackForSession("/a", keys(), "ses_1"))).toEqual({ kind: "chat", directory: "/a", sessionID: "ses_1" })
  })

  test("a worker deep link ends at the read-only worker screen, never a chat", () => {
    const worker = stackForWorker("/a", keys(), "ses_w")
    expect(names(worker)).toEqual(["servers", "projects", "sessions", "worker"])
    expect(top(worker)).toEqual({ kind: "worker", directory: "/a", sessionID: "ses_w" })
  })

  test("a worker with a known parent puts the parent's chat under it", () => {
    const worker = stackForWorker("/a/worktree", keys(), "ses_w", { directory: "/a", sessionID: "ses_p" })
    expect(names(worker)).toEqual(["servers", "projects", "sessions", "chat", "worker"])
    expect(worker[2]?.screen).toEqual({ kind: "sessions", directory: "/a" })
    expect(worker[3]?.screen).toEqual({ kind: "chat", directory: "/a", sessionID: "ses_p" })
    expect(top(worker)).toEqual({ kind: "worker", directory: "/a/worktree", sessionID: "ses_w" })
  })
})
