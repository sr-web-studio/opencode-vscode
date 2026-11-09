import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { OpenCodeClient } from "@occ/core/api"
import { applyProjectUpdated, checkProjectName, MAX_PROJECT_NAME, normalizeProjectName, projectDisplayName, projectNameOf, type ProjectNameRecord } from "@occ/core/project-names"
import { ProjectNames } from "../../apps/vscode/src/extension/project-names"

const record = (id: string, name?: string, canonical = `/p/${id}`): ProjectNameRecord => ({ id, canonical, name })

const sink = () => {
  const names = new Map<string, string | undefined>()
  return { names, setProjectName: (directory: string, name: string | undefined) => void names.set(directory, name) }
}

/** The two calls `ProjectNames` makes, with a folder → project id map like `location.get` returns. */
function fakeClient(projects: ProjectNameRecord[], locations: Record<string, string | undefined>) {
  const calls = { list: 0, locations: [] as string[] }
  const client = {
    project: {
      list: async () => {
        calls.list++
        return projects
      },
    },
    location: {
      get: async ({ location }: { location: { directory: string } }) => {
        calls.locations.push(location.directory)
        const id = locations[location.directory]
        if (!id) throw new Error("LocationNotFound")
        return { directory: location.directory, project: { id, directory: location.directory, canonical: location.directory } }
      },
    },
  }
  return { client: client as unknown as OpenCodeClient, calls }
}

describe("project name helpers", () => {
  test("names are trimmed; an empty name means no name", () => {
    expect(normalizeProjectName("  My Project  ")).toBe("My Project")
    expect(normalizeProjectName("")).toBeUndefined()
    expect(normalizeProjectName("   ")).toBeUndefined()
    expect(normalizeProjectName(undefined)).toBeUndefined()
  })

  test("an empty input clears the name; a long one is rejected, not truncated", () => {
    expect(checkProjectName("")).toEqual({ ok: true, name: undefined })
    expect(checkProjectName("   ")).toEqual({ ok: true, name: undefined })
    expect(checkProjectName("  Renamed  ")).toEqual({ ok: true, name: "Renamed" })
    expect(checkProjectName("x".repeat(MAX_PROJECT_NAME))).toEqual({ ok: true, name: "x".repeat(MAX_PROJECT_NAME) })
    expect(checkProjectName("x".repeat(MAX_PROJECT_NAME + 1))).toMatchObject({ ok: false })
  })

  test("a name is looked up by project id, never by the canonical folder", () => {
    const projects = [record("other", "Other name", "/same/folder"), record("ours", "Our name", "/same/folder")]
    expect(projectNameOf("ours", projects)).toBe("Our name")
    expect(projectNameOf("missing", projects)).toBeUndefined()
    expect(projectNameOf(undefined, projects)).toBeUndefined()
  })

  test("a folder shows its project name, else its workspace name", () => {
    expect(projectDisplayName("OpenCode VS code Ext", "opencode-vscode")).toBe("OpenCode VS code Ext")
    expect(projectDisplayName(undefined, "opencode-vscode")).toBe("opencode-vscode")
    expect(projectDisplayName("   ", "opencode-vscode")).toBe("opencode-vscode")
  })

  test("project.updated sets or removes one id without touching the rest", () => {
    const before = new Map([
      ["a", "A"],
      ["b", "B"],
    ])
    const named = applyProjectUpdated(before, record("b", "Bee"))
    expect([...named]).toEqual([
      ["a", "A"],
      ["b", "Bee"],
    ])
    const cleared = applyProjectUpdated(named, record("b", "  "))
    expect([...cleared]).toEqual([["a", "A"]])
    expect([...before]).toEqual([
      ["a", "A"],
      ["b", "B"],
    ])
  })
})

