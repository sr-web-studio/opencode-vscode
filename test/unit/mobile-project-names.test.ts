import { describe, expect, test } from "bun:test"
import { LOCATE_CONCURRENCY, ProjectNames } from "../../apps/mobile/src/lib/project-names"

type Seen = { directory: string; projectID: string | undefined; name: string | undefined }

/** A fake server: `location.get` by folder, with a few milliseconds so overlapping calls can be counted. */
function fake(locations: Record<string, string | Error>) {
  const calls: string[] = []
  let active = 0
  let maxActive = 0
  const client = {
    location: {
      get: async ({ location }: { location: { directory: string } }) => {
        calls.push(location.directory)
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active--
        const found = locations[location.directory]
        if (found instanceof Error) throw found
        if (!found) throw new Error(`Location not found: ${location.directory}`)
        return { project: { id: found } }
      },
    },
  }
  return { client: client as never, calls, maxActive: () => maxActive }
}

function sink() {
  const seen: Seen[] = []
  return { seen, setProject: (directory: string, projectID: string | undefined, name: string | undefined) => seen.push({ directory, projectID, name }) }
}

describe("the phone's project names", () => {
  test("resolveAll asks each folder once, a few at a time, and reports every answer", async () => {
    const dirs = Array.from({ length: 12 }, (_, i) => `/p/${i}`)
    const f = fake(Object.fromEntries(dirs.map((d, i) => [d, `id-${i}`])))
    const out = sink()
    const names = new ProjectNames(out)
    await names.resolveAll(f.client, dirs)
    expect(out.seen).toHaveLength(dirs.length)
    expect(out.seen.map((s) => s.directory).sort()).toEqual([...dirs].sort())
    expect(f.maxActive()).toBeLessThanOrEqual(LOCATE_CONCURRENCY)
    expect(f.calls).toHaveLength(dirs.length)
    // The cache answers the next screen without another request.
    await names.resolveAll(f.client, dirs)
    expect(f.calls).toHaveLength(dirs.length)
    expect(names.idOf("/p/3")).toBe("id-3")
  })

  test("two screens resolving the same folder share one request", async () => {
    const f = fake({ "/p/a": "id-a" })
    const names = new ProjectNames(sink())
    const [a, b] = await Promise.all([names.resolve(f.client, "/p/a"), names.resolve(f.client, "/p/a")])
    expect(a).toBe("id-a")
    expect(b).toBe("id-a")
    expect(f.calls).toEqual(["/p/a"])
  })

  test("a folder location.get cannot resolve keeps the list's fallback (no sink call, nothing cleared)", async () => {
    const f = fake({ "/p/gone": new Error("Location not found: /p/gone") })
    const out = sink()
    const names = new ProjectNames(out)
    expect(await names.resolve(f.client, "/p/gone")).toBeUndefined()
    expect(out.seen).toEqual([])
    expect(names.idOf("/p/gone")).toBeUndefined()
  })

  test("the list supplies names by id; a resolved folder is told its name", async () => {
    const f = fake({ "/p/a": "id-a" })
    const out = sink()
    const names = new ProjectNames(out)
    names.applyList([{ id: "id-a", canonical: "/p/a", name: "  The Project  " }])
    await names.resolve(f.client, "/p/a")
    expect(out.seen.at(-1)).toEqual({ directory: "/p/a", projectID: "id-a", name: "The Project" })
    expect(names.nameOf("/p/a")).toBe("The Project")
  })

  test("project.updated reaches every folder that uses the project, and an empty name clears it", () => {
    const out = sink()
    const names = new ProjectNames(out)
    names.set("/p/a", "id-a", "Old")
    names.set("/p/b", "id-b", "Other")
    names.apply({ type: "project.updated", data: { id: "id-a", name: "New name" } })
    expect(out.seen.at(-1)).toEqual({ directory: "/p/a", projectID: "id-a", name: "New name" })
    expect(names.nameOf("/p/b")).toBe("Other")
    names.apply({ type: "project.updated", data: { id: "id-a", name: "   " } })
    expect(out.seen.at(-1)).toEqual({ directory: "/p/a", projectID: "id-a", name: undefined })
    expect(names.nameOf("/p/a")).toBeUndefined()
  })

  test("a list reload carries a rename for a folder already resolved", () => {
    const out = sink()
    const names = new ProjectNames(out)
    names.applyList([{ id: "id-a", canonical: "/p/a", name: "Before" }])
    names.set("/p/a", "id-a", "Before")
    names.applyList([{ id: "id-a", canonical: "/p/a", name: "After" }])
    expect(out.seen.at(-1)).toEqual({ directory: "/p/a", projectID: "id-a", name: "After" })
  })

  test("ignores events that are not a project update and projects without an id", () => {
    const out = sink()
    const names = new ProjectNames(out)
    names.apply({ type: "session.updated", data: { id: "id-a", name: "X" } })
    names.apply({ type: "project.updated", data: { name: "X" } })
    names.apply({ type: "project.updated", data: undefined })
    expect(out.seen).toEqual([])
  })
})
