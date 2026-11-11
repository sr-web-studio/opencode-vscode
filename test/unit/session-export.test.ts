import { describe, expect, test } from "bun:test"
import { commandBlock } from "@occ/core/slash"
import { exportFileName, exportJson, exportMarkdown, titlecase, type ExportMessage, type ExportSession } from "@occ/core/session-export"

const session: ExportSession = { id: "ses_1234567890", title: "Fix the login form", time: { created: 1_700_000_000_000, updated: 1_700_000_060_000 } }
const at = (ms: number) => `T${ms}`

const user = (id: string, created: number, text: string): ExportMessage => ({ id, type: "user", time: { created }, text })

const assistant = (id: string, created: number, completed: number, content: ExportMessage["content"]): ExportMessage => ({
  id,
  type: "assistant",
  time: { created, completed },
  agent: "build",
  model: { id: "claude-opus-5-5", providerID: "cli-proxy-api" },
  content,
})

describe("exportMarkdown", () => {
  test("the header and a user turn, like OpenCode's TUI", () => {
    const md = exportMarkdown(session, [user("m1", 1, "Hello there")], { formatDate: at })
    expect(md).toBe(
      "# Fix the login form\n\n" + "**Session ID:** ses_1234567890\n" + "**Created:** T1700000000000\n" + "**Updated:** T1700000060000\n\n" + "---\n\n" + "## User\n\nHello there\n\n" + "---\n\n",
    )
  })

  test("the assistant heading carries the agent, model name and duration", () => {
    const md = exportMarkdown(session, [assistant("a1", 1_000, 2_500, [{ type: "text", text: "Done." }])], {
      formatDate: at,
      modelName: () => "Claude Opus 5.5",
    })
    expect(md).toContain("## Assistant (Build · Claude Opus 5.5 · 1.5s)\n\nDone.\n\n")
  })

  test("falls back to the model id when no name is known, and omits the duration while running", () => {
    const md = exportMarkdown(session, [{ id: "a1", type: "assistant", time: { created: 1 }, agent: "plan", model: { id: "m-1" }, content: [] }], {
      formatDate: at,
    })
    expect(md).toContain("## Assistant (Plan · m-1)\n\n")
  })

  test("reasoning is a Thinking block; it can be left out", () => {
    const messages = [
      assistant("a1", 1, 2, [
        { type: "reasoning", text: "Let me think" },
        { type: "text", text: "Answer" },
      ]),
    ]
    expect(exportMarkdown(session, messages, { formatDate: at })).toContain("_Thinking:_\n\nLet me think\n\nAnswer\n\n")
    expect(exportMarkdown(session, messages, { formatDate: at, thinking: false })).not.toContain("Let me think")
  })

  test("a tool call shows its input, output or error in OpenCode's block", () => {
    const messages = [
      assistant("a1", 1, 2, [
        { type: "tool", name: "read", state: { status: "completed", input: { path: "a.ts" }, content: [{ type: "text", text: "file body" }] } },
        { type: "tool", name: "shell", state: { status: "error", input: { command: "false" }, error: { message: "exit 1" } } },
      ]),
    ]
    const md = exportMarkdown(session, messages, { formatDate: at })
    expect(md).toContain('**Tool: read**\n\n**Input:**\n```json\n{\n  "path": "a.ts"\n}\n```\n\n**Output:**\n```\nfile body\n```\n\n')
    expect(md).toContain('**Tool: shell**\n\n**Input:**\n```json\n{\n  "command": "false"\n}\n```\n\n**Error:**\n```\nexit 1\n```\n\n')
  })

  test("tool details can be left out", () => {
    const messages = [assistant("a1", 1, 2, [{ type: "tool", name: "read", state: { status: "completed", input: { path: "a.ts" } } }])]
    expect(exportMarkdown(session, messages, { formatDate: at, toolDetails: false })).not.toContain("**Input:**")
  })

  test("only user and assistant messages appear, in time order", () => {
    const messages: ExportMessage[] = [
      { id: "i1", type: "idle", time: { created: 2 } },
      { id: "c1", type: "compaction", time: { created: 3 } },
      user("m2", 4, "second"),
      { id: "s1", type: "synthetic", time: { created: 5 }, text: "shell output" },
      user("m1", 1, "first"),
    ]
    const md = exportMarkdown(session, messages, { formatDate: at })
    expect(md.indexOf("first")).toBeLessThan(md.indexOf("second"))
    expect(md).not.toContain("shell output")
    expect(md.match(/## User/g)).toHaveLength(2)
  })

  test("a session without a title uses its id", () => {
    expect(exportMarkdown({ ...session, title: undefined }, [], { formatDate: at }).startsWith("# ses_1234567890\n")).toBe(true)
  })

  test("titlecase matches OpenCode's Locale.titlecase", () => {
    expect(titlecase("build")).toBe("Build")
    expect(titlecase("general-purpose")).toBe("General-Purpose")
  })
})

describe("exportJson", () => {
  test("info plus every message, two-space JSON and a final newline", () => {
    const messages = [user("m1", 1, "hi")]
    const json = exportJson(session, messages)
    expect(json).toBe(`${JSON.stringify({ info: session, messages }, null, 2)}\n`)
    expect(JSON.parse(json)).toEqual({ info: session, messages })
  })
})

describe("exportFileName", () => {
  test("Markdown follows the TUI: session and the first 8 characters of the id", () => {
    expect(exportFileName(session, "markdown")).toBe("session-ses_1234.md")
  })

  test("JSON follows the web export: a slug of the title", () => {
    expect(exportFileName({ id: "ses_1", title: "Clone PR in worktree from fork" }, "json")).toBe("clone-pr-in-worktree-from-fork.json")
  })

  test("JSON falls back to the id when there is no usable title", () => {
    expect(exportFileName({ id: "ses_1" }, "json")).toBe("ses_1.json")
    expect(exportFileName({ id: "ses_1", title: "  " }, "json")).toBe("ses_1.json")
  })

  test("JSON uses the slug before the id, like the web export", () => {
    expect(exportFileName({ id: "ses_1", slug: "quiet-harbor" }, "json")).toBe("quiet-harbor.json")
    expect(exportFileName({ id: "ses_1", title: "A title", slug: "quiet-harbor" }, "json")).toBe("a-title.json")
  })
})

describe("/export needs a session", () => {
  test("says so before there is one", () => {
    const ctx = { hasSession: false, running: false, revertStaged: false, canRevert: true }
    expect(commandBlock("export", ctx)).toBe("Nothing to export yet.")
    expect(commandBlock("export", { ...ctx, hasSession: true })).toBeUndefined()
  })
})
