import { canTakeFocus, type FocusEnv } from "../core/focus"

const isEditable = (el: Element | null): boolean =>
  !!el &&
  (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable === true)

/** The facts `shouldFocusPrompt` needs, read from the DOM. `target` itself (or anything inside it) is not "another" input. */
export function readFocusEnv(target?: Element | null): FocusEnv {
  const active = document.activeElement
  return {
    webviewFocused: document.hasFocus(),
    otherEditableActive: isEditable(active) && active !== target && !target?.contains(active),
  }
}

/**
 * The only way UI code moves focus. Does nothing while the editor, terminal or another panel has the keyboard,
 * or while another input of this view is being typed in.
 */
export function focusGuarded(el: HTMLElement | null | undefined): boolean {
  if (!el || !canTakeFocus(readFocusEnv(el))) return false
  el.focus()
  return true
}

/**
 * Focus now if allowed. Otherwise wait briefly for this webview itself to receive focus (a view command that is
 * just revealing us) and focus then. It never takes focus from anywhere else. Returns a cancel function.
 */
export function focusWhenAllowed(get: () => HTMLElement | null | undefined, waitMs = 1500): () => void {
  if (focusGuarded(get())) return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    window.removeEventListener("focus", onFocus)
    if (timer) clearTimeout(timer)
  }
  const onFocus = () => {
    stop()
    focusGuarded(get())
  }
  window.addEventListener("focus", onFocus)
  timer = setTimeout(stop, waitMs)
  return stop
}
