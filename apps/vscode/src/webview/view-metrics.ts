import type { WebviewMetrics } from "@occ/core/protocol"

/** Resize events come in bursts; one report after the burst is enough for the host's width check. */
const RESIZE_DEBOUNCE_MS = 100

/**
 * Report the webview's width, focus and screen width to the host on load, on resize (debounced) and on focus/blur.
 * The host uses it for a best-effort minimum width; nothing here changes the UI, and the Android app never runs it.
 */
export function reportViewMetrics(post: (message: WebviewMetrics) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const send = (): void => {
    post({
      type: "viewMetrics",
      width: Math.round(window.innerWidth),
      focused: document.hasFocus(),
      screenWidth: Math.round(window.screen?.availWidth ?? 0),
    })
  }

  const onResize = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      send()
    }, RESIZE_DEBOUNCE_MS)
  }
  const onFocus = (): void => send()
  const onBlur = (): void => send()

  window.addEventListener("resize", onResize)
  window.addEventListener("focus", onFocus)
  window.addEventListener("blur", onBlur)
  // After the first layout, so `innerWidth` is the real view width.
  requestAnimationFrame(send)

  return () => {
    window.removeEventListener("resize", onResize)
    window.removeEventListener("focus", onFocus)
    window.removeEventListener("blur", onBlur)
    if (timer) clearTimeout(timer)
  }
}
