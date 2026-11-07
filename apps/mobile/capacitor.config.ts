import type { CapacitorConfig } from "@capacitor/cli"

/**
 * The one place that decides the origin of the WebView: `androidScheme` + `://` + `hostname` = `http://tauri.localhost`.
 * The OpenCode server already allows that origin in its CORS allow-list (the desktop app uses it), so the app can call
 * the server with `fetch` without any proxy. Change the origin here and nowhere else.
 */
const config: CapacitorConfig = {
  appId: "dev.srwebstudio.opencode",
  appName: "OpenCode (unofficial)",
  webDir: "dist",
  server: {
    androidScheme: "http",
    hostname: "tauri.localhost",
    // The server is usually on the LAN or a Tailscale address over plain http.
    cleartext: true,
  },
  plugins: {
    // Stays off on purpose: it buffers whole responses, which breaks the event stream.
    CapacitorHttp: { enabled: false },
    SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover" },
  },
}

export default config
