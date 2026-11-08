import { describe, expect, test } from "bun:test"
import { applyEvent, viewFromMessages } from "@occ/core/transcript/reducer"
import { emptyView, type SessionView, type ToolItem } from "@occ/core/transcript/types"
import { summarizeTool } from "@occ/core/transcript/tools"
import { STOPPED_COMMAND, isStoppedCommand, toolErrorText } from "@occ/core/transcript/tool-error"

const tools = (v: SessionView): ToolItem[] => v.turns.flatMap((t) => t.steps.flatMap((s) => s.items.filter((i): i is ToolItem => i.kind === "tool")))
const ev = (type: string, data: Record<string, unknown>, created = 1000) => ({ type, created, data }) as any

/** What the server sends when a running `shell` call loses its shell (the Stop of the terminal view). */
const stoppedFailure = (message: string) => ev("session.tool.failed", { assistantMessageID: "a1", id: "t1", error: { type: "unknown", message } })

function live(message: string): SessionView {
  let v = emptyView()
  v = applyEvent(v, ev("session.prompted", { sessionID: "s", messageID: "u1", prompt: { text: "run it" } }))
  v = applyEvent(v, ev("session.step.started", { assistantMessageID: "a1", agent: "build", started: 1000 }))
  v = applyEvent(v, ev("session.tool.input.started", { assistantMessageID: "a1", id: "t1", name: "shell" }))
  v = applyEvent(v, ev("session.tool.called", { assistantMessageID: "a1", id: "t1", input: { command: "sleep 120" } }))
  return applyEvent(v, stoppedFailure(message))
}

describe("a command the user stopped", () => {
  test("the bare Shell.NotFoundError becomes a calm sentence (live event)", () => {
    const [t] = tools(live("Shell.NotFoundError"))
    expect(t!.status).toBe("error")
    expect(t!.error).toBe(STOPPED_COMMAND)
  })

  test("the same from history", () => {
    const v = viewFromMessages([
      { id: "u1", type: "user", text: "run it", time: { created: 1 } },
      { id: "a1", type: "assistant", content: [{ type: "tool", id: "t1", name: "shell", time: { created: 1, completed: 2 }, state: { status: "error", input: { command: "sleep 120" }, error: { type: "unknown", message: "Shell.NotFoundError" } } }] },
    ] as any)
    const t = tools(v).find((x) => x.name === "shell")
    expect(t?.error).toBe(STOPPED_COMMAND)
  })

  test("the row says `stopped`, muted, not a red cross", () => {
    const [t] = tools(live("Shell.NotFoundError"))
    const line = summarizeTool(t!, "/w")
    expect(line.result).toBe("stopped")
    expect(line.tone).toBe("muted")
  })

  test("every other failure keeps its text and the red tone", () => {
    for (const message of ["Command cancelled", "Tool execution interrupted", "ENOENT: no such file", "Shell.NotFoundError: sh_1 was removed"]) {
      const [t] = tools(live(message))
      expect(t!.error).toBe(message)
      const line = summarizeTool(t!, "/w")
      expect(line.tone).toBe("error")
      expect(line.result.startsWith("✗")).toBe(true)
    }
  })

  test("toolErrorText: only the exact bare name is mapped (case and spacing tolerant)", () => {
    expect(toolErrorText("Shell.NotFoundError")).toBe(STOPPED_COMMAND)
    expect(toolErrorText("  ShellNotFoundError \n")).toBe(STOPPED_COMMAND)
    expect(toolErrorText("Session.NotFoundError")).toBe("Session.NotFoundError")
    expect(toolErrorText(undefined)).toBeUndefined()
    expect(isStoppedCommand(STOPPED_COMMAND)).toBe(true)
    expect(isStoppedCommand("Command cancelled")).toBe(false)
  })
})
