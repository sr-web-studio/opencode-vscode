import { describe, expect, test } from "bun:test"
import { executeCalls, executeOutput, executeTarget } from "../../src/core/transcript/execute"
import { firstChangedLine, patchedFiles } from "../../src/core/transcript/patch"
import { readLine, rowAction, rowTitle, summarizeTool } from "../../src/core/transcript/tools"
import type { ToolItem } from "../../src/core/transcript/types"

const cwd = "/w"
const tool = (name: string, input: Record<string, unknown>, metadata: Record<string, unknown> = {}, status: ToolItem["status"] = "completed"): ToolItem => ({
  kind: "tool", id: "t", name, status, input, metadata, output: "",
})

describe("readLine", () => {
  test("offset is 1-based: it is the line to open", () => {
    expect(readLine({ offset: 95, limit: 40 })).toBe(95)
    expect(readLine({ offset: 1 })).toBe(1)
  })
  test("no, zero, negative, fractional or junk offset", () => {
    expect(readLine({})).toBeUndefined()
    expect(readLine({ limit: 20 })).toBeUndefined()
    expect(readLine({ offset: 0 })).toBeUndefined()
    expect(readLine({ offset: -3 })).toBeUndefined()
    expect(readLine({ offset: NaN })).toBeUndefined()
    expect(readLine({ offset: "abc" })).toBeUndefined()
    expect(readLine({ offset: 7.9 })).toBe(7)
  })
  test("a numeric string offset", () => {
    expect(readLine({ offset: "120" })).toBe(120)
  })
})

describe("firstChangedLine", () => {
  test("first changed line after leading context", () => {
    const patch = "Index: a.ts\n=====\n--- a.ts\n+++ a.ts\n@@ -10,6 +10,7 @@\n ctx\n ctx\n ctx\n+added\n ctx\n"
    expect(firstChangedLine(patch)).toBe(13)
  })
  test("a hunk that starts with a change", () => {
    expect(firstChangedLine("@@ -5,2 +5,3 @@\n+new\n old\n")).toBe(5)
    expect(firstChangedLine("@@ -1,15 +0,0 @@\n-gone\n")).toBe(1)
  })
  test("only the first hunk counts, and the no-newline marker is not a line", () => {
    expect(firstChangedLine("@@ -1 +1 @@\n-a\n+b\n@@ -40,3 +40,3 @@\n-x\n+y\n")).toBe(1)
    expect(firstChangedLine("@@ -3,2 +3,2 @@\n a\n\\ No newline at end of file\n-b\n+c\n")).toBe(4)
  })
  test("no hunk or no change", () => {
    expect(firstChangedLine("")).toBeUndefined()
    expect(firstChangedLine("@@ -1,2 +1,2 @@\n a\n b\n")).toBeUndefined()
  })
})

describe("patchedFiles", () => {
  test("from metadata, else from the patch text headers", () => {
    expect(patchedFiles({ input: {}, metadata: { files: [{ file: "/w/a.ts", patch: "p" }] } })).toEqual([{ file: "/w/a.ts", patch: "p", status: undefined }])
    const text = "*** Begin Patch\n*** Update File: /w/a.ts\n@@\n-a\n+b\n*** Add File: /w/b.ts\n+x\n*** End Patch"
    expect(patchedFiles({ input: { patchText: text }, metadata: {} }).map((f) => f.file)).toEqual(["/w/a.ts", "/w/b.ts"])
  })
})

describe("executeCalls", () => {
  test("dotted, bracketed and quoted forms, in order, de-duplicated", () => {
    const code = `
      const a = await tools.exa.web_search_exa({ query: "x" })
      const p = await tools["chrome-devtools"].new_page({ url: "https://a.b" })
      const q = await tools['chrome'].list_pages()
      await tools.exa.web_search_exa({ query: "again" })
      await tools . fal . run_model ( {} )`
    expect(executeCalls(code)).toEqual(["exa.web_search_exa", "chrome-devtools.new_page", "chrome.list_pages", "fal.run_model"])
  })
  test("ignores mentions that are not calls, and unrelated objects", () => {
    expect(executeCalls("const t = tools.exa\nmytools.a.b()\nconsole.log(tools)")).toEqual([])
  })
  test("target: first two and a count, else empty", () => {
    expect(executeTarget("tools.a.x(); tools.b.y(); tools.c.z(); tools.d.w()")).toBe("a.x, b.y +2")
    expect(executeTarget("tools.a.x()")).toBe("a.x")
    expect(executeTarget("const x = 1")).toBe("")
  })
  test("the row falls back to the first code line", () => {
    const row = tool("execute", { code: "const x = 1\nreturn x" })
    expect(summarizeTool(row, cwd)).toMatchObject({ label: "Code", target: "const x = 1" })
    const mcp = tool("execute", { code: "const r = await tools.exa.web_search_exa({})\nawait tools.chrome.new_page({})" })
    expect(summarizeTool(mcp, cwd).target).toBe("exa.web_search_exa, chrome.new_page")
  })
  test("output: a JSON-encoded string result shows as text", () => {
    expect(executeOutput({ output: '"hello\\nworld"' })).toBe("hello\nworld")
    expect(executeOutput({ output: '{"a":1}' })).toBe('{"a":1}')
    expect(executeOutput({ output: "plain" })).toBe("plain")
  })
})

