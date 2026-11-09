import { describe, expect, test } from "bun:test"
import { Controller } from "@occ/core/controller"
import { FolderRegistry, folderStorageKey, type FolderController, type FolderEntry } from "@occ/core/folders"
import { NotificationEngine } from "@occ/core/notifications/engine"
import { defaultNotificationSettings, type Notice, type Notifier } from "@occ/core/notifications/types"
import type { Action, AppState, ConnectionState, ViewSettings } from "@occ/core/protocol"

type Entry = FolderEntry & { primary: boolean }

class FakeController implements FolderController {
  readonly directory: string
  readonly folderPath: string
  readonly primary: boolean
  folderName: string
  displayPath: string
  attached = 0
  detached = 0
  connections: ConnectionState[] = []
  settings: ViewSettings[] = []
  voices: AppState["voice"][] = []
  sessions = new Set<string>()
  opened: string[] = []
  actions: Action[] = []
  running: string[] = []
  waiting: string[] = []
  currentSessionID: string | undefined
  private connection: ConnectionState = { status: "connecting" }

  constructor(entry: Entry) {
    this.directory = entry.directory
    this.folderPath = entry.directory
    this.folderName = entry.folderName
    this.displayPath = entry.displayPath
    this.primary = entry.primary
  }

  attach(): void {
    this.attached++
  }
  detach(): void {
    this.detached++
  }
  setConnection(connection: ConnectionState): void {
    this.connection = connection
    this.connections.push(connection)
  }
  setSettings(settings: ViewSettings): void {
    this.settings.push(settings)
  }
  setVoice(voice: AppState["voice"]): void {
    this.voices.push(voice)
  }
  setFolderInfo(folderName: string, displayPath: string): void {
    this.folderName = folderName
    this.displayPath = displayPath
  }
  snapshot(): AppState {
    return { connection: this.connection, running: this.running, waiting: this.waiting } as unknown as AppState
  }
  listsSession(id: string): boolean {
    return this.sessions.has(id)
  }
  isBusy(): boolean {
    return this.running.some((id) => this.listsSession(id))
  }
  isWaiting(): boolean {
    return this.waiting.some((id) => this.listsSession(id))
  }
  async open(id: string): Promise<void> {
    this.opened.push(id)
  }
  async dispatch(action: Action): Promise<void> {
    this.actions.push(action)
  }
}

const entry = (directory: string): FolderEntry => ({ directory, folderName: directory.split("/").pop() || directory, displayPath: directory })

function registry(remembered?: string) {
  const made: FakeController[] = []
  const saved: string[] = []
  const folders = new FolderRegistry<FakeController>({
    make: (e) => {
      const controller = new FakeController(e)
      made.push(controller)
      return controller
    },
    remember: { get: () => remembered, set: (directory) => saved.push(directory) },
  })
  return { folders, made, saved }
}

describe("folder registry: one controller per workspace folder", () => {
  test("sync creates one controller per folder, the first one primary, and picks the first active", () => {
    const { folders, made, saved } = registry()
    folders.sync([entry("/a"), entry("/b")])
    expect(made.map((c) => [c.directory, c.primary])).toEqual([
      ["/a", true],
      ["/b", false],
    ])
    expect(folders.directories()).toEqual(["/a", "/b"])
    expect(folders.active.directory).toBe("/a")
    expect(saved).toEqual(["/a"])
  })

  test("the remembered folder wins when it is still open", () => {
    const { folders } = registry("/b")
    folders.sync([entry("/a"), entry("/b")])
    expect(folders.active.directory).toBe("/b")
    expect(folders.foldersState().map((f) => [f.directory, f.active])).toEqual([
      ["/a", false],
      ["/b", true],
    ])
  })

  test("adding a folder keeps the existing controller; removing one detaches only that one", () => {
    const { folders, made } = registry()
    folders.sync([entry("/a")])
    const a = folders.active
    folders.sync([entry("/a"), entry("/b")])
    expect(folders.controllers().find((c) => c.directory === "/a")).toBe(a)
    expect(made).toHaveLength(2)
    const b = folders.controllers().find((c) => c.directory === "/b")!
    folders.sync([entry("/a")])
    expect(b.detached).toBe(1)
    expect(a.detached).toBe(0)
    expect(folders.directories()).toEqual(["/a"])
  })

  test("removing the active folder switches to the first remaining one", () => {
    const { folders, saved } = registry()
    folders.sync([entry("/a"), entry("/b"), entry("/c")])
    expect(folders.setActive("/c")).toBe(true)
    expect(folders.active.directory).toBe("/c")
    folders.sync([entry("/a"), entry("/b")])
    expect(folders.active.directory).toBe("/a")
    expect(saved.at(-1)).toBe("/a")
  })

  test("no workspace folder keeps a placeholder controller for the setup screen", () => {
    const { folders, made } = registry()
    folders.sync([])
    expect(made).toHaveLength(1)
    expect(folders.active.directory).toBe("")
    expect(folders.directories()).toEqual([])
    expect(folders.foldersState()).toEqual([])
    const placeholder = folders.active
    folders.sync([entry("/a")])
    expect(placeholder.detached).toBe(1)
    expect(folders.active.directory).toBe("/a")
  })

  test("setActive ignores an unknown folder and tells the view once", () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    let changed = 0
    const off = folders.onActive(() => changed++)
    expect(folders.setActive("/nope")).toBe(false)
    expect(folders.setActive("/b")).toBe(true)
    expect(folders.setActive("/b")).toBe(false)
    expect(changed).toBe(1)
    off()
    folders.setActive("/a")
    expect(changed).toBe(1)
  })
})

