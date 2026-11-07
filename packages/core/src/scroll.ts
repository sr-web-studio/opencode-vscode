/**
 * Scroll behaviour of the transcript (Claude Code / ChatGPT style), as pure functions.
 *
 * - New content scrolls to the end only while the user is already there (within 40px).
 * - Scrolling up stops following. A jump button then shows, with a dot when new content arrived meanwhile.
 * - Sending a prompt, or clicking the button, resumes following.
 * - Expanding or collapsing keeps the clicked element where it was; prepending history keeps the view in place.
 */

export type Metrics = { scrollTop: number; clientHeight: number; scrollHeight: number }

export const NEAR_BOTTOM_PX = 40

export const distanceFromBottom = (m: Metrics): number => m.scrollHeight - m.scrollTop - m.clientHeight

export const isNearBottom = (m: Metrics, threshold = NEAR_BOTTOM_PX): boolean => distanceFromBottom(m) <= threshold

export type ScrollState = {
  /** Content changes move the view to the end. */
  follow: boolean
  /** New content arrived while the user was away from the end. */
  unseen: boolean
}

export const initialScroll: ScrollState = { follow: true, unseen: false }

export type ScrollEvent =
  | { type: "scrolled"; metrics: Metrics }
  | { type: "content"; metrics: Metrics }
  | { type: "sent" }
  | { type: "jump" }
  | { type: "reset" }

export type ScrollStep = { state: ScrollState; /** Move the view to the end now. */ scrollToEnd: boolean }

/** Next state, plus whether the view must move to the end. The caller does the actual scrolling. */
export function stepScroll(state: ScrollState, event: ScrollEvent): ScrollStep {
  switch (event.type) {
    case "scrolled": {
      const near = isNearBottom(event.metrics)
      return { state: { follow: near, unseen: near ? false : state.unseen }, scrollToEnd: false }
    }
    case "content":
      // Judge by the user's last intent (`follow`), not the metrics: growing content makes the distance large
      // before we have scrolled to it.
      return state.follow ? { state, scrollToEnd: true } : { state: { ...state, unseen: true }, scrollToEnd: false }
    case "sent":
    case "jump":
    case "reset":
      return { state: initialScroll, scrollToEnd: true }
  }
}

/** The jump button shows whenever the view is away from the end. */
export const showJump = (state: ScrollState): boolean => !state.follow

/** `scrollTop` after an element moved from `before` to `after` (both relative to the scroll box), so it stays put. */
export const anchoredScrollTop = (scrollTop: number, before: number, after: number): number => scrollTop + (after - before)

/** `scrollTop` after older content was added above: the visible part must not move. */
export const scrollTopAfterPrepend = (scrollTop: number, heightBefore: number, heightAfter: number): number =>
  scrollTop + (heightAfter - heightBefore)
