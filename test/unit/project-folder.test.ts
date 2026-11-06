import { describe, expect, test } from "bun:test"
import { sameDirectory } from "../../src/core/paths"
import { Controller } from "../../src/core/controller"
import type { AppState } from "../../src/core/protocol"

describe("sameDirectory", () => {
  test("Windows: drive letter and folder case, separators and trailing slashes", () => {
    expect(sameDirectory("d:\\Work\\uniloop\\uniloop-platform", "D:\\Work\\uniloop\\uniloop-platform")).toBe(true)
    expect(sameDirectory("d:\\work\\Uniloop\\uniloop-platform\\", "D:/Work/uniloop/uniloop-platform")).toBe(true)
    expect(sameDirectory("\\\\server\\share\\proj", "\\\\SERVER\\share\\proj")).toBe(true)
  })
  test("different folders never match", () => {
    expect(sameDirectory("D:\\Work\\a", "D:\\Work\\ab")).toBe(false)
    expect(sameDirectory("D:\\Work\\a", "D:\\Work\\a\\sub")).toBe(false)
    expect(sameDirectory("/home/me/a", "/home/me/b")).toBe(false)
  })
  test("POSIX paths stay case-sensitive; only trailing slashes are ignored", () => {
    expect(sameDirectory("/home/me/Proj", "/home/me/proj")).toBe(false)
    expect(sameDirectory("/home/me/proj/", "/home/me/proj")).toBe(true)
    expect(sameDirectory("/", "/")).toBe(true)
  })
  test("empty or missing never matches", () => {
    expect(sameDirectory(undefined, "/a")).toBe(false)
    expect(sameDirectory("", "")).toBe(false)
  })
})

/** A server on Windows that stores `D:\…` while VS Code reports `d:\…`, and filters `session.list` on the exact path. */
function windowsServer(opts: { locationGet: boolean }) {
  const STORED = "D:\\Work\\uniloop\\uniloop-platform"
  const session = (id: string, directory: string, updated: number) => ({
    id, title: id, projectID: "prj", time: { created: updated, updated }, location: { directory },
  })
  const all = [session("ses_a", STORED, 3), session("ses_b", STORED, 2), session("ses_other", "D:\\Other", 1)]
  const calls: Record<string, unknown>[] = []
  const unsupported = () => Promise.reject(new Error("404 not found"))
  const empty = { data: [] }
  const client = {
    location: {
      get: opts.locationGet
        ? async (input: { location: { directory: string } }) => {
            if (input.location.directory.toLowerCase() !== STORED.toLowerCase()) throw new Error("Location not found")
            return { directory: STORED, project: { id: "prj", directory: STORED, canonical: STORED } }
          }
        : unsupported,
    },
    session: {
      list: async (input: Record<string, unknown>) => {
        calls.push(input)
        const roots = all.filter((s) => input.parentID === null || input.parentID === undefined)
        if (input.archived) return { data: [] }
        if (typeof input.project === "string") return { data: roots.filter((s) => s.projectID === input.project) }
        if (typeof input.directory === "string") return { data: roots.filter((s) => s.location.directory === input.directory) }
        return { data: roots }
      },
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) => all.find((s) => s.id === sessionID),
    },
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
  return { client, calls, STORED }
}

const sessionsOf = async (locationGet: boolean) => {
  const server = windowsServer({ locationGet })
  const lines: string[] = []
  const ctl = new Controller({ directory: "d:\\Work\\uniloop\\uniloop-platform", folderName: "uniloop-platform", displayPath: "d:\\Work\\uniloop\\uniloop-platform", log: (l) => lines.push(l) })
  ;(ctl as unknown as { client: unknown }).client = server.client
  await ctl.sync()
  const state: AppState = ctl.snapshot()
  return { ids: state.sessions.map((s) => s.id), server, lines, ctl }
}

describe("sessions of a Windows folder whose drive letter case differs from the server's", () => {
  test("location.get gives the server's spelling; sessions are listed under it", async () => {
    const { ids, server, lines } = await sessionsOf(true)
    expect(ids).toEqual(["ses_a", "ses_b"])
    expect(server.calls[0]).toMatchObject({ directory: server.STORED, parentID: null })
    expect(lines.some((l) => l.includes("server location D:\\Work\\uniloop\\uniloop-platform"))).toBe(true)
  })
  test("new sessions are created under the server's spelling", async () => {
    const { ctl, server } = await sessionsOf(true)
    expect(ctl.directory).toBe(server.STORED)
  })
  test("an older server without location.get: the newest sessions of all folders are filtered by a loose match", async () => {
    const { ids, server } = await sessionsOf(false)
    expect(ids).toEqual(["ses_a", "ses_b"])
    const roots = server.calls.filter((c) => c.parentID === null)
    expect(roots.map((c) => ("directory" in c ? "directory" : "all"))).toEqual(["directory", "all"])
  })
  test("workers are listed by parent id only", async () => {
    const { server } = await sessionsOf(true)
    expect(server.calls.find((c) => c.parentID === "ses_a")).toEqual({ parentID: "ses_a", limit: 200 })
  })
})
