import type { SessionView, ToolItem } from "./transcript/types"

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type TodoItem = { content: string; status: TodoStatus }

const STATUSES: ReadonlySet<string> = new Set<TodoStatus>(["pending", "in_progress", "completed", "cancelled"])

/**
 * Tool name and shape, captured live from OpenCode 2.2.5 with `experimental.todo` on (see
 * `test/fixtures/todowrite-live.json`): `todowrite`, input `{ todos: [{ content, status }] }`,
 * completed metadata `{ todos, truncated }`, output "Todos updated: 0/2 completed, 1 in progress, 1 pending. …".
 * In V2 the tool exists only when `experimental.todo` is true; this extension never changes that setting.
 */
export const TODO_TOOL = "todowrite"

/**
 * Mirrors the official TUI parser: entries without a non-empty string `content` are dropped,
 * an unknown status becomes `pending`.
 */
export function parseTodos(input: unknown): TodoItem[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((t): TodoItem[] => {
    if (!t || typeof t !== "object") return []
    const content = (t as { content?: unknown }).content
    if (typeof content !== "string" || !content) return []
    const status = (t as { status?: unknown }).status
    return [{ content, status: typeof status === "string" && STATUSES.has(status) ? (status as TodoStatus) : "pending" }]
  })
}

/** `state.input.todos`, falling back to `state.metadata.todos` when the input carries no list. */
export function todosOf(tool: Pick<ToolItem, "input" | "metadata">): TodoItem[] {
  return parseTodos(Array.isArray(tool.input.todos) ? tool.input.todos : tool.metadata.todos)
}

/** Todo list from the latest completed `todowrite` call in the session, or undefined if none was made. */
export function latestTodos(view: SessionView): TodoItem[] | undefined {
  for (let t = view.turns.length - 1; t >= 0; t--) {
    const steps = view.turns[t]!.steps
    for (let s = steps.length - 1; s >= 0; s--) {
      const items = steps[s]!.items
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!
        if (item.kind === "tool" && item.name === TODO_TOOL && (item as ToolItem).status === "completed") {
          return todosOf(item as ToolItem)
        }
      }
    }
  }
  return undefined
}

export type TodoSummary = {
  items: TodoItem[]
  done: number
  total: number
  current?: string
  /** 0..1 for the ring and bar. */
  progress: number
}

export function summarizeTodos(items: TodoItem[]): TodoSummary {
  const total = items.length
  const done = items.filter((t) => t.status === "completed").length
  const current = items.find((t) => t.status === "in_progress") ?? items.find((t) => t.status === "pending")
  return { items, done, total, current: current?.content, progress: total === 0 ? 0 : done / total }
}

/**
 * The bar is hidden when there is no list, the list is empty, or every item is finished
 * (completed or cancelled) and the turn has ended.
 */
export function todoBar(view: SessionView, running: boolean): TodoSummary | undefined {
  const items = latestTodos(view)
  if (!items || items.length === 0) return undefined
  const finished = items.every((t) => t.status === "completed" || t.status === "cancelled")
  if (finished && !running) return undefined
  return summarizeTodos(items)
}
