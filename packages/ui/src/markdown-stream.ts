/**
 * How often a streaming answer is re-rendered. `renderMarkdown` parses and sanitises the whole text so far, so doing it
 * for every delta is quadratic in the length of the answer. The finished text is always rendered at once.
 *
 * Kept apart from `markdown.ts`, which builds a sanitizer on load (it needs the DOM).
 */
export const STREAM_RENDER_MS = 250

/** Whether a new text must be rendered now: a finished answer at once, a streaming one at most every `STREAM_RENDER_MS`. */
export function renderDue(streaming: boolean, sinceMs: number): boolean {
  return !streaming || sinceMs >= STREAM_RENDER_MS
}
