import qrcode from "qrcode-generator"
import { formatCountdown, secondsLeft } from "./pairing"

/** `vscode`-free on purpose: the same HTML is rendered to a file for screenshots and tests. */

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

/** Local QR code as an inline SVG (no network, no image files). Error correction M; the link is short enough for a small code. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M")
  qr.addData(text)
  qr.make()
  // cellSize 4 and a 4-module quiet zone (16) on white, as scanners expect.
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true })
}

export type PairPanelInput = {
  nonce: string
  /** `webview.cspSource`; the page loads nothing from it, but keeping it explicit makes the policy readable. */
  cspSource: string
  link: string
  /** Epoch ms at which the code stops working. */
  expiresAt: number
  now: number
}

export function pairPanelCsp(nonce: string): string {
  return ["default-src 'none'", `style-src 'nonce-${nonce}'`, `script-src 'nonce-${nonce}'`, "img-src data:"].join("; ")
}

const CSS = `
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: var(--vscode-font-size, 13px); color: var(--vscode-foreground, #ddd); background: var(--vscode-editor-background, #1e1e1e); margin: 0; padding: 24px 16px; }
main { max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
h1 { font-size: 1.4em; font-weight: 600; margin: 0; }
.qr { width: min(320px, 80vw); aspect-ratio: 1; background: #fff; border-radius: 8px; overflow: hidden; line-height: 0; transition: filter .2s, opacity .2s; }
.qr svg { width: 100%; height: 100%; display: block; }
.expired .qr { filter: grayscale(1); opacity: .25; }
.timer { font-variant-numeric: tabular-nums; font-size: 1.6em; font-weight: 600; }
.expired .timer { color: var(--vscode-errorForeground, #f48771); }
.status { min-height: 1.4em; margin: 0; opacity: .85; }
.link { display: flex; gap: 8px; align-items: stretch; width: 100%; }
.link code { flex: 1; min-width: 0; overflow-wrap: anywhere; text-align: left; padding: 6px 8px; border-radius: 4px; background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15)); font-family: var(--vscode-editor-font-family, monospace); user-select: all; }
.expired .link code { opacity: .4; text-decoration: line-through; }
button { font: inherit; color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); border: 0; border-radius: 4px; padding: 6px 14px; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
button.secondary { color: var(--vscode-button-secondaryForeground, #fff); background: var(--vscode-button-secondaryBackground, #3a3d41); }
button[hidden], .expired .live { display: none; }
.steps { text-align: left; margin: 0; padding-left: 1.2em; line-height: 1.6; }
.note { opacity: .75; font-size: .95em; margin: 0; }
`

const SCRIPT = `
(() => {
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined
  const root = document.getElementById("root")
  const timer = document.getElementById("timer")
  const status = document.getElementById("status")
  const copy = document.getElementById("copy")
  const renew = document.getElementById("renew")
  const expiresAt = Number(root.dataset.expires)
  const fmt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")
  const tick = () => {
    const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
    timer.textContent = fmt(left)
    if (left === 0) {
      root.classList.add("expired")
      status.textContent = "This code has expired."
      renew.hidden = false
      copy.hidden = true
      clearInterval(id)
    }
  }
  const id = setInterval(tick, 250)
  tick()
  copy.addEventListener("click", () => {
    if (vscode) vscode.postMessage({ type: "copy" })
    else if (navigator.clipboard) navigator.clipboard.writeText(document.getElementById("link").textContent || "")
    status.textContent = "Link copied."
  })
  renew.addEventListener("click", () => { if (vscode) vscode.postMessage({ type: "renew" }) })
})()
`

/** The whole page for the pairing panel. The only dynamic content is the link, escaped; the token is never here. */
export function pairPanelHtml(input: PairPanelInput): string {
  const left = secondsLeft(input.expiresAt, input.now)
  const expired = left === 0
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${pairPanelCsp(input.nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair Mobile Device</title>
<style nonce="${input.nonce}">${CSS}</style>
</head>
<body>
<div id="root" class="${expired ? "expired" : ""}" data-expires="${input.expiresAt}">
<main>
  <h1>Pair Mobile Device</h1>
  <div class="qr" role="img" aria-label="QR code with the one-time pairing link">${qrSvg(input.link)}</div>
  <div class="timer" id="timer" aria-live="off">${formatCountdown(left)}</div>
  <p class="status" id="status" role="status">${expired ? "This code has expired." : ""}</p>
  <div class="link"><code id="link">${escapeHtml(input.link)}</code><button id="copy" class="secondary live"${expired ? " hidden" : ""}>Copy</button></div>
  <button id="renew"${expired ? "" : " hidden"}>New code</button>
  <ol class="steps">
    <li>Open <strong>OpenCode (unofficial)</strong> on your phone.</li>
    <li>Choose <strong>Add server</strong>, then <strong>Scan QR</strong>.</li>
  </ol>
  <p class="note">The code works once, for 5 minutes. Your phone must reach this address (same Wi-Fi or Tailscale).</p>
</main>
</div>
<script nonce="${input.nonce}">${SCRIPT}</script>
</body>
</html>`
}
