/**
 * Saves the prompt box draft through the bridge's persistent store a moment after the last edit, and at once when the
 * view is hidden, the page goes away or the window loses focus. The host store (VS Code webview state, the app's
 * localStorage) is what survives a webview that VS Code destroys while the view is not on screen.
 *
 * Pure enough to test: it only touches `document`/`window` in `listen`.
 */
import { clearDraft, draftSignature, writeDraft, type DraftStorage, type PromptDraft } from "@occ/core/prompt-draft"

type Snapshot = { folder: string; target: string; draft: PromptDraft; signature: string }

export const DRAFT_WRITE_DELAY = 300

export class DraftWriter {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Snapshot | undefined
  /** What was last written per folder, to skip unchanged writes and to clear a target the draft has moved away from. */
  private readonly last = new Map<string, { target: string; signature: string }>()

  constructor(
    private readonly storage: DraftStorage,
    private readonly delay = DRAFT_WRITE_DELAY,
  ) {}

  /** Note a change. A new folder or target is written at once, so a quick switch cannot lose it. */
  save(folder: string, target: string, draft: PromptDraft): void {
    if (!folder || !target) return
    const signature = draftSignature(draft)
    const last = this.last.get(folder)
    if (last && last.target === target && last.signature === signature) return
    if (this.pending && this.pending.folder === folder && this.pending.target === target && this.pending.signature === signature) return
    // A write for another folder or target must land before this one takes its place.
    if (this.pending) this.flush()
    this.pending = { folder, target, draft: { text: draft.text, files: [...draft.files], skills: [...draft.skills] }, signature }
    if (last && last.target !== target) this.flush()
    else this.timer ??= setTimeout(() => this.flush(), this.delay)
  }

  /** Write what is pending now. Safe to call at any time. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const p = this.pending
    if (!p) return
    this.pending = undefined
    const last = this.last.get(p.folder)
    // The draft moved to another target: the old copy would otherwise come back after a reload.
    if (last && last.target !== p.target) clearDraft(this.storage, p.folder, last.target)
    writeDraft(this.storage, p.folder, p.target, p.draft)
    this.last.set(p.folder, { target: p.target, signature: p.signature })
  }

  /**
   * Flush when the view may be about to be destroyed: hidden, page hidden or unloaded, or the window lost focus (the
   * phone going to the background). Returns the unsubscribe function.
   */
  listen(): () => void {
    if (typeof document === "undefined" || typeof window === "undefined") return () => {}
    const flush = () => this.flush()
    const visibility = () => {
      if (document.visibilityState === "hidden") flush()
    }
    document.addEventListener("visibilitychange", visibility)
    window.addEventListener("pagehide", flush)
    window.addEventListener("blur", flush)
    return () => {
      document.removeEventListener("visibilitychange", visibility)
      window.removeEventListener("pagehide", flush)
      window.removeEventListener("blur", flush)
    }
  }

  dispose(): void {
    this.flush()
  }
}
