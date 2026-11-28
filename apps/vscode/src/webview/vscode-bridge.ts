import type { HostBridge } from "@occ/ui/bridge"
import type { HostRequest, PickedFile, ToHost, ToWebview, WebviewMetrics } from "@occ/core/protocol"
import type { TabLookup } from "@occ/core/session-tabs"
import { isTabCheckAnswer, type TabCheckRequest } from "@occ/core/tab-check"

type VsCodeApi = { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void }
declare function acquireVsCodeApi(): VsCodeApi

/** `acquireVsCodeApi` may be called once per webview, and both the bridge and the metrics reporter need it. */
let sharedApi: VsCodeApi | undefined
const vsCodeApi = (): VsCodeApi => (sharedApi ??= acquireVsCodeApi())

/** Post the webview's own size and focus to the host. VS Code only; the Android bridge never sends this. */
export function postViewMetrics(message: WebviewMetrics): void {
  vsCodeApi().postMessage(message)
}

let tabCheckSeq = 0

/**
 * Ask the extension whether a session still exists, for the tab strip (the webview has no client of its own). No answer
 * within `timeoutMs` counts as "unknown", which keeps the tab.
 */
export function lookupTabSession(sessionID: string, timeoutMs = 20_000): Promise<TabLookup> {
  return new Promise<TabLookup>((resolve) => {
    const requestID = `tab-${++tabCheckSeq}`
    const done = (result: TabLookup) => {
      window.removeEventListener("message", listener)
      clearTimeout(timer)
      resolve(result)
    }
    const listener = (e: MessageEvent<unknown>) => {
      if (isTabCheckAnswer(e.data) && e.data.requestID === requestID) done(e.data.result)
    }
    const timer = setTimeout(() => done({ state: "unknown" }), timeoutMs)
    window.addEventListener("message", listener)
    const request: TabCheckRequest = { type: "tabCheck", requestID, sessionID }
    vsCodeApi().postMessage(request)
  })
}

/** `HostBridge` for a VS Code webview: messages go over `postMessage`, storage is the webview state. */
let pickSeq = 0
let imageSeq = 0

export function createVsCodeBridge(): HostBridge {
  const api = vsCodeApi()
  const post = (message: ToHost) => api.postMessage(message)
  const host = (request: HostRequest) => post({ type: "host", request })
  const read = (): Record<string, unknown> => (api.getState() as Record<string, unknown> | undefined) ?? {}

  return {
    openFile: (path, line) => host({ type: "openFile", path, line }),
    imageData: (ref) =>
      new Promise<string | undefined>((resolve) => {
        const requestID = `img-${++imageSeq}`
        const done = (dataUri?: string) => {
          window.removeEventListener("message", listener)
          clearTimeout(timer)
          resolve(dataUri)
        }
        const listener = (e: MessageEvent<ToWebview>) => {
          if (e.data?.type === "image" && e.data.requestID === requestID) done(e.data.dataUri)
        }
        const timer = setTimeout(() => done(undefined), 30_000)
        window.addEventListener("message", listener)
        host({ type: "imageData", requestID, ref })
      }),
    openImage: (ref, name) => host({ type: "openImage", ref, name }),
    openDiff: (file, patches) => host({ type: "openDiff", file, patches }),
    openChanges: (files, title) => host({ type: "openChanges", files, title }),
    showTerminal: (shellID, title) => host({ type: "showTerminal", shellID, title }),
    openSession: (id, options) => host({ type: "openSession", id, readOnly: options.readOnly }),
    openSessionInFolder: (sessionID, directory) => host({ type: "openSessionInFolder", sessionID, directory }),
    newSessionIn: (directory) => host({ type: "newSessionIn", directory }),
    renameSession: (sessionID, directory, title) => host({ type: "renameSession", sessionID, directory, title }),
    archiveSession: (sessionID, directory, archived) => host({ type: "archiveSession", sessionID, directory, archived }),
    refreshSessions: () => host({ type: "refreshSessions" }),
    confirmRevert: (messageID) => host({ type: "confirmRevert", messageID }),
    confirmDeleteSession: (sessionID, title, directory) => host({ type: "confirmDeleteSession", sessionID, title, directory }),
    renameProject: (directory) => host({ type: "renameProject", directory }),
    pickFiles: () =>
      new Promise<PickedFile[]>((resolve) => {
        const requestID = `pick-${++pickSeq}`
        const done = (files: PickedFile[]) => {
          window.removeEventListener("message", listener)
          clearTimeout(timer)
          resolve(files)
        }
        const listener = (e: MessageEvent<ToWebview>) => {
          if (e.data?.type === "picked" && e.data.requestID === requestID) done(e.data.files)
        }
        // A cancelled dialog sends nothing; stop listening after a while so listeners do not pile up.
        const timer = setTimeout(() => done([]), 10 * 60_000)
        window.addEventListener("message", listener)
        host({ type: "pickFiles", requestID })
      }),
    exportSession: () => host({ type: "exportSession" }),
    openExternal: (url) => host({ type: "openExternal", url }),
    notify: (level, message) => host({ type: "notify", level, message }),
    voice: () => host({ type: "voice" }),
    voiceLanguage: () => host({ type: "voiceLanguage" }),
    // The chat view has a title-bar toggle for its own sessions pane; the phone uses its drawer instead.
    capabilities: { sessionsPane: true },
    storage: {
      get: <T>(key: string) => read()[key] as T | undefined,
      set: (key, value) => api.setState({ ...read(), [key]: value }),
    },
    postToHost: post,
    onMessage(handler) {
      const listener = (e: MessageEvent<ToWebview>) => handler(e.data)
      window.addEventListener("message", listener)
      return () => window.removeEventListener("message", listener)
    },
  }
}