describe("folder registry: one server connection for every folder", () => {
  test("attach and detach reach every controller, including folders added later", () => {
    const { folders, made } = registry()
    folders.sync([entry("/a")])
    const client = { name: "client" } as never
    folders.attach(client)
    expect(made[0]!.attached).toBe(1)
    expect(folders.connectedClient).toBe(client)
    folders.sync([entry("/a"), entry("/b")])
    expect(made[1]!.attached).toBe(1)
    folders.detach()
    expect(made.map((c) => c.detached)).toEqual([1, 1])
    expect(folders.connectedClient).toBeUndefined()
  })

  test("connection, settings and voice are window state: new folders get the current values", () => {
    const { folders, made } = registry()
    folders.sync([entry("/a")])
    const connection: ConnectionState = { status: "connected", version: "2.2.5" }
    const settings = { fontSize: 15 } as ViewSettings
    const voice = { engine: "local", ready: true, capture: false, recording: "off", languages: ["en"] } as AppState["voice"]
    folders.setConnection(connection)
    folders.setSettings(settings)
    folders.setVoice(voice)
    folders.sync([entry("/a"), entry("/b")])
    expect(made[1]!.connections).toEqual([connection])
    expect(made[1]!.settings).toEqual([settings])
    expect(made[1]!.voices).toEqual([voice])
  })

  test("foldersState carries the active flag and each folder's running/waiting sessions", () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    const a = folders.controllers()[0]!
    const b = folders.controllers()[1]!
    a.sessions.add("ses_a")
    a.running = ["ses_a"]
    b.sessions.add("ses_b")
    b.waiting = ["ses_b"]
    expect(folders.foldersState().map((f) => ({ directory: f.directory, name: f.name, active: f.active, busy: f.busy, attention: f.attention }))).toEqual([
      { directory: "/a", name: "a", active: true, busy: true, attention: false },
      { directory: "/b", name: "b", active: false, busy: false, attention: true },
    ])
  })

  test("a running or waiting session the folder does not list does not light its dot", () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    const a = folders.controllers()[0]!
    a.running = ["ses_elsewhere"]
    a.waiting = ["ses_elsewhere"]
    expect(folders.foldersState()[0]).toMatchObject({ busy: false, attention: false })
  })

  test("a project name from OpenCode shows in the folder list and falls back to the folder name", () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    expect(folders.projectName("/a")).toBeUndefined()
    expect(folders.foldersState().map((f) => f.projectName)).toEqual([undefined, undefined])
    let changes = 0
    let folderChanges = 0
    const off = folders.onProjectNames(() => changes++)
    const offFolders = folders.onChange(() => folderChanges++)
    folders.setProjectName("/a", "  My Project  ")
    expect(folders.projectName("/a")).toBe("My Project")
    expect(folders.foldersState().map((f) => f.projectName)).toEqual(["My Project", undefined])
    expect(changes).toBe(1)
    expect(folderChanges).toBe(0)
    // The same name again is not a change; an empty one clears it back to the folder name.
    folders.setProjectName("/a", "My Project")
    expect(changes).toBe(1)
    folders.setProjectName("/a", "   ")
    expect(folders.projectName("/a")).toBeUndefined()
    expect(changes).toBe(2)
    folders.setProjectName("/nope", "Ignored")
    expect(changes).toBe(2)
    off()
    offFolders()
  })

  test("removing a folder drops its project name; re-adding it starts without one", () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    folders.setProjectName("/a", "Named")
    folders.sync([entry("/b")])
    expect(folders.projectName("/a")).toBeUndefined()
    folders.sync([entry("/a"), entry("/b")])
    expect(folders.foldersState().find((f) => f.directory === "/a")?.projectName).toBeUndefined()
  })
})

