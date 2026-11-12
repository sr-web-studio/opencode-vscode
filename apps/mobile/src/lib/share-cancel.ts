/**
 * The share sheet's "canceled" rejection. Kept apart from `export-file.ts` so the decision can be unit-tested without
 * the Capacitor plugins (and without the DOM).
 */

/**
 * Whether a failed share was the user closing the sheet. Both of Capacitor's share plugins reject with exactly
 * "Share canceled" and no error code when the chooser is dismissed (Android: `SharePlugin.activityResult` on
 * `RESULT_CANCELED`; iOS: the activity controller completing with `completed == false`). That is a choice, not a
 * failure, so the app must not show an error for it. Every other rejection is a real error.
 */
export function isShareCancel(error: unknown): boolean {
  return /cancel/i.test(messageOf(error))
}

/** A rejection's message, whether it is an Error, a CapacitorException or a plain string. */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message
  return ""
}
