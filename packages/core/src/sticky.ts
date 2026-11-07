/**
 * The sticky prompt bar: which user prompt belongs to the text at the top edge of the transcript.
 *
 * The UI watches each prompt bubble with an IntersectionObserver and reports where it is relative to the scroll box.
 * Everything that decides what to show is here, as pure functions, so it is tested without a browser.
 */

export type PromptPosition = "above" | "visible" | "below"

type Box = { top: number; bottom: number }

/** Where a bubble is relative to the scroll box. Partly visible counts as visible; `above` means fully scrolled out at the top. */
export function promptPosition(rect: Box, root: Box, intersecting: boolean): PromptPosition {
  if (intersecting) return "visible"
  return rect.bottom <= root.top ? "above" : "below"
}

/**
 * The prompt of the turn under the top edge: the last prompt (in transcript order) that has scrolled out above.
 * Undefined when every prompt is visible or below (nothing to show), or when positions are not known yet.
 */
export function currentPrompt(order: readonly string[], positions: ReadonlyMap<string, PromptPosition>): string | undefined {
  for (let i = order.length - 1; i >= 0; i--) if (positions.get(order[i]!) === "above") return order[i]
  return undefined
}

/** One line for the bar: the prompt text with whitespace collapsed, else the attachment names. */
export function promptLabel(user: { text: string; files?: ReadonlyArray<{ name: string }> }): string {
  const text = user.text.replace(/\s+/g, " ").trim()
  if (text) return text
  const names = (user.files ?? []).map((f) => f.name).filter(Boolean)
  return names.length ? names.join(", ") : "(no text)"
}
