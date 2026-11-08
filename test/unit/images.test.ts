import { describe, expect, test } from "bun:test"
import { parseDataUri } from "@occ/core/attachments"
import { ImageCache } from "@occ/core/image-cache"
import { attachmentSource, previewName, safeImageMime, stalePreviews, thumbSize } from "@occ/core/images"
import { applyEvent, fileChips, viewFromMessages } from "@occ/core/transcript/reducer"

/** A real 1x1 transparent PNG: the only image data in the tests. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const inline = (name = "image.png") => ({ data: PNG, mime: "image/png", name, source: { type: "inline" } })

describe("fileChips keeps refs, never the data", () => {
  test("inline data gets an image ref, and the base64 is nowhere in the chip", () => {
    const chips = fileChips([inline(), inline("b.png")], "msg_1")!
    expect(chips).toEqual([
      { name: "image.png", mime: "image/png", ref: { messageID: "msg_1", index: 0 } },
      { name: "b.png", mime: "image/png", ref: { messageID: "msg_1", index: 1 } },
    ])
    expect(JSON.stringify(chips)).not.toContain(PNG)
  })
  test("a file:// source keeps its uri (the chip opens the file) and an image gets a ref too", () => {
    const chips = fileChips([{ mime: "image/png", name: "shot.png", source: { type: "uri", uri: "file:///home/u/shot.png" } }, { mime: "text/plain", name: "notes.txt", source: { type: "uri", uri: "file:///home/u/notes.txt" } }], "m")!
    expect(chips[0]).toEqual({ name: "shot.png", mime: "image/png", uri: "file:///home/u/shot.png", ref: { messageID: "m", index: 0 } })
    expect(chips[1]).toEqual({ name: "notes.txt", mime: "text/plain", uri: "file:///home/u/notes.txt" })
  })
  test("without a message id there is no ref (nothing the host could look up)", () => {
    expect(fileChips([inline()])![0]).toEqual({ name: "image.png", mime: "image/png" })
  })
  test("an attachment with no usable source has no ref", () => {
    expect(fileChips([{ mime: "image/png", name: "x.png", source: { type: "inline" } }], "m")![0]!.ref).toBeUndefined()
  })
  test("a live pasted image (data: uri) gets a ref and no uri", () => {
    const [chip] = fileChips([{ uri: `data:image/png;base64,${PNG}`, name: "pasted.png" }], "i1")!
    expect(chip).toEqual({ name: "pasted.png", mime: "image/png", ref: { messageID: "i1", index: 0 } })
  })
  test("history, queued and delivered turns carry refs; the state stays small", () => {
    const v = viewFromMessages([{ id: "u", type: "user", text: "look", files: [inline()] }] as any)
    expect(v.turns[0]!.user!.files).toEqual([{ name: "image.png", mime: "image/png", ref: { messageID: "u", index: 0 } }])
    const live = applyEvent({ turns: [], queued: [], loaded: true }, { id: "e", type: "session.inbox.enqueued", created: 1, data: { inboxID: "i1", item: { type: "user", payload: { text: "hi", files: [{ uri: `data:image/png;base64,${PNG}`, name: "p.png" }] } } } })
    expect(live.queued[0]!.files).toEqual([{ name: "p.png", mime: "image/png", ref: { messageID: "i1", index: 0 } }])
    const delivered = applyEvent(live, { id: "e2", type: "session.inbox.delivered", created: 2, data: { inboxID: "i1" } })
    expect(delivered.turns[0]!.user!.files).toEqual(live.queued[0]!.files)
    expect(JSON.stringify(delivered)).not.toContain(PNG)
  })
})

describe("attachmentSource", () => {
  test("inline data, a data uri, a file uri; anything else nothing", () => {
    expect(attachmentSource(inline())).toEqual({ kind: "data", mime: "image/png", base64: PNG })
    expect(attachmentSource({ uri: `data:image/png;base64,${PNG}` })).toEqual({ kind: "data", mime: "image/png", base64: PNG })
    expect(attachmentSource({ source: { uri: "file:///a/b.jpg" }, name: "b.jpg" })).toEqual({ kind: "uri", uri: "file:///a/b.jpg", mime: "image/jpeg" })
    expect(attachmentSource({ uri: "https://example.com/x.png" })).toBeUndefined()
    expect(attachmentSource({ data: PNG })).toBeUndefined()
    expect(attachmentSource(undefined)).toBeUndefined()
  })
  test("parseDataUri needs base64", () => {
    expect(parseDataUri(`data:image/png;base64,${PNG}`)).toEqual({ mime: "image/png", base64: PNG })
    expect(parseDataUri("data:text/plain,hello")).toBeUndefined()
  })
  test("only plain image types are served to the webview", () => {
    expect(safeImageMime("image/png")).toBe(true)
    expect(safeImageMime("image/svg+xml")).toBe(true)
    expect(safeImageMime("text/html")).toBe(false)
    expect(safeImageMime('image/png"onerror="x')).toBe(false)
    expect(safeImageMime(undefined)).toBe(false)
  })
})

describe("preview names", () => {
  test("<msgid>-<i>.<ext> from the mime, else the file name, else png", () => {
    expect(previewName({ messageID: "msg_1af9", index: 0 }, "image/png")).toBe("msg_1af9-0.png")
    expect(previewName({ messageID: "msg_1af9", index: 2 }, "image/jpeg")).toBe("msg_1af9-2.jpg")
    expect(previewName({ messageID: "m", index: 1 }, undefined, "shot.WEBP")).toBe("m-1.webp")
    expect(previewName({ messageID: "m", index: 1 })).toBe("m-1.png")
  })
  test("ids cannot escape the folder", () => {
    const n = previewName({ messageID: "../../etc/pass wd", index: 0 }, "image/png")
    expect(n).not.toContain("/")
    expect(n).not.toContain("..")
    expect(n.endsWith("-0.png")).toBe(true)
  })
  test("negative or fractional indexes are clamped", () => {
    expect(previewName({ messageID: "m", index: -3 }, "image/png")).toBe("m-0.png")
    expect(previewName({ messageID: "m", index: 1.9 }, "image/png")).toBe("m-1.png")
  })
})

describe("stalePreviews", () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 10 * DAY
  test("old previews are listed, fresh ones and foreign files never", () => {
    const entries = [
      { name: "msg_a-0.png", mtime: now - 2 * DAY },
      { name: "msg_b-1.jpg", mtime: now - 1000 },
      { name: "notes.txt", mtime: 0 },
      { name: "msg_c-0.png.bak", mtime: 0 },
    ]
    expect(stalePreviews(entries, now)).toEqual(["msg_a-0.png"])
    expect(stalePreviews(entries, now, 500)).toEqual(["msg_a-0.png", "msg_b-1.jpg"])
  })
})

describe("thumbSize", () => {
  test("small images are not scaled; tall ones are brought to 128px high, ratio kept", () => {
    expect(thumbSize(100, 60)).toEqual({ width: 100, height: 60, scaled: false })
    expect(thumbSize(2000, 1000)).toEqual({ width: 256, height: 128, scaled: true })
    expect(thumbSize(0, 0).scaled).toBe(false)
  })
})

describe("ImageCache", () => {
  const stored = (files: unknown[]) => ({ files })
  function make(maxChars?: number, files: unknown[] = [inline()]) {
    const calls = { message: 0, file: 0 }
    const cache = new ImageCache(
      {
        message: async (_s, id) => {
          calls.message++
          if (id === "gone") throw new Error("not found")
          return stored(files)
        },
        file: async (uri) => {
          calls.file++
          return uri.endsWith("missing.png") ? undefined : { mime: "image/png", base64: PNG }
        },
      },
      maxChars,
    )
    return { cache, calls }
  }
  test("loads from the stored message once, then serves from the cache", async () => {
    const { cache, calls } = make()
    expect(await cache.get("s", { messageID: "m", index: 0 })).toEqual({ mime: "image/png", base64: PNG })
    await cache.get("s", { messageID: "m", index: 0 })
    expect(calls.message).toBe(1)
  })
  test("a seeded live image needs no request at all", async () => {
    const { cache, calls } = make()
    cache.seed("i1", [{ uri: `data:image/png;base64,${PNG}`, name: "p.png" }])
    expect((await cache.get("s", { messageID: "i1", index: 0 }))?.base64).toBe(PNG)
    expect(calls.message).toBe(0)
  })
  test("two requests for the same image share one load", async () => {
    const { cache, calls } = make()
    await Promise.all([cache.get("s", { messageID: "m", index: 0 }), cache.get("s", { messageID: "m", index: 0 })])
    expect(calls.message).toBe(1)
  })
  test("a file:// attachment is read from disk by the host", async () => {
    const { cache, calls } = make(undefined, [{ mime: "image/png", name: "s.png", source: { type: "uri", uri: "file:///x/s.png" } }])
    expect((await cache.get("s", { messageID: "m", index: 0 }))?.mime).toBe("image/png")
    expect(calls.file).toBe(1)
  })
  test("a gone message, an unreadable file or a wrong index give nothing, without throwing", async () => {
    expect(await make().cache.get("s", { messageID: "gone", index: 0 })).toBeUndefined()
    expect(await make().cache.get("s", { messageID: "m", index: 5 })).toBeUndefined()
    const { cache } = make(undefined, [{ mime: "image/png", name: "m.png", source: { type: "uri", uri: "file:///x/missing.png" } }])
    expect(await cache.get("s", { messageID: "m", index: 0 })).toBeUndefined()
  })
  test("the cache is bounded: the least recently used image goes first, and an oversized one is not kept", async () => {
    const { cache } = make(PNG.length * 2)
    for (const id of ["a", "b"]) cache.seed(id, [inline()])
    await cache.get("s", { messageID: "a", index: 0 })
    cache.seed("c", [inline()])
    expect(cache.size).toBe(2)
    const { cache: tiny } = make(10)
    tiny.seed("x", [inline()])
    expect(tiny.size).toBe(0)
    expect((await tiny.get("s", { messageID: "x", index: 0 }))?.base64).toBe(PNG)
  })
})