describe("ProjectNames: the folders' names from the server", () => {
  test("the folder's project id decides which name is used when a canonical path has several records", async () => {
    const projects = [record("first", "First record", "/w/a"), record("second", "Second record", "/w/a")]
    const { client } = fakeClient(projects, { "/w/a": "second", "/w/b": "first" })
    const names = sink()
    await new ProjectNames(names).refresh(client, ["/w/a", "/w/b"])
    expect(names.names.get("/w/a")).toBe("Second record")
    expect(names.names.get("/w/b")).toBe("First record")
  })

  test("a folder without a name gets none; a missing location keeps nothing", async () => {
    const { client } = fakeClient([record("a")], { "/w/a": "a" })
    const names = sink()
    await new ProjectNames(names).refresh(client, ["/w/a", "/w/gone"])
    expect(names.names.get("/w/a")).toBeUndefined()
    expect(names.names.has("/w/gone")).toBe(true)
    expect(names.names.get("/w/gone")).toBeUndefined()
  })

  test("project.updated renames the folder that uses that project id, and an empty name clears it", async () => {
    const { client } = fakeClient([record("a", "Before")], { "/w/a": "a", "/w/b": "b" })
    const names = sink()
    const tracker = new ProjectNames(names)
    await tracker.refresh(client, ["/w/a", "/w/b"])
    tracker.apply({ type: "project.updated", data: record("a", "After") })
    expect(names.names.get("/w/a")).toBe("After")
    expect(names.names.get("/w/b")).toBeUndefined()
    tracker.apply({ type: "project.updated", data: record("a", "") })
    expect(names.names.get("/w/a")).toBeUndefined()
    // Another project's event changes nothing.
    tracker.apply({ type: "project.updated", data: record("b", "B name") })
    expect(names.names.get("/w/a")).toBeUndefined()
    expect(names.names.get("/w/b")).toBe("B name")
  })

  test("a folder added after the refresh is resolved on demand and cached", async () => {
    const { client, calls } = fakeClient([record("late", "Late name")], { "/w/late": "late" })
    const names = sink()
    const tracker = new ProjectNames(names)
    expect(await tracker.resolve(client, "/w/late")).toEqual({ projectID: "late", name: "Late name" })
    expect(names.names.get("/w/late")).toBe("Late name")
    expect(await tracker.resolve(client, "/w/late")).toEqual({ projectID: "late", name: "Late name" })
    expect(calls.locations).toEqual(["/w/late"])
  })

  test("a name this window saved is shown before the event arrives", () => {
    const names = sink()
    const tracker = new ProjectNames(names)
    tracker.set("/w/a", "a", "Typed name")
    expect(names.names.get("/w/a")).toBe("Typed name")
    tracker.set("/w/a", "a", undefined)
    expect(names.names.get("/w/a")).toBeUndefined()
  })

  test("a failing project.list keeps the names already shown", async () => {
    const lines: string[] = []
    const names = sink()
    const tracker = new ProjectNames(names, (line) => lines.push(line))
    const failing = { project: { list: async () => Promise.reject(new Error("offline")) } } as unknown as OpenCodeClient
    await tracker.refresh(failing, ["/w/a"])
    expect(lines.join("\n")).toContain("project.list failed")
    expect(names.names.has("/w/a")).toBe(false)
  })
})

describe("the rename command is wired into VS Code", () => {
  const pkg = JSON.parse(readFileSync("apps/vscode/package.json", "utf8")) as { contributes: { commands: Array<{ command: string; title?: string; category?: string }> } }

  test("the command is contributed with the palette title", () => {
    expect(pkg.contributes.commands.find((command) => command.command === "opencode.renameProject")).toMatchObject({ title: "Rename Project…", category: "OpenCode" })
  })

  test("the extension registers it for the chat view's active folder", () => {
    const src = readFileSync("apps/vscode/src/extension/extension.ts", "utf8")
    expect(src).toContain(`registerCommand("opencode.renameProject", () => renameProject())`)
    expect(src).toContain("projectNames.refresh(conn.client, folders.directories())")
  })

  test("the Settings page has a row for it, and its command set follows the rows", () => {
    const src = readFileSync("apps/vscode/src/extension/settings-page.ts", "utf8")
    expect(src).toContain(`command: "opencode.renameProject"`)
    expect(src).toContain("...ACTIONS.map((action) => action.command)")
  })
})
