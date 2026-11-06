import { describe, expect, test } from "bun:test"
import { attachmentFromUri, base64Bytes, baseName, checkBlob, dataUri, fileUri, isImageMime, MAX_ATTACHMENT_BYTES, modelTakesImages, toPromptFiles } from "../../src/core/attachments"
import { displayName, variantName } from "../../src/core/names"
import { normalizePins, pinKey, togglePin } from "../../src/core/pins"
import { groupModels, pinnedModels } from "../../src/core/models"
import type { SlimModel } from "../../src/core/api"

describe("displayName", () => {
  test("capitalizes ids for display only", () => {
    expect(displayName("assistant")).toBe("Assistant")
    expect(displayName("build")).toBe("Build")
    expect(displayName("shell")).toBe("Shell")
    expect(displayName("code-reviewer")).toBe("Code Reviewer")
    expect(displayName("web_fetch")).toBe("Web Fetch")
  })
  test("leaves existing capitals and empty input alone", () => {
    expect(displayName("GPT")).toBe("GPT")
    expect(displayName("  ")).toBe("")
  })
})

describe("pins", () => {
  const sonnet = { id: "sonnet", providerID: "anthropic" }
  test("key combines provider and model so equal ids from two providers stay apart", () => {
    expect(pinKey(sonnet)).toBe("anthropic/sonnet")
    expect(pinKey({ id: "sonnet", providerID: "proxy" })).not.toBe(pinKey(sonnet))
  })
  test("toggle adds and removes without mutating", () => {
    const a: string[] = []
    const b = togglePin(a, "x/y")
    expect(b).toEqual(["x/y"])
    expect(a).toEqual([])
    expect(togglePin(b, "x/y")).toEqual([])
  })
  test("storage garbage becomes a clean list", () => {
    expect(normalizePins(undefined)).toEqual([])
    expect(normalizePins("nope")).toEqual([])
    expect(normalizePins(["a/b", "a/b", 3, "bad", "c/d"])).toEqual(["a/b", "c/d"])
  })
  test("pinned models come first in pin order, then the provider groups still list them", () => {
    const m = (id: string, providerID: string): SlimModel => ({ id, modelID: id, providerID, name: id, enabled: true, variants: [] })
    const models = [m("a", "p1"), m("b", "p1"), m("c", "p2")]
    const pinned = pinnedModels(models, ["p2/c", "p1/a", "gone/x"])
    expect(pinned.map((x) => x.id)).toEqual(["c", "a"])
    expect(groupModels({ models, providers: [], query: "" }).flatMap((g) => g.models).length).toBe(3)
  })
})

describe("attachment URIs", () => {
  test("POSIX paths, with spaces and unicode encoded", () => {
    expect(fileUri("/home/me/a b.ts")).toBe("file:///home/me/a%20b.ts")
    expect(fileUri("/tmp/é.png")).toBe("file:///tmp/%C3%A9.png")
  })
  test("Windows drive paths match vscode.Uri.file().toString()", () => {
    expect(fileUri("C:\\Users\\me\\Downloads\\a b.png")).toBe("file:///c%3A/Users/me/Downloads/a%20b.png")
    expect(fileUri("c:/work/x.ts")).toBe("file:///c%3A/work/x.ts")
  })
  test("UNC paths keep the server as the authority", () => {
    expect(fileUri("\\\\srv\\share\\dir\\f.txt")).toBe("file://srv/share/dir/f.txt")
  })
  test("names come from the last segment, decoded", () => {
    expect(baseName("file:///c%3A/Users/me/a%20b.png")).toBe("a b.png")
    expect(baseName("C:\\Users\\me\\x.ts")).toBe("x.ts")
    expect(baseName("/a/b/")).toBe("b")
  })
})

describe("pasted and dropped blobs", () => {
  test("data URI and size", () => {
    expect(dataUri("image/png", "AAAA")).toBe("data:image/png;base64,AAAA")
    expect(base64Bytes("AAAA")).toBe(3)
    expect(base64Bytes("AA==")).toBe(1)
    expect(base64Bytes("AAA=")).toBe(2)
  })
  test("20 MiB limit is inclusive; empty files are refused", () => {
    expect(checkBlob({ mime: "image/png", bytes: MAX_ATTACHMENT_BYTES }).ok).toBe(true)
    const big = checkBlob({ mime: "image/png", bytes: MAX_ATTACHMENT_BYTES + 1, name: "big.png" })
    expect(big.ok).toBe(false)
    expect(big.ok === false && big.reason).toContain("big.png")
    expect(checkBlob({ mime: "image/png", bytes: 0 }).ok).toBe(false)
  })
  test("image detection and the model capability warning", () => {
    expect(isImageMime("image/webp")).toBe(true)
    expect(isImageMime("application/pdf")).toBe(false)
    expect(modelTakesImages(["text", "image"])).toBe(true)
    expect(modelTakesImages(["text"])).toBe(false)
    expect(modelTakesImages(undefined)).toBe(true)
  })
  test("prompt files carry uri and name only; image data URIs become thumbnails", () => {
    const a = attachmentFromUri("1", dataUri("image/png", "AAAA"), "shot.png", "image/png")
    const f = attachmentFromUri("2", fileUri("/x/y.ts"))
    expect(a.thumb).toBe("data:image/png;base64,AAAA")
    expect(f.thumb).toBeUndefined()
    expect(f.name).toBe("y.ts")
    expect(toPromptFiles([a, f])).toEqual([{ uri: "data:image/png;base64,AAAA", name: "shot.png" }, { uri: "file:///x/y.ts", name: "y.ts" }])
  })
})

describe("variantName", () => {
  test("model variants get display casing; the id sent to the server is unchanged", () => {
    expect(["low", "medium", "high", "minimal", "max"].map(variantName)).toEqual(["Low", "Medium", "High", "Minimal", "Max"])
    expect(variantName("xhigh")).toBe("X-High")
  })
})
