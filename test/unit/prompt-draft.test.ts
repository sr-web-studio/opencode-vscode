import { describe, expect, test } from "bun:test"
import { attachmentFromUri } from "@occ/core/attachments"
import {
  DRAFT_MAX_CHARS,
  DRAFT_STORE_PREFIX,
  clearDraft,
  draftDataKey,
  draftFolderKey,
  draftHasContent,
  draftPointerKey,
  draftSignature,
  draftTargetKey,
  emptyPromptDraft,
  loadDraft,
  parseDraft,
  serializeDraft,
  writeDraft,
  type DraftStorage,
} from "@occ/core/prompt-draft"

/** A stand-in for the bridge store: JSON values in a map, like VS Code's webview state and the app's localStorage. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(initial))
  const storage: DraftStorage = {
    get: <T>(key: string) => map.get(key) as T | undefined,
    set: (key: string, value: unknown) => void map.set(key, value),
  }
  return { map, storage }
}

const image = (id = "a1") => attachmentFromUri(id, "data:image/png;base64,iVBORw0KGgo=", "shot.png", "image/png")
const path = (id = "a2") => attachmentFromUri(id, "file:///w/src/a.ts", "a.ts", "text/typescript")

describe("draft keys", () => {
  test("a folder is normalised like the server and VS Code spell it", () => {
    expect(draftFolderKey("/w/app/")).toBe("/w/app")
    expect(draftFolderKey("C:\\Work\\App\\")).toBe("c:/work/app")
    expect(draftFolderKey("/w/app")).toBe("/w/app")
    expect(draftFolderKey("")).toBe("")
  })

  test("the target is a fresh draft or one session", () => {
    expect(draftTargetKey({ kind: "draft" })).toBe("draft")
    expect(draftTargetKey({ kind: "session", id: "ses_1" })).toBe("session:ses_1")
    expect(draftTargetKey(undefined)).toBe("")
  })

  test("the data and pointer keys stay inside the store's prefix", () => {
    expect(draftDataKey("/w", "draft")).toBe(`${DRAFT_STORE_PREFIX}/w:draft`)
    expect(draftPointerKey("/w")).toBe(`${DRAFT_STORE_PREFIX}/w:last`)
  })
})

describe("serializeDraft", () => {
  test("text, files and skills come back, and the preview is rebuilt from the image data", () => {
    const draft = { text: "look at this", files: [image(), path()], skills: [{ id: "sk", name: "deploy" }] }
    const { value, dropped } = serializeDraft(draft)
    expect(dropped).toBe(0)
    // A data URI is stored once: `thumb` is the same bytes and would double it.
    expect(value.files[0]).toEqual({ id: "a1", uri: "data:image/png;base64,iVBORw0KGgo=", name: "shot.png", mime: "image/png" })
    const back = parseDraft(value)!
    expect(back.draft.text).toBe("look at this")
    expect(back.draft.files.map((f) => [f.id, f.name, f.mime])).toEqual([
      ["a1", "shot.png", "image/png"],
      ["a2", "a.ts", "text/typescript"],
    ])
    expect(back.draft.files[0]!.thumb).toBe("data:image/png;base64,iVBORw0KGgo=")
    expect(back.draft.skills).toEqual([{ id: "sk", name: "deploy" }])
  })

  test("over the cap the inline pictures are left out and counted, paths stay", () => {
    const draft = { text: "x", files: [image(), path()], skills: [] }
    const { value, dropped } = serializeDraft(draft, 60)
    expect(dropped).toBe(1)
    expect(value.dropped).toBe(1)
    expect(value.files.map((f) => f.id)).toEqual(["a2"])
    const back = parseDraft(value)!
    expect(back.dropped).toBe(1)
    expect(back.draft.files.map((f) => f.id)).toEqual(["a2"])
  })

  test("a draft under the cap keeps everything", () => {
    const big = { text: "x".repeat(50), files: [image()], skills: [] }
    expect(serializeDraft(big).dropped).toBe(0)
    expect(JSON.stringify(serializeDraft(big).value).length).toBeLessThan(DRAFT_MAX_CHARS)
  })
})

describe("parseDraft", () => {
  test("junk is not a draft", () => {
    for (const raw of [undefined, null, "text", 3, {}, { v: 2, text: "x", files: [], skills: [] }, { v: 1, text: 1, files: [], skills: [] }, { v: 1, text: "x", files: "no", skills: [] }]) {
      expect(parseDraft(raw)).toBeUndefined()
    }
  })

  test("a record with nothing in it is not worth restoring", () => {
    expect(parseDraft({ v: 1, text: "   ", files: [], skills: [] })).toBeUndefined()
  })

  test("a broken file or skill entry is dropped, the rest is kept", () => {
    const back = parseDraft({
      v: 1,
      text: "hi",
      files: [{ id: "a1", uri: "file:///w/a.ts", name: "a.ts" }, { id: 2 }, { name: "no uri" }],
      skills: [{ id: "ok", name: "ok" }, { id: "" }, { name: "no id" }],
    })!
    expect(back.draft.files.map((f) => f.id)).toEqual(["a1"])
    expect(back.draft.skills).toEqual([{ id: "ok", name: "ok" }])
  })
})

describe("the store", () => {
  test("a draft written for a target is read back for it", () => {
    const { storage } = fakeStorage()
    const draft = { text: "hello", files: [image()], skills: [{ id: "sk", name: "s" }] }
    writeDraft(storage, "/w", "session:ses_1", draft)
    expect(loadDraft(storage, "/w", "session:ses_1")?.draft.text).toBe("hello")
    expect(loadDraft(storage, "/other", "session:ses_1")).toBeUndefined()
  })

  test("a draft typed in a fresh draft is found when a session opens first", () => {
    const { storage } = fakeStorage()
    writeDraft(storage, "/w", "draft", { text: "still typing", files: [], skills: [] })
    const restored = loadDraft(storage, "/w", "session:ses_1")
    expect(restored?.draft.text).toBe("still typing")
    expect(restored?.target).toBe("draft")
  })

  test("an empty draft is a tombstone: nothing comes back after a send", () => {
    const { storage, map } = fakeStorage()
    writeDraft(storage, "/w", "session:ses_1", { text: "sent", files: [], skills: [] })
    writeDraft(storage, "/w", "session:ses_1", emptyPromptDraft())
    expect(map.get(draftDataKey("/w", "session:ses_1"))).toBeNull()
    expect(loadDraft(storage, "/w", "session:ses_1")).toBeUndefined()
    expect(draftHasContent(emptyPromptDraft())).toBe(false)
  })

  test("clearing one target leaves the other alone", () => {
    const { storage } = fakeStorage()
    writeDraft(storage, "/w", "draft", { text: "keep", files: [], skills: [] })
    clearDraft(storage, "/w", "session:ses_1")
    expect(loadDraft(storage, "/w", "draft")?.draft.text).toBe("keep")
  })

  test("a restored draft says how many pictures were left out", () => {
    const { storage } = fakeStorage()
    writeDraft(storage, "/w", "draft", { text: "see", files: [image()], skills: [] })
    // Rewrite the stored record as if it had been saved over the cap.
    const { value } = serializeDraft({ text: "see", files: [image()], skills: [] }, 40)
    storage.set(draftDataKey("/w", "draft"), value)
    expect(loadDraft(storage, "/w", "draft")?.dropped).toBe(1)
  })
})

describe("draftSignature", () => {
  test("the same content has the same signature", () => {
    const a = { text: "hi", files: [path()], skills: [{ id: "sk", name: "s" }] }
    expect(draftSignature(a)).toBe(draftSignature({ text: "hi", files: [path()], skills: [{ id: "sk", name: "s" }] }))
  })

  test("text, files and skills all change it", () => {
    const base = { text: "hi", files: [path()], skills: [{ id: "sk", name: "s" }] }
    expect(draftSignature({ ...base, text: "hi!" })).not.toBe(draftSignature(base))
    expect(draftSignature({ ...base, files: [] })).not.toBe(draftSignature(base))
    expect(draftSignature({ ...base, skills: [] })).not.toBe(draftSignature(base))
  })
})
