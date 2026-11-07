import { describe, expect, test } from "bun:test"
import { droppedFileUris, mimeFromName } from "@occ/core/attachments"
import { atLeast, detectFeatures, isUnsupported, parseVersion } from "@occ/core/features"

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
