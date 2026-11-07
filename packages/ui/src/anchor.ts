import { tick } from "svelte"
import { anchoredScrollTop } from "@occ/core/scroll"

/**
 * Run a layout-changing toggle while keeping `target` (the clicked element) where it was on screen, so expanding or
 * collapsing never makes the view jump. The scroll box is the nearest ancestor marked `data-scroll-box`.
 */
export async function keepAnchored(target: Element | null, change: () => void): Promise<void> {
  const box = target?.closest<HTMLElement>("[data-scroll-box]")
  if (!target || !box) {
    change()
    return
  }
  const before = target.getBoundingClientRect().top
  change()
  await tick()
  const after = target.getBoundingClientRect().top
  if (after !== before) box.scrollTop = anchoredScrollTop(box.scrollTop, before, after)
}
