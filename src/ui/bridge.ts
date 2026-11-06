import type { PickedFile, ToHost, ToWebview } from "../core/protocol"

/** Small key/value store that survives webview reloads (VS Code: `getState`/`setState`). */
export interface BridgeStorage {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
}

/**
 * The only way UI components reach their host. The VS Code implementation lives in `src/webview/`;
 * a browser or mobile shell provides its own. Components never touch `vscode`, `window.parent` or the DOM
 * APIs of a particular shell directly.
 */
export interface HostBridge {
  /** Open a project file, optionally at a 1-based line. Relative paths are resolved by the host. */
  openFile(path: string, line?: number): void
  /** Show a unified diff for a file. */
  openDiff(file: string, patch: string): void
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
  /** Open a web link outside the app. */
  openExternal(url: string): void
  /** Show a transient message in the host's own UI. */
  notify(level: "info" | "warning" | "error", message: string): void
  storage: BridgeStorage
  /** Send a raw message to the host (actions, requests). */
  postToHost(message: ToHost): void
  /** Receive state and commands from the host. Returns an unsubscribe function. */
  onMessage(handler: (message: ToWebview) => void): () => void
}
