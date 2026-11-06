/** Codicon name for a tool (the `codicon-<name>` class). Unknown and MCP tools get a neutral icon. */
const ICONS: Record<string, string> = {
  read: "go-to-file",
  write: "new-file",
  edit: "edit",
  patch: "diff",
  shell: "terminal",
  grep: "search",
  glob: "list-tree",
  subagent: "robot",
  question: "question",
  webfetch: "globe",
  websearch: "globe",
  skill: "book",
  execute: "code",
  todowrite: "tasklist",
  experimental_image_generate: "file-media",
}

export const toolIcon = (name: string): string => ICONS[name] ?? "tools"
