import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { toolIcon } from "@occ/core/transcript/icons"

describe("toolIcon", () => {
  test("known tools, MCP tools and unknown tools", () => {
    expect(toolIcon("shell")).toBe("terminal")
    expect(toolIcon("read")).toBe("go-to-file")
    expect(toolIcon("subagent")).toBe("robot")
    expect(toolIcon("exa_web_search_exa")).toBe("tools")
  })
  test("every icon used exists in the bundled codicon font", () => {
    const csv = readFileSync(require.resolve("@vscode/codicons/dist/codicon.csv"), "utf8")
    const names = new Set(csv.split("\n").map((l) => l.split(",")[0]))
    for (const tool of [
      "read",
      "write",
      "edit",
      "patch",
      "shell",
      "grep",
      "glob",
      "subagent",
      "question",
      "webfetch",
      "websearch",
      "skill",
      "execute",
      "todowrite",
      "experimental_image_generate",
      "other",
    ]) {
      expect(names.has(toolIcon(tool))).toBe(true)
    }
  })
})
