/**
 * Texts the app shares with the VS Code extension. `REVERT_PROMPT` is the same sentence as in
 * `apps/vscode/src/extension/host.ts` (that file belongs to the extension and keeps its own copy).
 */
export const REVERT_TITLE = "Revert to before this prompt?"
export const REVERT_DETAIL = "Messages after it are hidden, and files changed by later steps are restored. Shell side effects (git, databases, other files) are not undone."
export const REVERT_BUTTON = "Revert"
export const REVERT_PROMPT = `${REVERT_TITLE} ${REVERT_DETAIL}`

/** The server setup guide; the app opens it in the system browser. */
export const SETUP_GUIDE_URL = "https://github.com/sr-web-studio/opencode-vscode/blob/main/docs/mobile-setup.md"
export const SETUP_GUIDE_LABEL = "How to set up the server"

/** Empty server list: what to do when no server is saved yet. */
export const EMPTY_SERVERS_HELP =
  "Add the OpenCode server that runs on your computer. Scan the QR code from “OpenCode: Pair Mobile Device…” in VS Code, or type the computer's address and the server password."

/** Add-server screen: the QR route. */
export const SCAN_HELP = "In VS Code on your computer, run “OpenCode: Pair Mobile Device…” and scan the QR code it shows."

/** Add-server screen: the typed-address route. */
export const ADDRESS_HELP = "The address of the computer that runs OpenCode, not this phone. The password is the server password from that computer."
