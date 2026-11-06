import type { HostBridge } from "../ui/bridge"
import type { HostRequest, ToHost, ToWebview } from "../core/protocol"

type VsCodeApi = { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void }
declare function acquireVsCodeApi(): VsCodeApi

/** `HostBridge` for a VS Code webview: messages go over `postMessage`, storage is the webview state. */
export function createVsCodeBridge(): HostBridge {
  const api = acquireVsCodeApi()
  const post = (message: ToHost) => api.postMessage(message)
  const host = (request: HostRequest) => post({ type: "host", request })
  const read = (): Record<string, unknown> => (api.getState() as Record<string, unknown> | undefined) ?? {}

  return {
    openFile: (path, line) => host({ type: "openFile", path, line }),
    openDiff: (file, patch) => host({ type: "openDiff", file, patch }),
    showTerminal: (shellID, title) => host({ type: "showTerminal", shellID, title }),
    openExternal: (url) => host({ type: "openExternal", url }),
    notify: (level, message) => host({ type: "notify", level, message }),
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
