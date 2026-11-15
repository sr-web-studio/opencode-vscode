import { describe, expect, mock, test } from "bun:test"
import type { FolderSessions, FolderSession } from "@occ/core/protocol"
import { applyFolderSessions, sameFolderSessions } from "@occ/core/state-post"

/**
 * The sessions pane's per-folder lists. A busy background folder used to make every folder's list travel again; now only
 * the folders whose summary changed are posted, and the webview merges them into the list it holds.
 */

const vscodeMock = {
  window: { state: { focused: true } },
  workspace: { workspaceFolders: [] },
  commands: { executeCommand: async () => undefined },
  Uri: { joinPath: (...parts: any[]) => ({ path: parts.map((part) => part?.path ?? part).join("/") }), file: (path: string) => ({ path }) },
  EventEmitter: class {
    event = () => ({ dispose() {} })
    fire() {}
    dispose() {}
  },
  Disposable: class {
    dispose() {}
  },
}
mock.module("vscode", () => vscodeMock)

const { ChatViewProvider } = await import("../../apps/vscode/src/extension/view")

const row = (id: string, updated = 1): FolderSession => ({ id, title: `Session ${id}`, time: { created: 1, updated } })

/** A folder summary the way `controller.folderSessions()` builds one: fresh id lists on every call. */
function summary(directory: string, sessions: FolderSession[], running: string[] = []): FolderSessions {
  return { directory, sessions, running: [...running], waiting: [], workerRunning: {}, loaded: true }
}

/** A controller stub: only what the provider reads. */
function controller(folderPath: string, read: () => FolderSessions) {
  return {
    folderPath,
    directory: folderPath,
    currentSessionID: undefined,
    subscribe: () => () => {},
    setVisible: () => {},
    folderSessions: read,
    snapshot: () => ({ view: { turns: [], queued: [], loaded: true } }),
    dispatch: async () => {},
  }
}

/** A registry stub: the provider only asks for the folder list and each folder's controller. */
function registry(folders: Array<{ directory: string; controller: ReturnType<typeof controller> }>) {
  const active = folders[0]!.controller
  return {
    folders,
    get active() {
      return active
    },
    foldersState: () => folders.map((folder, index) => ({ directory: folder.directory, name: folder.directory, displayPath: folder.directory, active: index === 0 })),
    controllerAt: (directory: string) => folders.find((folder) => folder.directory === directory)?.controller,
    directories: () => folders.map((folder) => folder.directory),
    controllers: () => folders.map((folder) => folder.controller),
    onActive: () => () => {},
    onChange: () => () => {},
    onProjectNames: () => () => {},
    projectName: () => undefined,
  }
}

/** The provider with a visible webview that records every message it is given. */
function harness(folders: Array<{ directory: string; controller: ReturnType<typeof controller> }>) {
  const messages: Array<{ type: string; folders: FolderSessions[]; partial?: boolean }> = []
  const provider = new ChatViewProvider({ path: "/ext" } as never, registry(folders) as never, {} as never, { noteVisible() {} } as never)
  const view = {
    visible: true,
    webview: { options: {}, cspSource: "vscode-resource:", postMessage: (message: never) => (messages.push(message), Promise.resolve(true)) },
  }
  ;(provider as unknown as { view: unknown }).view = view
  return {
    provider,
    messages,
    view,
    post: () => (provider as unknown as { postFolderSessions(): void }).postFolderSessions(),
    /** What the webview store holds after applying every message in order. */
    store: () => messages.reduce<FolderSessions[]>((held, message) => applyFolderSessions(held, message.folders, message.partial === true), []),
  }
}

