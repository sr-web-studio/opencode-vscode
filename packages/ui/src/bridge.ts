import type { ImageRef } from "@occ/core/images"
import type { PickedFile, ToHost, ToWebview } from "@occ/core/protocol"

/** Small key/value store that survives webview reloads (VS Code: `getState`/`setState`). */
export interface BridgeStorage {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
}

/**
 * What a host can do beyond the basics. Every member is optional and a missing one means "yes, like VS Code", so a host
 * that does not know about this (the VS Code webview) keeps the full UI. A shell without a feature says `false`.
 */
export interface HostCapabilities {
  /** The mic button and the language label. Default true. */
  voice?: boolean
  /** "Edit config" in the `/mcps` panel (opens the global OpenCode config in an editor). Default true. */
  editConfig?: boolean
  /** "Sign in" for MCP servers (needs a browser on the machine that runs the client). Default true. */
  mcpSignIn?: boolean
  /** Plain Enter sends the prompt. False on a phone: Enter adds a new line and the send button sends. Default true. */
  enterSends?: boolean
  /** What a shell block offers: a terminal that mirrors the command (default), or a screen with its output. */
  shellView?: "terminal" | "output"
}

/**
 * The only way UI components reach their host. The VS Code implementation lives in `src/webview/`;
 * a browser or mobile shell provides its own. Components never touch `vscode`, `window.parent` or the DOM
 * APIs of a particular shell directly.
 */
export interface HostBridge {
  /** Open a project file, optionally at a 1-based line. Relative paths are resolved by the host. */
  openFile(path: string, line?: number): void
  /** The picture of a sent image as a `data:` URI (undefined when it is gone). Asked lazily; the state never carries it. */
  imageData(ref: ImageRef): Promise<string | undefined>
  /** Open a sent image in full: VS Code's image viewer, or a full-screen viewer on mobile. */
  openImage(ref: ImageRef, name?: string): void
  /** The real before/after diff of a file. `patches` are the edit tool's patches for it, oldest first. */
  openDiff(file: string, patches: string[]): void
  /** Every file a turn changed, in one view (VS Code: the multi-file diff editor; mobile: a list). */
  openChanges(files: Array<{ file: string; patches: string[] }>, title?: string): void
  /** Focus the terminal that mirrors a shell command (the host creates it when needed). */
  showTerminal(shellID: string, title?: string): void
  /**
   * Open another session. `readOnly` opens it as a worker tab (no prompt box, live updates); otherwise it becomes the
   * session of the chat view. On mobile this is a pushed screen.
   */
  openSession(id: string, options: { readOnly: boolean }): void
  /** The host's own file dialog (the paperclip). Resolves with nothing when the user cancels. */
  pickFiles(): Promise<PickedFile[]>
  /** Ask for confirmation in the host's own UI (a VS Code modal), then revert. */
  confirmRevert(messageID: string): void
  /** Ask for confirmation in the host's own UI (a VS Code modal), then delete the session on the server. */
  confirmDeleteSession(sessionID: string, title: string): void
  /**
   * Rename an OpenCode project (its display name on the server, not the folder on disk). The host asks for the name
   * and saves it; hosts without a project list (the phone) leave this out. VS Code shows it in the folder dropdown.
   */
  renameProject?(directory: string): void
  /** Open a web link outside the app. */
  openExternal(url: string): void
  /**
   * The mic button. Without a saved key the host asks for one (VS Code: an input box) and checks it. With a key it
   * starts or stops recording where the host can record. The key never comes back to the UI.
   */
  voice(): void
  /** The language label next to the mic (on-device engine): switch to the next active language. */
  voiceLanguage(): void
  /** Show a transient message in the host's own UI. */
  notify(level: "info" | "warning" | "error", message: string): void
  storage: BridgeStorage
  /**
   * The host is about to go to the background (the phone's pause, a window being hidden): save what is pending. Optional;
   * the UI also listens to `visibilitychange`, `pagehide` and `blur`. Returns the unsubscribe function.
   */
  onHidden?(handler: () => void): () => void
  /** What this host cannot do. Omitted: everything. */
  capabilities?: HostCapabilities
  /** Send a raw message to the host (actions, requests). */
  postToHost(message: ToHost): void
  /** Receive state and commands from the host. Returns an unsubscribe function. */
  onMessage(handler: (message: ToWebview) => void): () => void
}
