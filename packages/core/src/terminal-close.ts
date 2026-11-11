/**
 * What a mirrored terminal's close does. Pure: the extension host reads VS Code's exit reason and applies the answer.
 *
 * Closing a terminal never stops the command: it runs on the OpenCode server, and "Show terminal" attaches again.
 * Only the user closing the tab is told once that the command is still running. A shutdown, a window reload, an
 * extension dispose and our own `trim()` close silently.
 */

/** Why a terminal closed. `extension` also covers our own `dispose()` and `trim()`. */
export type TerminalCloseCause = "user" | "shutdown" | "extension" | "unknown"

/** `notify` shows a non-modal information message; `silent` does nothing. A close never asks and never stops. */
export type TerminalCloseAction = "notify" | "silent"

export const TERMINAL_CLOSE_NOTICE = "The command keeps running on the server. Use Show terminal on the tool line to see it again."

export function terminalCloseAction(input: { running: boolean; cause: TerminalCloseCause }): TerminalCloseAction {
  return input.running && input.cause === "user" ? "notify" : "silent"
}
