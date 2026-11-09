/**
 * Best-effort minimum width for the chat view. VS Code exposes no API or setting for the secondary side bar width, so
 * the host nudges it with `workbench.action.increaseViewSize` while the webview has focus. Everything here is pure and
 * testable; the timers and commands live in `apps/vscode/src/extension/min-width.ts`.
 */

/** `workbench.action.increaseViewSize` grows the focused part by this many CSS pixels. */
export const MIN_WIDTH_STEP_PX = 60
/** Never send more than this many increase commands in one window session. */
export const MIN_WIDTH_MAX_STEPS = 4
/** A step that grew the view by less than this means it is not working (or it hit a limit); stop. */
export const MIN_WIDTH_MIN_GROWTH_PX = 10

export type MinWidthPlanInput = {
  /** `opencode.view.minWidth`; 0 or less turns the feature off. */
  minWidth: number
  /** The webview's width when the view became visible. */
  width: number
  /** `screen.availWidth`; 0 when the webview could not report it. */
  screenWidth: number
  /** The routine already ran, or the user resized the view: never try again in this window session. */
  ran: boolean
}

export type MinWidthPlan = { kind: "already-ran" } | { kind: "off" } | { kind: "wide-enough" } | { kind: "over-half-screen" } | { kind: "start"; maxSteps: number }

/**
 * Whether the minimum-width routine should start, and how many increase steps it may use. The cap is
 * `min(4, ceil((minWidth - width) / 60))`; the half-screen cap protects a view that is already large.
 */
export function planMinWidth(input: MinWidthPlanInput): MinWidthPlan {
  if (input.ran) return { kind: "already-ran" }
  if (!Number.isFinite(input.minWidth) || input.minWidth <= 0) return { kind: "off" }
  if (input.screenWidth > 0 && input.width > input.screenWidth / 2) return { kind: "over-half-screen" }
  if (input.width >= input.minWidth) return { kind: "wide-enough" }
  const maxSteps = Math.min(MIN_WIDTH_MAX_STEPS, Math.ceil((input.minWidth - input.width) / MIN_WIDTH_STEP_PX))
  return { kind: "start", maxSteps: Math.max(1, maxSteps) }
}

export type MinWidthStepInput = {
  /** `opencode.view.minWidth`, read again in case the user changed it mid-run. */
  minWidth: number
  /** The latest reported width. */
  width: number
  /** The width before the last increase command. */
  before: number
  /** Increase commands already run. */
  steps: number
  /** How many this routine may run. */
  maxSteps: number
  /** The webview still has focus. */
  focused: boolean
  /** `screen.availWidth`; 0 when unknown. */
  screenWidth: number
}

export type MinWidthStep = { kind: "done"; reason: "reached" } | { kind: "step" } | { kind: "stop"; reason: "over-half-screen" | "unfocused" | "no-growth" | "max-steps" }

/**
 * What to do after a step. Success first: a view that reached the minimum is done even if focus moved on. The
 * half-screen cap, a lost focus, no growth and the step cap each abort the rest of the run.
 */
export function nextMinWidthStep(input: MinWidthStepInput): MinWidthStep {
  if (input.screenWidth > 0 && input.width > input.screenWidth / 2) return { kind: "stop", reason: "over-half-screen" }
  if (input.width >= input.minWidth) return { kind: "done", reason: "reached" }
  if (!input.focused) return { kind: "stop", reason: "unfocused" }
  if (input.width - input.before < MIN_WIDTH_MIN_GROWTH_PX) return { kind: "stop", reason: "no-growth" }
  if (input.steps >= input.maxSteps) return { kind: "stop", reason: "max-steps" }
  return { kind: "step" }
}
