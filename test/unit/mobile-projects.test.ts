import { describe, expect, test } from "bun:test"
import { guessHome, projectFolders, projectRows, type ProjectLike } from "../../apps/mobile/src/lib/projects"

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
  test("title: the project's own name wins over the folder name (the fallback picks the newest named record)", () => {
    const rows = projectRows([p("a", "/home/me/work/online", 1), p("b", "/home/me/work/online", 2, 2, "Online Presence"), p("c", "/home/me/x", 3)])
    expect(rows.find((r) => r.directory === "/home/me/work/online")?.title).toBe("Online Presence")
    expect(rows.find((r) => r.directory === "/home/me/x")?.title).toBe("x")
  })
  test("the authoritative project wins over a newer record of the same folder", () => {
    // The live server holds two records for one folder; `location.get` names the older one as the folder's project.
    const list = [p("new", "/home/me/work/app", 20, 20, "A newer name"), p("auth", "/home/me/work/app", 10, 10, "The project's name")]
    const rows = projectRows(list, "", new Map([["/home/me/work/app", "auth"]]))
    expect(rows[0]).toMatchObject({ title: "The project's name", projectName: "The project's name", projectID: "auth" })
  })
  test("an authoritative project without a name shows the folder name, never another record's name", () => {
    const list = [p("auth", "/home/me/work/app", 10, 10), p("other", "/home/me/work/app", 20, 20, "Another record's name")]
    const rows = projectRows(list, "", new Map([["/home/me/work/app", "auth"]]))
    expect(rows[0]).toMatchObject({ title: "app", projectName: undefined, projectID: "auth" })
  })
  test("until a folder is resolved the newest updated named record is the fallback (list order does not matter)", () => {
    const list = [p("old", "/home/me/app", 5, 5, "Old name"), p("new", "/home/me/app", 30, 1, "New name"), p("blank", "/home/me/app", 40, 40)]
    expect(projectRows(list)[0]?.title).toBe("New name")
    expect(projectRows([...list].reverse())[0]?.title).toBe("New name")
    expect(projectRows(list)[0]?.projectID).toBeUndefined()
  })
  test("a resolved project that the list no longer carries shows the folder name", () => {
    const rows = projectRows([p("x", "/home/me/app", 1, 1, "Some name")], "", new Map([["/home/me/app", "gone"]]))
    expect(rows[0]).toMatchObject({ title: "app", projectID: "gone" })
  })
  test("projectFolders: one entry per folder, without a trailing slash", () => {
    expect(projectFolders([p("a", "/home/user/app/", 1), p("b", "/home/user/app", 2), p("c", "/tmp", 3)])).toEqual(["/home/user/app", "/tmp"])
  })
  test("the path is shown with ~ for the home folder seen in the list; trailing slashes do not split a folder", () => {
    const rows = projectRows([p("a", "/home/user/work/app/", 1), p("b", "/home/user/work/app", 2), p("c", "/tmp", 3)])
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
    expect(guessHome(["/tmp", "/home/user/x"])).toBe("/home/user")
    expect(guessHome(["/Users/ann/dev"])).toBe("/Users/ann")
    expect(guessHome(["/tmp", "/srv"])).toBeUndefined()
  })
})