describe("summarizeTool lines", () => {
  test("read carries the offset as line", () => {
    expect(summarizeTool(tool("read", { path: "/w/src/a.ts", offset: 120, limit: 40 }), cwd)).toMatchObject({ target: "src/a.ts", path: "/w/src/a.ts", at: 120 })
    expect(summarizeTool(tool("read", { filePath: "/w/a.ts" }), cwd).at).toBeUndefined()
  })
  test("edit opens at the first changed line of its patch", () => {
    const patch = "@@ -20,4 +20,5 @@\n a\n b\n+c\n d\n"
    const row = tool("edit", { path: "/w/a.ts" }, { files: [{ file: "/w/a.ts", patch, additions: 1, deletions: 0 }] })
    expect(summarizeTool(row, cwd).at).toBe(22)
  })
  test("patch has no path input: the file comes from metadata or headers", () => {
    const patch = "@@ -3,2 +3,2 @@\n-a\n+b\n"
    const done = tool("patch", { patchText: "x" }, { files: [{ file: "/w/a.ts", patch }, { file: "/w/b.ts", patch }] })
    expect(summarizeTool(done, cwd)).toMatchObject({ target: "a.ts +1", path: "/w/a.ts", at: 3 })
    const running = tool("patch", { patchText: "*** Begin Patch\n*** Update File: /w/z.ts\n@@\n" }, {}, "running")
    expect(summarizeTool(running, cwd)).toMatchObject({ target: "z.ts", path: "/w/z.ts" })
  })
})

describe("rowAction", () => {
  test("file tools open the file, with a line when known", () => {
    expect(rowAction(tool("read", { path: "/w/a.ts", offset: 12 }), cwd)).toEqual({ kind: "file", path: "/w/a.ts", line: 12 })
    expect(rowAction(tool("read", { path: "/w/a.ts" }), cwd)).toEqual({ kind: "file", path: "/w/a.ts" })
    expect(rowAction(tool("write", { path: "/w/n.ts" }), cwd)).toEqual({ kind: "file", path: "/w/n.ts" })
    const patch = "@@ -7,2 +7,2 @@\n-a\n+b\n"
    expect(rowAction(tool("edit", { path: "/w/a.ts" }, { files: [{ file: "/w/a.ts", patch }] }), cwd)).toEqual({ kind: "file", path: "/w/a.ts", line: 7 })
    expect(rowAction(tool("patch", { patchText: "" }, { files: [{ file: "/w/a.ts", patch }] }), cwd)).toEqual({ kind: "file", path: "/w/a.ts", line: 7 })
  })
  test("webfetch opens the URL; non-http targets just toggle", () => {
    expect(rowAction(tool("webfetch", { url: "https://example.com/a?b=1" }), cwd)).toEqual({ kind: "url", url: "https://example.com/a?b=1" })
    expect(rowAction(tool("webfetch", { url: "file:///etc/passwd" }), cwd)).toEqual({ kind: "toggle" })
    expect(rowAction(tool("webfetch", {}), cwd)).toEqual({ kind: "toggle" })
  })
  test("an MCP tool whose first argument is a URL opens it", () => {
    expect(rowAction(tool("chrome_new_page", { url: "http://localhost:3000" }), cwd)).toEqual({ kind: "url", url: "http://localhost:3000" })
  })
  test("worker rows", () => {
    expect(rowAction(tool("subagent", { description: "x" }), cwd)).toEqual({ kind: "worker" })
  })
  test("everything else toggles", () => {
    for (const name of ["shell", "grep", "glob", "execute", "skill", "question", "todowrite", "websearch"]) {
      expect(rowAction(tool(name, { command: "ls", pattern: "x", code: "1" }), cwd)).toEqual({ kind: "toggle" })
    }
  })
  test("tooltips say what a click does", () => {
    const line = { target: "src/a.ts" }
    expect(rowTitle({ kind: "file", path: "/w/src/a.ts", line: 120 }, line)).toContain("at line 120")
    expect(rowTitle({ kind: "file", path: "/w/src/a.ts" }, line)).not.toContain("line")
    expect(rowTitle({ kind: "url", url: "https://x.y" }, line)).toContain("https://x.y")
    expect(rowTitle({ kind: "toggle" }, line)).toBeUndefined()
  })
})
