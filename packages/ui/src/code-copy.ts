import { codeCopyText } from "@occ/core/code-block"

const RESET_MS = 1600
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

function show(btn: HTMLElement, state: "idle" | "done" | "failed") {
  const icon = btn.querySelector(".codicon")
  if (icon) icon.className = `codicon codicon-${state === "done" ? "check" : state === "failed" ? "error" : "copy"}`
  const label = state === "done" ? "Copied" : state === "failed" ? "Copy failed" : "Copy code"
  btn.title = label
  btn.dataset.state = state
}

/** Click on a code block's copy button: copy the exact code, flip the icon for a moment. */
export async function copyCodeBlock(btn: HTMLElement): Promise<void> {
  const code = btn.closest(".oc-code")?.querySelector("pre code")
  if (!code) return
  let ok = true
  try {
    await navigator.clipboard.writeText(codeCopyText(code.textContent ?? ""))
  } catch {
    ok = false
  }
  show(btn, ok ? "done" : "failed")
  clearTimeout(timers.get(btn))
  timers.set(
    btn,
    setTimeout(() => show(btn, "idle"), RESET_MS),
  )
}