describe("folder registry: a session belongs to its own folder", () => {
  test("forSession finds the folder that lists the session, not the folder on screen", () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    const b = folders.controllers()[1]!
    b.sessions.add("ses_b")
    expect(folders.active.directory).toBe("/a")
    expect(folders.forSession("ses_b")).toBe(b)
    expect(folders.activateForSession("ses_b")).toBe(b)
    expect(folders.active.directory).toBe("/b")
  })

  test("an unknown session falls back to the active folder", () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    folders.setActive("/b")
    expect(folders.forSession("ses_ghost").directory).toBe("/b")
  })

  test("open and dispatch on the owner act on that controller only", async () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    const b = folders.controllers()[1]!
    b.sessions.add("ses_b")
    const owner = folders.activateForSession("ses_b")
    await owner.open("ses_b")
    await owner.dispatch({ type: "newDraft", hasText: false })
    expect(b.opened).toEqual(["ses_b"])
    expect(b.actions).toEqual([{ type: "newDraft", hasText: false }])
    expect(folders.controllers()[0]!.opened).toEqual([])
  })

  test("a notice's folder wins for a worker session its folder has not listed yet", () => {
    const { folders } = registry()
    folders.sync([entry("/a"), entry("/b")])
    const b = folders.controllers()[1]!
    expect(folders.controllerAt("/b")).toBe(b)
    expect(folders.controllerAt("/nope")).toBeUndefined()
    expect(folders.activateForSession("ses_worker", "/b")).toBe(b)
    expect(folders.active.directory).toBe("/b")
  })
})

describe("folder storage keys", () => {
  test("the first/only folder keeps the old keys, other folders get their own namespace", () => {
    expect(folderStorageKey("lastSession", "/a", true)).toBe("lastSession")
    expect(folderStorageKey("lastSession", "/b", false)).toBe("lastSession:/b")
    expect(folderStorageKey("lastSession", "", true)).toBe("lastSession")
    expect(folderStorageKey("lastSession", "/a", false)).not.toBe(folderStorageKey("lastSession", "/b", false))
  })
})

describe("folder registry: change notifications and disposal", () => {
  test("onChange fires when a folder is added, removed or renamed, but not on a plain switch", () => {
    const { folders } = registry()
    folders.sync([entry("/a")])
    let changes = 0
    const off = folders.onChange(() => changes++)
    folders.sync([entry("/a"), entry("/b")])
    expect(changes).toBe(1)
    folders.sync([entry("/a"), { directory: "/b", folderName: "renamed", displayPath: "/b" }])
    expect(changes).toBe(2)
    folders.sync([entry("/a")])
    expect(changes).toBe(3)
    folders.setActive("/a")
    expect(changes).toBe(3)
    off()
    folders.sync([entry("/a"), entry("/c")])
    expect(changes).toBe(3)
  })

  test("renaming a folder in place updates its controller's labels", () => {
    const { folders } = registry()
    folders.sync([entry("/a")])
    const a = folders.active
    folders.sync([{ directory: "/a", folderName: "renamed", displayPath: "~/renamed" }])
    expect(folders.active).toBe(a)
    expect(a.folderName).toBe("renamed")
    expect(a.displayPath).toBe("~/renamed")
    expect(folders.foldersState()[0]).toMatchObject({ name: "renamed", displayPath: "~/renamed" })
  })

  test("re-adding a removed folder makes a fresh controller, attached when the window is connected", () => {
    const { folders, made } = registry()
    folders.sync([entry("/a"), entry("/b")])
    folders.attach({} as never)
    folders.sync([entry("/a")])
    expect(made).toHaveLength(2)
    folders.sync([entry("/a"), entry("/b")])
    expect(made).toHaveLength(3)
    expect(made[2]!.attached).toBe(1)
  })

  test("dispose detaches every controller and clears the listeners", () => {
    const { folders, made } = registry()
    folders.sync([entry("/a"), entry("/b")])
    let active = 0
    let changes = 0
    folders.onActive(() => active++)
    folders.onChange(() => changes++)
    folders.dispose()
    expect(made.map((c) => c.detached)).toEqual([1, 1])
    expect(folders.directories()).toEqual([])
    expect(folders.controllers()).toEqual([])
    expect(() => folders.active).toThrow()
    expect(active).toBe(0)
    expect(changes).toBe(0)
  })
})

