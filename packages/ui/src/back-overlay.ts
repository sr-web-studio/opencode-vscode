/**
 * A closable overlay (the session tabs' dropdown) tells the host shell it is open, so a hardware Back button can close
 * it before anything else. Only a shell with such a button (the Android app) calls `closeBackOverlay`; elsewhere the
 * registry is simply never read.
 */
let closers: Array<() => void> = []

/** Register a function that closes an open overlay. Returns the function that unregisters it. */
export function registerBackOverlay(close: () => void): () => void {
  closers.push(close)
  return () => {
    closers = closers.filter((fn) => fn !== close)
  }
}

/** Whether some overlay is open and would close on Back. */
export const hasBackOverlay = (): boolean => closers.length > 0

/** Close the most recently opened overlay. False when none is open. */
export function closeBackOverlay(): boolean {
  const close = closers.at(-1)
  if (!close) return false
  close()
  return true
}
