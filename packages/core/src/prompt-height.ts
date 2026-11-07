/**
 * Height of the auto-growing prompt box. Pure, so the rounding rules are tested without a DOM.
 *
 * `scrollHeight` is a rounded integer while a 1.6 line height is fractional (22.4px), so a height of exactly
 * `lines * lineHeight` can end up 1px short of the content and flash a scrollbar. The height is therefore rounded up,
 * and the scrollbar only appears when the content is clearly (more than `TOLERANCE_PX`) taller than the maximum.
 */
export const TOLERANCE_PX = 2

/** Used when the computed line height is not a number (`normal`) or not positive. */
const FALLBACK_LINE_PX = 20

export type PromptHeightInput = {
  /** `scrollHeight` of the textarea measured with its height reset to `auto` (content box, no padding or border). */
  scrollHeight: number
  /** Line height in px; may be fractional. */
  lineHeight: number
  minLines: number
  maxLines: number
}

export type PromptHeight = { height: number; overflow: "hidden" | "auto" }

export function promptHeight({ scrollHeight, lineHeight, minLines, maxLines }: PromptHeightInput): PromptHeight {
  const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : FALLBACK_LINE_PX
  const content = Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : 0
  const min = Math.ceil(line * minLines)
  const max = Math.max(min, Math.ceil(line * maxLines))
  return {
    height: Math.min(Math.max(Math.ceil(content), min), max),
    overflow: content > max + TOLERANCE_PX ? "auto" : "hidden",
  }
}