describe("folder registry: paths as the workspace and the server spell them", () => {
  test("controllerAt and setActive match a Windows path with another drive-letter case", () => {
    const { folders } = registry()
    folders.sync([entry("d:\\Work\\app"), entry("/other")])
    const first = folders.controllers()[0]!
    expect(folders.controllerAt("D:/Work/app")).toBe(first)
    expect(folders.controllerAt("D:\\Work\\app\\")).toBe(first)
    folders.setActive("/other")
    expect(folders.setActive("D:\\Work\\APP")).toBe(true)
    expect(folders.active).toBe(first)
  })

  test("a notice directory with a different spelling finds its folder", () => {
    const { folders } = registry()
    folders.sync([entry("d:\\Work\\app"), entry("/other")])
    const first = folders.controllers()[0]!
    expect(folders.activateForSession("ses_worker", "D:/Work/app")).toBe(first)
    expect(folders.active).toBe(first)
  })

  test("nested roots resolve to the deepest folder", () => {
    const { folders } = registry()
    folders.sync([entry("/repo"), entry("/repo/packages/app")])
    const root = folders.controllers()[0]!
    const app = folders.controllers()[1]!
    root.sessions.add("ses_shared")
    app.sessions.add("ses_shared")
    expect(folders.forSession("ses_shared")).toBe(app)
    expect(folders.controllerAt("/repo/")).toBe(root)
    expect(folders.controllerAt("/repo/packages/app")).toBe(app)
  })
})

describe("controller busy and attention use only its own sessions", () => {
  const make = () => new Controller({ directory: "/a", folderName: "a", displayPath: "/a" })
  const lists = (ctl: Controller, ...ids: string[]) => {
    ;(ctl as unknown as { sessions: Array<{ id: string }> }).sessions = ids.map((id) => ({ id }))
  }

  test("a running session this folder does not list is not busy", () => {
    const ctl = make()
    ;(ctl as unknown as { running: Set<string> }).running = new Set(["ses_b"])
    expect(ctl.isBusy()).toBe(false)
    lists(ctl, "ses_b")
    expect(ctl.isBusy()).toBe(true)
  })

  test("a permission for a session this folder does not list is not attention", () => {
    const ctl = make()
    ;(ctl as unknown as { permissions: Map<string, unknown[]> }).permissions.set("ses_b", [{}])
    expect(ctl.isWaiting()).toBe(false)
    lists(ctl, "ses_b")
    expect(ctl.isWaiting()).toBe(true)
  })
})

class Recorder implements Notifier {
  shown: Notice[] = []
  show(notice: Notice): void {
    this.shown.push(notice)
  }
  dismiss(): void {}
}

describe("notifications across workspace folders", () => {
  const settings = { ...defaultNotificationSettings }
  const meta: Record<string, { title: string; directory: string }> = {
    ses_a: { title: "A", directory: "/a" },
    ses_b: { title: "B", directory: "/b" },
    ses_c: { title: "C", directory: "/c" },
  }
  const done = (sessionID: string, directory: string) => ({ type: "session.execution.succeeded", location: { directory }, data: { sessionID } })

  test("a session of the second folder notifies too", async () => {
    const rec = new Recorder()
    const engine = new NotificationEngine({
      directory: "/a",
      directories: () => ["/a", "/b"],
      settings: () => settings,
      ui: () => ({ windowFocused: false }),
      notifier: rec,
      session: (id) => meta[id],
      shellSession: () => undefined,
    })
    await engine.handle(done("ses_b", "/b"))
    expect(rec.shown.map((n) => n.sessionID)).toEqual(["ses_b"])
  })

  test("a folder outside the window still does not notify", async () => {
    const rec = new Recorder()
    const engine = new NotificationEngine({
      directory: "/a",
      directories: () => ["/a", "/b"],
      settings: () => settings,
      ui: () => ({ windowFocused: false }),
      notifier: rec,
      session: (id) => meta[id],
      shellSession: () => undefined,
    })
    await engine.handle(done("ses_c", "/c"))
    expect(rec.shown).toEqual([])
  })

  test("owns still covers a listed session whose folder is spelled differently", async () => {
    const rec = new Recorder()
    const engine = new NotificationEngine({
      directory: "/a",
      directories: () => [],
      settings: () => settings,
      ui: () => ({ windowFocused: false }),
      notifier: rec,
      session: (id) => meta[id],
      shellSession: () => undefined,
      owns: (id) => id === "ses_b",
    })
    await engine.handle(done("ses_b", "/other-spelling"))
    expect(rec.shown.map((n) => n.sessionID)).toEqual(["ses_b"])
  })

  test("resolveAction carries the notice's folder so the host opens it in the right folder", async () => {
    const rec = new Recorder()
    const engine = new NotificationEngine({
      directory: "/a",
      directories: () => ["/a", "/b"],
      settings: () => settings,
      ui: () => ({ windowFocused: false }),
      notifier: rec,
      session: (id) => meta[id],
      shellSession: () => undefined,
    })
    await engine.handle(done("ses_b", "/b"))
    const notice = rec.shown[0]!
    expect(engine.resolveAction(notice, "open")).toEqual({ type: "open", sessionID: "ses_b", directory: "/b" })
  })
})
