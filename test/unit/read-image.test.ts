import { describe, expect, test } from "bun:test"
import { applyEvent, viewFromMessages } from "@occ/core/transcript/reducer"
import { MAX_INLINE_IMAGE_CHARS, rowAction, summarizeTool, toolAttachments } from "@occ/core/transcript/tools"
import { emptyView, type SessionView, type ToolItem } from "@occ/core/transcript/types"

/** A 1×1 PNG, the same shape the server sends for a read picture (a `file` content part with a data URI). */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const PATH = "/tmp/opencode/occ-test/pic.png"

const readContent = (uri = PNG, mime = "image/png") => [
  { type: "text", text: "Image read successfully" },
  { type: "file", uri, mime, name: PATH },
]

const tools = (v: SessionView): ToolItem[] => v.turns.flatMap((t) => t.steps.flatMap((s) => s.items.filter((i): i is ToolItem => i.kind === "tool")))

/** OpenCode 2.2.5 `message.list` shape of a read tool that returned an image. */
const history = (content = readContent()) => [
  { id: "u1", type: "user", text: "Read the picture", time: { created: 1 } },
  {
    id: "a1",
    type: "assistant",
    time: { created: 2 },
    content: [{ type: "tool", id: "t1", name: "read", state: { status: "completed", input: { path: PATH }, metadata: { truncated: false }, content } }],
  },
  { id: "i1", type: "idle", outcome: "succeeded", time: { created: 3 } },
]

const ev = (type: string, data: any, created = 1000) => ({ type, created, data })

describe("a read of an image", () => {
  test("history keeps the picture the tool returned, not just its text", () => {
    const tool = tools(viewFromMessages(history() as any))[0]!
    expect(tool.output).toBe("Image read successfully")
    expect(tool.attachments).toEqual([{ mime: "image/png", name: PATH, uri: PNG }])
  })

  test("a live tool result keeps the picture too", () => {
    let v = emptyView()
    v = applyEvent(v, ev("session.step.started", { assistantMessageID: "a1" }))
    v = applyEvent(v, ev("session.tool.input.started", { assistantMessageID: "a1", id: "t1", name: "read" }))
    v = applyEvent(v, ev("session.tool.called", { assistantMessageID: "a1", id: "t1", input: { path: PATH } }))
    v = applyEvent(v, ev("session.tool.success", { assistantMessageID: "a1", id: "t1", content: readContent(), metadata: { truncated: false } }))
    const tool = tools(v)[0]!
    expect(tool.status).toBe("completed")
    expect(tool.attachments).toEqual([{ mime: "image/png", name: PATH, uri: PNG }])
  })

  test("the row still opens the file the agent read", () => {
    const tool = tools(viewFromMessages(history() as any))[0]!
    const line = summarizeTool(tool, "/tmp/opencode/occ-test")
    expect(line.target).toBe("pic.png")
    expect(rowAction(tool, "/tmp/opencode/occ-test")).toEqual({ kind: "file", path: PATH })
  })

  test("a too-large picture still opens from the row", () => {
    const big = `data:image/png;base64,${"A".repeat(MAX_INLINE_IMAGE_CHARS)}`
    const tool = tools(viewFromMessages(history(readContent(big)) as any))[0]!
    expect(tool.attachments).toEqual([{ mime: "image/png", name: PATH, tooLarge: true }])
    expect(rowAction(tool, "/tmp/opencode/occ-test")).toEqual({ kind: "file", path: PATH })
  })

  test("an absolute path outside the project is kept as the tool gave it", () => {
    const outside = "/home/me/shots/screen.png"
    const tool = tools(
      viewFromMessages([
        { id: "u1", type: "user", text: "look", time: { created: 1 } },
        {
          id: "a1",
          type: "assistant",
          content: [{ type: "tool", id: "t1", name: "read", state: { status: "completed", input: { path: outside }, content: readContent() } }],
        },
      ] as any),
    )[0]!
    expect(rowAction(tool, "/tmp/opencode/occ-test")).toEqual({ kind: "file", path: outside })
  })
})

describe("toolAttachments", () => {
  test("only well-formed inline image files are kept", () => {
    expect(toolAttachments([{ type: "text", text: "ok" }])).toBeUndefined()
    expect(toolAttachments([{ type: "file", uri: PNG, mime: "application/pdf" }])).toBeUndefined()
    expect(toolAttachments([{ type: "file", uri: "file:///tmp/pic.png", mime: "image/png" }])).toBeUndefined()
    expect(toolAttachments([{ type: "file", uri: "data:text/plain;base64,AAAA", mime: "text/plain" }])).toBeUndefined()
  })

  test("the mime can come from the data URI and SVG is an image", () => {
    const svg = "data:image/svg+xml;base64,PHN2Zy8+"
    expect(toolAttachments([{ type: "file", uri: svg, name: "icon.svg" }])).toEqual([{ mime: "image/svg+xml", name: "icon.svg", uri: svg }])
  })

  test("a picture too big to keep inline is left to the file viewer", () => {
    const big = `data:image/png;base64,${"A".repeat(MAX_INLINE_IMAGE_CHARS)}`
    expect(toolAttachments([{ type: "file", uri: big, mime: "image/png", name: PATH }])).toEqual([{ mime: "image/png", name: PATH, tooLarge: true }])
  })

  test("a picture at the cap keeps its bytes", () => {
    const header = "data:image/png;base64,"
    const at = header + "A".repeat(MAX_INLINE_IMAGE_CHARS - header.length)
    expect(toolAttachments([{ type: "file", uri: at, mime: "image/png" }])).toEqual([{ mime: "image/png", uri: at }])
  })

  test("no content is not a list", () => {
    expect(toolAttachments(undefined)).toBeUndefined()
    expect(toolAttachments("text")).toBeUndefined()
  })
})
