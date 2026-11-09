import type { ToSettingsHost, ToSettingsWebview } from "../extension/settings-model"

type VsCodeApi = { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void }
declare function acquireVsCodeApi(): VsCodeApi

// `acquireVsCodeApi` may be called only once per webview, so the bridge owns the single handle.
const api = acquireVsCodeApi()

export function send(message: ToSettingsHost): void {
  api.postMessage(message)
}

export function onMessage(handler: (message: ToSettingsWebview) => void): () => void {
  const listener = (event: MessageEvent<ToSettingsWebview>) => {
    if (event.data && typeof event.data === "object" && "type" in event.data) handler(event.data)
  }
  window.addEventListener("message", listener)
  return () => window.removeEventListener("message", listener)
}
