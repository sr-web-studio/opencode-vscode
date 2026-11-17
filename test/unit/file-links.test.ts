import { describe, expect, test } from "bun:test"
import { fileHrefTarget, joinPath, keepFileHref, resolveFileLink } from "../../packages/core/src/file-links"
import { looksLikePath } from "../../packages/core/src/paths"

const ctx = {
  home: "/home/me",
  sessionDirectory: "/work/site/design/briefs",
  roots: ["/work/site", "/work/other"],
}

describe("resolveFileLink", () => {
  test("an absolute path is the only candidate, even outside the workspace", () => {
    expect(resolveFileLink("/home/me/elsewhere/report.md", ctx)).toEqual({ candidates: ["/home/me/elsewhere/report.md"] })
  })

  test("~ expands with the home folder the host passes", () => {
    expect(resolveFileLink("~/notes/a.md", ctx).candidates).toEqual(["/home/me/notes/a.md"])
    expect(resolveFileLink("~/notes/a.md", {}).candidates).toEqual([])
  })

  test("a relative path tries the session folder, the roots, then the session folder's ancestors", () => {
    expect(resolveFileLink("agent-reports/x.md", ctx).candidates).toEqual([
      "/work/site/design/briefs/agent-reports/x.md",
      "/work/site/agent-reports/x.md",
      "/work/other/agent-reports/x.md",
      "/work/site/design/agent-reports/x.md",
    ])
  })

  test("a session folder different from the workspace folder comes first", () => {
    const link = resolveFileLink("src/a.ts", { sessionDirectory: "/wt/feature", roots: ["/work/site"] })
    expect(link.candidates).toEqual(["/wt/feature/src/a.ts", "/work/site/src/a.ts"])
  })

  test("./ and ../ are resolved", () => {
    expect(resolveFileLink("./a.md", { roots: ["/p"] }).candidates).toEqual(["/p/a.md"])
    expect(resolveFileLink("../a.md", { roots: ["/p/q"] }).candidates).toEqual(["/p/a.md"])
  })

  test(":line, :line:col and #L10 positions", () => {
    expect(resolveFileLink("src/a.ts:12", { roots: ["/p"] })).toEqual({ candidates: ["/p/src/a.ts"], line: 12 })
    expect(resolveFileLink("src/a.ts:12:3", { roots: ["/p"] })).toEqual({ candidates: ["/p/src/a.ts"], line: 12, column: 3 })
    expect(resolveFileLink("./x.md#L3", { roots: ["/p"] })).toEqual({ candidates: ["/p/x.md"], line: 3 })
    expect(resolveFileLink("/a/b.ts#L10-L20", {})).toEqual({ candidates: ["/a/b.ts"], line: 10 })
    expect(resolveFileLink("/a/b.ts (line 10)", {})).toEqual({ candidates: ["/a/b.ts"], line: 10 })
  })

  test("backticks, quotes and trailing punctuation are dropped", () => {
    expect(resolveFileLink("`/a/b.ts`", {}).candidates).toEqual(["/a/b.ts"])
    expect(resolveFileLink('"/a/b.ts".', {}).candidates).toEqual(["/a/b.ts"])
    expect(resolveFileLink("/a/b.ts:7,", {})).toEqual({ candidates: ["/a/b.ts"], line: 7 })
    expect(resolveFileLink("(/a/b.ts)", {}).candidates).toEqual(["/a/b.ts"])
  })

  test("file:/// URLs are decoded", () => {
    expect(resolveFileLink("file:///home/me/my%20docs/a.md", ctx).candidates).toEqual(["/home/me/my docs/a.md"])
    expect(resolveFileLink("file:///home/me/a.md#L5", ctx)).toEqual({ candidates: ["/home/me/a.md"], line: 5 })
    expect(resolveFileLink("file:///C:/Users/me/a.md", ctx).candidates).toEqual(["C:/Users/me/a.md"])
  })

  test("Windows paths keep drive letters and backslashes", () => {
    expect(resolveFileLink("C:\\Users\\me\\a.md:4", {})).toEqual({ candidates: ["C:\\Users\\me\\a.md"], line: 4 })
    expect(resolveFileLink("src\\a.ts", { sessionDirectory: "D:\\work\\wt", roots: ["D:\\work\\main"] }).candidates).toEqual(["D:\\work\\wt\\src\\a.ts", "D:\\work\\main\\src\\a.ts"])
    expect(resolveFileLink("~\\a.md", { home: "C:\\Users\\me" }).candidates).toEqual(["C:\\Users\\me\\a.md"])
  })

  test("candidates are de-duplicated", () => {
    expect(resolveFileLink("a.md", { sessionDirectory: "/p", roots: ["/p", "/p/"] }).candidates).toEqual(["/p/a.md"])
  })

  test("a missing file lists every place that was tried", () => {
    expect(resolveFileLink("gone/x.md", ctx).candidates).toEqual(["/work/site/design/briefs/gone/x.md", "/work/site/gone/x.md", "/work/other/gone/x.md", "/work/site/design/gone/x.md"])
  })

  test("a #anchor or ?query is not part of the file name", () => {
    expect(resolveFileLink("docs/guide.md#install", { roots: ["/p"] })).toEqual({ candidates: ["/p/docs/guide.md"] })
    expect(resolveFileLink("/abs/a.md#section", {})).toEqual({ candidates: ["/abs/a.md"] })
    expect(resolveFileLink("a.md?plain=1", { roots: ["/p"] })).toEqual({ candidates: ["/p/a.md"] })
    expect(resolveFileLink("/abs/a.md?x=1#L7", {})).toEqual({ candidates: ["/abs/a.md"], line: 7 })
    expect(resolveFileLink("file:///abs/a.md#top", {})).toEqual({ candidates: ["/abs/a.md"] })
  })

  test("UNC paths are absolute and file://host/share keeps the host", () => {
    expect(resolveFileLink("\\\\srv\\share\\a.md:3", { roots: ["/p"] })).toEqual({ candidates: ["\\\\srv\\share\\a.md"], line: 3 })
    expect(resolveFileLink("file://srv/share/x%20y.md", {}).candidates).toEqual(["\\\\srv\\share\\x y.md"])
    expect(resolveFileLink("file://localhost/a/b.md", {}).candidates).toEqual(["/a/b.md"])
  })
})

