/**
 * When may the prompt box take keyboard focus?
 *
 * Moving focus is something only an explicit user action inside our view may cause. State updates from the host
 * (streaming, status, heartbeats, reconnects) must never do it, and nothing may pull focus out of the editor, the
 * terminal, another panel or another input of this view.
 */

export type FocusEnv = {
  /** `document.hasFocus()`. False while the editor, terminal or another panel owns the keyboard. */
  webviewFocused: boolean
  /** Another input, textarea, select or contenteditable of this webview is the active element. */
  otherEditableActive: boolean
}

export const canTakeFocus = (env: FocusEnv): boolean => env.webviewFocused && !env.otherEditableActive

/**
 * `prev`/`next` are the values of a request counter (it only grows when something explicitly asks for focus).
 * An unchanged counter, or the very first value we see (`prev` undefined), never focuses.
 */
export const shouldFocusPrompt = (prev: number | undefined, next: number, env: FocusEnv): boolean => prev !== undefined && next !== prev && canTakeFocus(env)
