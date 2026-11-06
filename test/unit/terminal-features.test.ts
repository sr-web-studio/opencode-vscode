import { describe, expect, test } from "bun:test"
import { droppedFileUris, mimeFromName } from "../../src/core/attachments"
import { atLeast, detectFeatures, isUnsupported, parseVersion } from "../../src/core/features"
import { exitText, headerText, terminalName, terminalsToClose, toCrlf } from "../../src/core/terminal-text"

describe("terminal text", () => {
  test("\\n becomes \\r\\n, and an existing \\r\\n is left alone", () => {
    expect(toCrlf("a\nb\n").text).toBe("a\r\nb\r\n")
    expect(toCrlf("a\r\nb").text).toBe("a\r\nb")
  })
  test("a \\r\\n split across two pages is not doubled", () => {
    const first = toCrlf("line\r")
    expect(first.endsWithCR).toBe(true)
    expect(toCrlf("\nnext", first.endsWithCR).text).toBe("\nnext")
    expect(toCrlf("\nnext", false).text).toBe("\r\nnext")
  })
  test("header prints the command and the working directory", () => {
    expect(headerText("echo hi", "/tmp/x")).toBe("\x1b[1m$ echo hi\x1b[0m\r\n\x1b[2m/tmp/x\x1b[0m\r\n")
    expect(headerText("a\nb", undefined)).toBe("\x1b[1m$ a b\x1b[0m\r\n")
  })
  test("the exit line is green for 0, red for a failure, yellow for timeout or stop", () => {
    expect(exitText({ status: "exited", exit: 0 })).toBe("\r\n\x1b[32mexit 0\x1b[0m\r\n")
    expect(exitText({ status: "exited", exit: 2 })).toBe("\r\n\x1b[31mexit 2\x1b[0m\r\n")
    expect(exitText({ status: "timeout" })).toContain("timed out")
    expect(exitText({ status: "killed" })).toContain("stopped")
  })
  test("names: OpenCode: cmd, and OpenCode (agent): cmd for workers", () => {
    expect(terminalName("bun test")).toBe("OpenCode: bun test")
    expect(terminalName("bun   test\n", "explore")).toBe("OpenCode (explore): bun test")
    expect(terminalName("x".repeat(80)).length).toBeLessThan(60)
  })
  test("maxOpen closes the oldest finished terminals and never a running one", () => {
    const open = [
      { shellID: "a", finished: true },
      { shellID: "b", finished: false },
      { shellID: "c", finished: true },
      { shellID: "d", finished: true },
    ]
    expect(terminalsToClose(open, 5)).toEqual([])
    expect(terminalsToClose(open, 3)).toEqual(["a"])
    expect(terminalsToClose(open, 2)).toEqual(["a", "c"])
    expect(terminalsToClose(open, 1)).toEqual(["a", "c", "d"])
    expect(terminalsToClose([{ shellID: "r", finished: false }, { shellID: "s", finished: false }], 1)).toEqual([])
  })
})

describe("server features", () => {
  const client = { session: { update() {}, revert: { stage() {} } } }
  test("versions parse and compare", () => {
    expect(parseVersion("2.2.5")).toEqual([2, 2, 5])
    expect(parseVersion("v2.1.4-beta")).toEqual([2, 1, 4])
    expect(atLeast("2.1.4", "2.2.0")).toBe(false)
    expect(atLeast("2.2.0", "2.2.0")).toBe(true)
    expect(atLeast("2.10.0", "2.2.0")).toBe(true)
    expect(atLeast("3.0.0", "2.2.0")).toBe(true)
    expect(atLeast(undefined, "2.2.0")).toBe(true)
  })
  test("revert is hidden on 2.1.x and shown on 2.2.x", () => {
    expect(detectFeatures(client, "2.1.4").revert).toBe(false)
    expect(detectFeatures(client, "2.2.5").revert).toBe(true)
  })
  test("revert is hidden when the method is missing, or after the server said it does not exist", () => {
    expect(detectFeatures({ session: {} }, "2.2.5").revert).toBe(false)
    expect(detectFeatures(client, "2.2.5", { revert: true }).revert).toBe(false)
    expect(detectFeatures(undefined, "2.2.5")).toEqual({ revert: false, rename: false })
  })
  test("rename follows session.update", () => {
    expect(detectFeatures(client, "2.1.4").rename).toBe(true)
    expect(detectFeatures({ session: {} }, "2.1.4").rename).toBe(false)
    expect(detectFeatures(client, "2.1.4", { rename: true }).rename).toBe(false)
  })
  test("which errors mean the endpoint does not exist", () => {
    expect(isUnsupported(new Error("HTTP 404 Not Found"))).toBe(true)
    expect(isUnsupported(new Error("No such route"))).toBe(true)
    expect(isUnsupported(new Error("Session is busy"))).toBe(false)
  })
})

describe("dropped files and mime", () => {
  test("a Windows Explorer drag as text/uri-list", () => {
    expect(droppedFileUris({ uriList: "file:///c%3A/Users/me/a%20b.png\r\n# comment\r\n" })).toEqual(["file:///c%3A/Users/me/a%20b.png"])
  })
  test("resourceurls JSON and plain text are read, duplicates removed, non-file URIs ignored", () => {
    const out = droppedFileUris({
      uriList: "file:///a/x.ts",
      resourceUrls: JSON.stringify(["file:///a/x.ts", "https://example.com/y", "file:///a/z.ts"]),
      text: "file:///a/z.ts\nnot a uri",
    })
    expect(out).toEqual(["file:///a/x.ts", "file:///a/z.ts"])
  })
  test("garbage payloads give nothing and do not throw", () => {
    expect(droppedFileUris({ resourceUrls: "{oops" })).toEqual([])
    expect(droppedFileUris({})).toEqual([])
  })
  test("mime from the file name", () => {
    expect(mimeFromName("shot.PNG")).toBe("image/png")
    expect(mimeFromName("a.tar.gz")).toBeUndefined()
    expect(mimeFromName("noext")).toBeUndefined()
  })
})
