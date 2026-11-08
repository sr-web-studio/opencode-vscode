import { describe, expect, test } from "bun:test"
import { guessHome, projectRows, type ProjectLike } from "../../apps/mobile/src/lib/projects"

const p = (id: string, canonical: string, updated: number, active = updated, name?: string): ProjectLike => ({ id, canonical, name, time: { created: 1, updated, active } })

describe("project list rows", () => {
  test("one row per folder: records with the same folder are merged (the live server has several)", () => {
    const rows = projectRows([p("a", "/tmp/opencode/occ-test", 10), p("b", "/tmp/opencode/occ-test", 30), p("c", "/home/me/app", 20)])
    expect(rows.map((r) => r.directory)).toEqual(["/tmp/opencode/occ-test", "/home/me/app"])
    expect(rows[0]).toMatchObject({ ids: ["a", "b"], last: 30, title: "occ-test" })
  })
  test("newest activity first; `active` counts as activity; ties fall back to the path", () => {
    const rows = projectRows([p("a", "/z", 5, 100), p("b", "/y", 50, 50), p("c", "/x", 50, 50)])
    expect(rows.map((r) => r.directory)).toEqual(["/z", "/x", "/y"])
  })
  test("title: the project's own name wins over the folder name, from any record of the folder", () => {
    const rows = projectRows([p("a", "/home/me/work/online", 1), p("b", "/home/me/work/online", 2, 2, "Online Presence"), p("c", "/home/me/x", 3)])
    expect(rows.find((r) => r.directory === "/home/me/work/online")?.title).toBe("Online Presence")
    expect(rows.find((r) => r.directory === "/home/me/x")?.title).toBe("x")
  })
  test("the path is shown with ~ for the home folder seen in the list; trailing slashes do not split a folder", () => {
    const rows = projectRows([p("a", "/home/salim/work/app/", 1), p("b", "/home/salim/work/app", 2), p("c", "/tmp", 3)])
    expect(rows.map((r) => r.path)).toEqual(["/tmp", "~/work/app"])
    expect(rows[1]?.ids).toEqual(["a", "b"])
  })
  test("the root folder keeps its name", () => {
    const rows = projectRows([p("a", "/", 1)])
    expect(rows[0]).toMatchObject({ directory: "/", title: "/" })
  })
  test("search matches title and path, ignoring case", () => {
    const list = [p("a", "/home/me/Alpha", 3), p("b", "/home/me/beta", 2, 2, "Great Thing"), p("c", "/srv/gamma", 1)]
    expect(projectRows(list, "alp").map((r) => r.directory)).toEqual(["/home/me/Alpha"])
    expect(projectRows(list, "great").map((r) => r.directory)).toEqual(["/home/me/beta"])
    expect(projectRows(list, "/srv").map((r) => r.directory)).toEqual(["/srv/gamma"])
    expect(projectRows(list, "zzz")).toEqual([])
    expect(projectRows([], "")).toEqual([])
  })
  test("guessHome", () => {
    expect(guessHome(["/tmp", "/home/salim/x"])).toBe("/home/salim")
    expect(guessHome(["/Users/ann/dev"])).toBe("/Users/ann")
    expect(guessHome(["/tmp", "/srv"])).toBeUndefined()
  })
})
