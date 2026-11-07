/**
 * Texts the app shares with the VS Code extension. `REVERT_PROMPT` is the same sentence as in
 * `apps/vscode/src/extension/host.ts` (that file belongs to the extension and keeps its own copy).
 */
export const REVERT_TITLE = "Revert to before this prompt?"
export const REVERT_DETAIL = "Messages after it are hidden, and files changed by later steps are restored. Shell side effects (git, databases, other files) are not undone."
export const REVERT_BUTTON = "Revert"
export const REVERT_PROMPT = `${REVERT_TITLE} ${REVERT_DETAIL}`
