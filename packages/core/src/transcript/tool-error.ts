/**
 * What a failed tool says, in words for the user.
 *
 * Stopping a running shell command by deleting its shell (`DELETE /api/shell/{id}`: the Stop of the terminal view, in
 * VS Code and on the phone) makes the server fail the agent's `shell` tool call with the bare error name
 * `Shell.NotFoundError`. That is not an error of the command: the user stopped it. It is shown as a calm line instead.
 */
export const STOPPED_COMMAND = "The command was stopped."

const STOPPED = /^\s*Shell\.?NotFoundError\s*$/i

/** The text of a tool failure: the server's message, except the bare "shell not found" of a stopped command. */
export function toolErrorText(message: string | undefined): string | undefined {
  if (message === undefined) return undefined
  return STOPPED.test(message) ? STOPPED_COMMAND : message
}

export const isStoppedCommand = (error: string | undefined): boolean => error === STOPPED_COMMAND
