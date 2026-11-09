import * as vscode from "vscode"
import { nextMinWidthStep, planMinWidth } from "@occ/core/min-width"
import type { WebviewMetrics } from "@occ/core/protocol"

/** `workbench.action.increaseViewSize` is a layout command; a short gap lets the webview report the new width. */
export const MIN_WIDTH_STEP_MS = 150
/** How long to wait for the webview to report focus after `opencode.chat.focus`. */
export const MIN_WIDTH_FOCUS_MS = 1_000

/**
 * Best-effort minimum width for the chat view. VS Code has no API for the secondary side bar width, so this asks the
 * focused webview to grow with `workbench.action.increaseViewSize` a few times. It runs at most once per window
 * session, only when the view is revealed, and gives up on the first sign that the user is in control. The decision
 * logic itself is pure (`@occ/core/min-width`); this class only owns the timers and the commands.
 */
export class MinWidth implements vscode.Disposable {
  private visible = false
  /** The routine ran, gave up, or the user resized the view: never try again in this window session. */
  private ran = false
  private started = false
  private awaiting = false
  private pendingFocus = false
  private focused = false
  private width?: number
  /** True when `width` was reported while the view was visible (not a stale size from while it was hidden). */
  private widthVisible = false
  private screenWidth = 0
  private maxSteps = 0
  private steps = 0
  private before = 0
  private stepTimer?: ReturnType<typeof setTimeout>
  private focusTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly log: (line: string) => void) {}

  /** The chat view was resolved, revealed or hidden. A reveal is the only moment the routine may start. */
  noteVisible(visible: boolean): void {
    this.visible = visible
    if (!visible) {
      this.widthVisible = false
      if (this.started) this.finish("hidden")
      return
    }
    // Only a size reported while the view was visible counts; a reveal without a new report waits for one.
    if (!this.ran && this.widthVisible) this.maybeStart()
  }

  /** The webview's own size and focus report. */
  metrics(metrics: WebviewMetrics): void {
    const previous = this.widthVisible ? this.width : undefined
    this.width = metrics.width
    this.widthVisible = this.visible
    this.focused = metrics.focused
    this.screenWidth = metrics.screenWidth

    if (this.ran || !this.visible) return

    if (!this.started) {
      // A width change before the routine began means the user already resized the view: leave it alone.
      if (previous !== undefined && previous !== metrics.width) this.finish("user-resize")
      else this.maybeStart()
      return
    }

    if (this.pendingFocus) {
      if (metrics.focused) {
        this.clearFocusTimer()
        this.pendingFocus = false
        this.step()
      } else if (previous !== undefined && previous !== metrics.width) {
        this.finish("user-resize")
      }
      return
    }

    // A step is in flight: its timer decides, but a blur is an immediate abort.
    if (this.awaiting && !metrics.focused) this.finish("unfocused")
  }

  dispose(): void {
    this.clearStepTimer()
    this.clearFocusTimer()
  }

  private maybeStart(): void {
    if (this.ran || this.started || !this.visible || !this.widthVisible || this.width === undefined || this.width <= 0) return
    const minWidth = this.minWidth()
    const plan = planMinWidth({ minWidth, width: this.width, screenWidth: this.screenWidth, ran: this.ran })
    if (plan.kind !== "start") {
      this.finish(plan.kind)
      return
    }
    this.started = true
    this.maxSteps = plan.maxSteps
    this.steps = 0
    this.before = this.width
    if (this.focused) this.step()
    else this.focus()
  }

  private focus(): void {
    this.pendingFocus = true
    void vscode.commands.executeCommand("opencode.chat.focus").then(undefined, () => undefined)
    this.focusTimer = setTimeout(() => {
      this.focusTimer = undefined
      if (this.pendingFocus) this.finish("focus-timeout")
    }, MIN_WIDTH_FOCUS_MS)
  }

  private step(): void {
    if (this.ran || !this.started) return
    if (this.steps >= this.maxSteps) {
      this.finish("max-steps")
      return
    }
    this.before = this.width ?? this.before
    this.steps++
    this.awaiting = true
    void vscode.commands.executeCommand("workbench.action.increaseViewSize").then(undefined, () => undefined)
    this.clearStepTimer()
    this.stepTimer = setTimeout(() => {
      this.stepTimer = undefined
      this.check()
    }, MIN_WIDTH_STEP_MS)
  }

  private check(): void {
    if (this.ran || !this.started || this.width === undefined) return
    this.awaiting = false
    const next = nextMinWidthStep({
      minWidth: this.minWidth(),
      width: this.width,
      before: this.before,
      steps: this.steps,
      maxSteps: this.maxSteps,
      focused: this.focused,
      screenWidth: this.screenWidth,
    })
    if (next.kind === "step") this.step()
    else this.finish(next.reason)
  }

  /** The setting is read directly: its schema entry belongs to the settings page, not to this feature. */
  private minWidth(): number {
    return vscode.workspace.getConfiguration("opencode").get<number>("view.minWidth", 380)
  }

  private finish(reason: string): void {
    if (this.ran) return
    const attempted = this.started
    this.ran = true
    this.started = false
    this.awaiting = false
    this.pendingFocus = false
    this.clearStepTimer()
    this.clearFocusTimer()
    // One line per attempt, and none when the feature is off or the view was already wide enough.
    if (attempted) this.log(`Min width: ${reason}; the chat view is ${this.width ?? "?"}px wide after ${this.steps} step${this.steps === 1 ? "" : "s"}`)
  }

  private clearStepTimer(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer)
    this.stepTimer = undefined
  }

  private clearFocusTimer(): void {
    if (this.focusTimer) clearTimeout(this.focusTimer)
    this.focusTimer = undefined
  }
}
