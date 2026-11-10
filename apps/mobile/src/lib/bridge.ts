/**
 * The `HostBridge` of the phone app. The controller runs in the same JavaScript context as the UI, so there is no
 * message channel: `postToHost` calls `controller.dispatch` and `onMessage` is `controller.subscribe`. Everything
 * the editor did on VS Code's behalf (open a file, a diff, a terminal, a modal) is a call into `MobileHost`, which
 * the app implements with its own screens. Pure TypeScript: no DOM, no Capacitor, so it is tested with fakes.
 */
import type { HostBridge, HostCapabilities } from "@occ/ui/bridge"
import type { ImageRef } from "@occ/core/images"
import type { Action, AppState, HostRequest, PickedFile, ToHost, ToWebview } from "@occ/core/protocol"

/** What the bridge needs from a controller or a worker tab. */
export type Surface = {
  subscribe(listener: (state: AppState) => void): () => void
  dispatch(action: Action): Promise<void>
  /** The session on screen, for image and shell lookups. */
  sessionID(): string | undefined
  /** True when the id names a worker (child session): the UI then opens it read-only. */
  isWorker?(id: string): boolean
}

/** The screens and dialogs of the app. Each member answers one thing the editor used to do. */
export interface MobileHost {
  openFile(path: string, line?: number): void
  imageData(sessionID: string, ref: ImageRef): Promise<string | undefined>
  openImage(sessionID: string, ref: ImageRef, name?: string): void
  openDiff(file: string, patches: string[]): void
  openChanges(files: Array<{ file: string; patches: string[] }>, title?: string): void
  showTerminal(shellID: string, title: string | undefined, sessionID: string | undefined): void
  /** A worker (child session) as a pushed, read-only screen. */
  openWorker(sessionID: string): void
  pickFiles(): Promise<PickedFile[]>
  /** The in-app modal; true when the user confirmed. */
  confirmRevert(): Promise<boolean>
  confirmDeleteSession(title: string): Promise<boolean>
  openExternal(url: string): void
  notify(level: "info" | "warning" | "error", message: string): void
  /** "Try again" of the connection screen: reconnect the project. */
  reconnect(): void
}

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const MOBILE_CAPABILITIES: HostCapabilities = {
  voice: false,
  editConfig: false,
  mcpSignIn: false,
  enterSends: false,
  shellView: "output",
  // The phone's own drawer already lists every project and session; the chat keeps its full width.
  sessionsPane: false,
}

export const VOICE_LATER = "Voice comes in the next version"
/** The phone never types into a worker: its transcript is read-only, like the VS Code worker tab. */
export const WORKER_READ_ONLY = "A worker session is read-only. Open its parent to send a prompt."

export function createBridge(
  surface: Surface,
  host: MobileHost,
  store: KeyValueStore,
  capabilities: HostCapabilities = MOBILE_CAPABILITIES,
  /** The app went to the background (Android's pause): a moment to save what is pending. */
  onHidden?: (handler: () => void) => () => void,
): HostBridge {
  const read = (key: string): unknown => {
    try {
      const raw = store.getItem(`occ.ui.${key}`)
      return raw === null ? undefined : JSON.parse(raw)
    } catch {
      return undefined
    }
  }

  /** The requests that arrive through `postToHost` (the UI also has direct methods for most of them). */
  function request(req: HostRequest): void {
    switch (req.type) {
      case "openFile":
        return host.openFile(req.path, req.line)
      case "openDiff":
        return host.openDiff(req.file, req.patches)
      case "openChanges":
        return host.openChanges(req.files, req.title)
      case "showTerminal":
        return host.showTerminal(req.shellID, req.title, req.sessionID ?? surface.sessionID())
      case "openSession":
        return void (req.readOnly || surface.isWorker?.(req.id) ? host.openWorker(req.id) : surface.dispatch({ type: "openSession", id: req.id }))
      case "openExternal":
        return host.openExternal(req.url)
      case "notify":
        return host.notify(req.level, req.message)
      case "reconnect":
        return host.reconnect()
      case "voice":
      case "voiceLanguage":
        return host.notify("info", VOICE_LATER)
      case "confirmRevert":
        return void host.confirmRevert().then((ok) => (ok ? surface.dispatch({ type: "revert", messageID: req.messageID }) : undefined))
      case "confirmDeleteSession":
        return void host.confirmDeleteSession(req.title ?? "").then((ok) => (ok ? surface.dispatch({ type: "deleteSession", sessionID: req.sessionID }) : undefined))
      // Files of this phone, the editor's CLI path and the global config do not exist here; these never arrive.
      case "imageData":
      case "openImage":
      case "pickFiles":
      case "setCliPath":
      case "openGlobalConfig":
        return
    }
  }

  /** Actions of the shared UI. A worker never becomes the writable session and never receives a prompt. */
  function action(a: Action): void {
    if (a.type === "openSession" && surface.isWorker?.(a.id)) return host.openWorker(a.id)
    if (a.type === "send" && surface.isWorker?.(surface.sessionID() ?? "")) return host.notify("warning", WORKER_READ_ONLY)
    void surface.dispatch(a)
  }

  return {
    openFile: (path, line) => host.openFile(path, line),
    imageData: async (ref) => {
      const id = surface.sessionID()
      return id ? host.imageData(id, ref).catch(() => undefined) : undefined
    },
    openImage: (ref, name) => {
      const id = surface.sessionID()
      if (id) host.openImage(id, ref, name)
    },
    openDiff: (file, patches) => host.openDiff(file, patches),
    openChanges: (files, title) => host.openChanges(files, title),
    showTerminal: (shellID, title) => host.showTerminal(shellID, title, surface.sessionID()),
    openSession: (id, options) => {
      if (options.readOnly || surface.isWorker?.(id)) host.openWorker(id)
      else void surface.dispatch({ type: "openSession", id })
    },
    pickFiles: () => host.pickFiles().catch(() => []),
    confirmRevert: (messageID) => {
      void host.confirmRevert().then((ok) => (ok ? surface.dispatch({ type: "revert", messageID }) : undefined))
    },
    confirmDeleteSession: (sessionID, title) => {
      void host.confirmDeleteSession(title).then((ok) => (ok ? surface.dispatch({ type: "deleteSession", sessionID }) : undefined))
    },
    openExternal: (url) => host.openExternal(url),
    voice: () => host.notify("info", VOICE_LATER),
    voiceLanguage: () => host.notify("info", VOICE_LATER),
    notify: (level, message) => host.notify(level, message),
    storage: {
      get: <T>(key: string) => read(key) as T | undefined,
      set: (key, value) => {
        try {
          store.setItem(`occ.ui.${key}`, JSON.stringify(value))
        } catch {
          // Storage full or blocked: UI preferences are not worth an error.
        }
      },
    },
    capabilities,
    // Omitted entirely when the shell has no such signal, so the UI falls back to the DOM events.
    ...(onHidden ? { onHidden } : {}),
    postToHost(message: ToHost) {
      if (message.type === "action") action(message.action)
      else request(message.request)
    },
    onMessage(handler: (message: ToWebview) => void) {
      return surface.subscribe((state) => handler({ type: "state", state }))
    },
  }
}