describe("only the folders whose list changed are posted", () => {
  test("a first refresh is full, an unchanged one posts nothing, a changed one carries only that folder", () => {
    const lists = new Map<string, FolderSession[]>([
      ["/a", [row("a1")]],
      ["/b", [row("b1")]],
      ["/c", [row("c1")]],
    ])
    const { post, messages, store } = harness(
      [...lists.keys()].map((directory) => ({ directory, controller: controller(directory, () => summary(directory, lists.get(directory)!, [directory === "/b" ? "b1" : ""].filter(Boolean))) })),
    )

    post()
    expect(messages).toHaveLength(1)
    expect(messages[0]!.partial).toBeUndefined()
    expect(messages[0]!.folders.map((folder) => folder.directory)).toEqual(["/a", "/b", "/c"])

    // The controllers rebuild their id lists on every call; equal content must not count as a change.
    post()
    expect(messages).toHaveLength(1)

    lists.set("/b", [row("b1", 99), row("b2")])
    post()
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ partial: true, folders: [{ directory: "/b" }] })
    expect(store().map((folder) => folder.directory)).toEqual(["/a", "/b", "/c"])
    expect(store()[1]!.sessions.map((session) => session.id)).toEqual(["b1", "b2"])
  })

  test("an untouched folder keeps the object the webview already had", () => {
    const lists = new Map<string, FolderSession[]>([
      ["/a", [row("a1")]],
      ["/b", [row("b1")]],
    ])
    const { post, store } = harness([...lists.keys()].map((directory) => ({ directory, controller: controller(directory, () => summary(directory, lists.get(directory)!)) })))
    post()
    const before = store()
    lists.set("/b", [row("b1", 2)])
    post()
    const after = store()
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
  })

  test("a hidden view is reset: the next post is full again", () => {
    const lists = new Map<string, FolderSession[]>([
      ["/a", [row("a1")]],
      ["/b", [row("b1")]],
    ])
    const { post, messages, view } = harness([...lists.keys()].map((directory) => ({ directory, controller: controller(directory, () => summary(directory, lists.get(directory)!)) })))
    post()
    expect(messages).toHaveLength(1)
    view.visible = false
    post()
    expect(messages).toHaveLength(1)
    view.visible = true
    post()
    expect(messages).toHaveLength(2)
    expect(messages[1]!.partial).toBeUndefined()
    expect(messages[1]!.folders).toHaveLength(2)
  })

  test("a folder that left is posted as a full list, so the webview drops it", () => {
    const folders = [
      { directory: "/a", controller: controller("/a", () => summary("/a", [row("a1")])) },
      { directory: "/b", controller: controller("/b", () => summary("/b", [row("b1")])) },
      { directory: "/c", controller: controller("/c", () => summary("/c", [row("c1")])) },
    ]
    const { post, messages, store } = harness(folders)
    post()
    expect(store()).toHaveLength(3)
    folders.pop()
    post()
    expect(messages[1]!.partial).toBeUndefined()
    expect(messages[1]!.folders.map((folder) => folder.directory)).toEqual(["/a", "/b"])
    expect(store().map((folder) => folder.directory)).toEqual(["/a", "/b"])
  })

  test("a folder that joined is posted as a full list, so the webview learns about it", () => {
    const folders = [
      { directory: "/a", controller: controller("/a", () => summary("/a", [row("a1")])) },
      { directory: "/b", controller: controller("/b", () => summary("/b", [row("b1")])) },
    ]
    const { post, messages, store } = harness(folders)
    post()
    folders.push({ directory: "/c", controller: controller("/c", () => summary("/c", [row("c1")])) })
    post()
    expect(messages[1]!.partial).toBeUndefined()
    expect(store().map((folder) => folder.directory)).toEqual(["/a", "/b", "/c"])
  })

  test("a single folder needs no list: the state already carries it", () => {
    const { post, messages } = harness([{ directory: "/a", controller: controller("/a", () => summary("/a", [row("a1")])) }])
    post()
    expect(messages).toHaveLength(0)
  })
})

describe("sameFolderSessions", () => {
  test("compares the rows by value and the small id lists by content", () => {
    const base = summary("/a", [row("a1")], ["a1"])
    expect(sameFolderSessions(base, summary("/a", [row("a1")], ["a1"]))).toBe(true)
    expect(sameFolderSessions(base, summary("/a", [row("a1", 2)], ["a1"]))).toBe(false)
    expect(sameFolderSessions(base, summary("/a", [row("a1")], []))).toBe(false)
    expect(sameFolderSessions(base, summary("/a", [row("a1")], ["a1", "a2"]))).toBe(false)
    expect(sameFolderSessions(base, { ...base, loaded: false })).toBe(false)
    expect(sameFolderSessions(base, { ...base, workerRunning: { a1: 1 } })).toBe(false)
  })
})

describe("applyFolderSessions", () => {
  test("a full post replaces the list", () => {
    const held = [summary("/a", [row("a1")]), summary("/b", [row("b1")])]
    const next = [summary("/c", [row("c1")])]
    expect(applyFolderSessions(held, next, false)).toBe(next)
  })

  test("a partial post swaps only the folders it names", () => {
    const a = summary("/a", [row("a1")])
    const b = summary("/b", [row("b1")])
    const changed = summary("/b", [row("b1", 5)])
    const next = applyFolderSessions([a, b], [changed], true)
    expect(next[0]).toBe(a)
    expect(next[1]).toBe(changed)
  })

  test("a partial post naming a folder the webview does not hold appends it", () => {
    const a = summary("/a", [row("a1")])
    const b = summary("/b", [row("b1")])
    expect(applyFolderSessions([a], [b], true)).toEqual([a, b])
    expect(applyFolderSessions([a], [], true)).toEqual([a])
  })
})