describe("keepFileHref", () => {
  test("file: is kept on anchors only", () => {
    expect(keepFileHref("A", "href", "file:///a/b.md")).toBe(true)
    expect(keepFileHref("a", "HREF", " FILE:///a/b.md")).toBe(true)
    expect(keepFileHref("A", "href", "a.ts:12")).toBe(true)
    expect(keepFileHref("A", "href", "a.ts:12:3#L4")).toBe(true)
    expect(keepFileHref("A", "href", "C:\\x\\a.md")).toBe(true)
    expect(keepFileHref("A", "href", "mailto:a.b")).toBe(false)
    expect(keepFileHref("IMG", "src", "a.ts:12")).toBe(false)
    expect(keepFileHref("IMG", "src", "file:///a/b.png")).toBe(false)
    expect(keepFileHref("A", "src", "file:///a/b.png")).toBe(false)
    expect(keepFileHref("A", "href", "javascript:alert(1)")).toBe(false)
  })
})

describe("fileHrefTarget", () => {
  test("file-like hrefs open, web links and anchors do not", () => {
    expect(fileHrefTarget("file:///a/b.md")).toBe("file:///a/b.md")
    expect(fileHrefTarget("/a/b.md")).toBe("/a/b.md")
    expect(fileHrefTarget("~/a.md")).toBe("~/a.md")
    expect(fileHrefTarget("./x.md#L3")).toBe("./x.md#L3")
    expect(fileHrefTarget("src/a.ts")).toBe("src/a.ts")
    expect(fileHrefTarget("README.md")).toBe("README.md")
    expect(fileHrefTarget("my%20docs/a.md")).toBe("my docs/a.md")
    expect(fileHrefTarget("C:\\x\\a.md")).toBe("C:\\x\\a.md")
    expect(fileHrefTarget("a.ts:12")).toBe("a.ts:12")
    expect(fileHrefTarget("a.ts:12:3")).toBe("a.ts:12:3")
    expect(fileHrefTarget("docs/guide.md#install")).toBe("docs/guide.md#install")
    expect(fileHrefTarget("\\\\srv\\share\\a.md")).toBe("\\\\srv\\share\\a.md")
    expect(fileHrefTarget("https://example.com/a.md")).toBeUndefined()
    expect(fileHrefTarget("mailto:a@b.c")).toBeUndefined()
    expect(fileHrefTarget("javascript:alert(1)")).toBeUndefined()
    expect(fileHrefTarget("#section")).toBeUndefined()
    expect(fileHrefTarget("")).toBeUndefined()
  })
})

describe("looksLikePath and joinPath", () => {
  test("inline code with a #L suffix is a path", () => {
    expect(looksLikePath("src/a.ts#L10")).toBe(true)
    expect(looksLikePath("~/x/a.md:12:3")).toBe(true)
  })
  test("joinPath keeps the base's separator style", () => {
    expect(joinPath("/a/b", "../c/d.ts")).toBe("/a/c/d.ts")
    expect(joinPath("C:\\a", "b/c.ts")).toBe("C:\\a\\b\\c.ts")
  })
})
