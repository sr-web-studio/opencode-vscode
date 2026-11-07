import * as vscode from "vscode"
import { randomBytes } from "node:crypto"
import type { OpenCodeClient } from "@opencode/client"
import { KIND_LABEL, candidateUrls, canonicalUrl, customUrlProblem, expiresAt, logHost, pairLink, type Candidate } from "./pairing"
import { pairPanelHtml } from "./pairing-html"

export type PairHost = {
  /** The ready client of this window, or undefined while disconnected. */
  client: () => OpenCodeClient | undefined
  /** The URL this window connects to (`controller.snapshot().connection.url`). */
  windowUrl: () => string | undefined
  log: (line: string) => void
}

const CUSTOM = "custom"

/** Ask which address the phone should use. Undefined when cancelled. */
async function pickAddress(serverUrls: readonly string[], windowUrl: string | undefined): Promise<string | undefined> {
  const { candidates, droppedLoopback } = candidateUrls(serverUrls, windowUrl)
  type Item = vscode.QuickPickItem & { url?: string; custom?: boolean }
  const items: Item[] = candidates.map((c: Candidate) => ({ label: c.url, description: KIND_LABEL[c.kind], url: c.url }))
  items.push({ label: "Enter a URL…", description: "an address your phone can reach, for example a Tailscale name or a domain", custom: true })
  const pick = await vscode.window.showQuickPick(items, {
    title: "Pair Mobile Device",
    placeHolder: droppedLoopback
      ? "Choose the address your phone will use (127.0.0.1 and localhost are left out: a phone cannot reach them)"
      : "Choose the address your phone will use",
    ignoreFocusOut: true,
  })
  if (!pick) return undefined
  if (pick.url) return pick.url
  const typed = await vscode.window.showInputBox({
    title: "Pair Mobile Device",
    prompt: "Address of the OpenCode server as your phone reaches it",
    placeHolder: "http://192.168.1.10:4096",
    ignoreFocusOut: true,
    validateInput: customUrlProblem,
  })
  return typed === undefined ? undefined : canonicalUrl(typed)
}

/** Ask the server for a one-time code and turn it into a link for `baseUrl`. */
async function createLink(client: OpenCodeClient, baseUrl: string, log: PairHost["log"]): Promise<{ link: string; expiresAt: number }> {
  const res = await client.server.pair()
  const now = Date.now()
  // Never log the code or the link, only where it points.
  log(`pairing code created for ${logHost(baseUrl)}`)
  return { link: pairLink(baseUrl, res.code), expiresAt: expiresAt(now, res.expires_in) }
}

let current: vscode.WebviewPanel | undefined

/** "OpenCode: Pair Mobile Device": pick an address, create a one-time code, show the QR code. */
export async function pairMobileCommand(host: PairHost): Promise<void> {
  const client = host.client()
  if (!client) {
    void vscode.window.showWarningMessage("OpenCode is not connected, so a phone cannot be paired right now. Wait for the connection, or run “OpenCode: Reconnect”.")
    return
  }
  const info = await client.server.info().catch(() => undefined)
  const base = await pickAddress(info?.urls ?? [], host.windowUrl())
  if (!base) return

  let state: { link: string; expiresAt: number }
  try {
    state = await createLink(client, base, host.log)
  } catch (e) {
    void vscode.window.showErrorMessage(`Could not create a pairing code: ${e instanceof Error ? e.message : String(e)}`)
    return
  }

  current?.dispose()
  const panel = vscode.window.createWebviewPanel("opencode.pairMobile", "Pair Mobile Device", vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] })
  current = panel
  const render = () => {
    panel.webview.html = pairPanelHtml({ nonce: randomBytes(16).toString("base64"), cspSource: panel.webview.cspSource, link: state.link, expiresAt: state.expiresAt, now: Date.now() })
  }
  render()
  panel.webview.onDidReceiveMessage(async (msg: unknown) => {
    const type = (msg as { type?: unknown } | undefined)?.type
    if (type === "copy") {
      await vscode.env.clipboard.writeText(state.link)
    } else if (type === "renew") {
      const live = host.client()
      if (!live) {
        void vscode.window.showWarningMessage("OpenCode is not connected, so a new code cannot be created right now.")
        return
      }
      try {
        state = await createLink(live, base, host.log)
        render()
      } catch (e) {
        void vscode.window.showErrorMessage(`Could not create a pairing code: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  })
  panel.onDidDispose(() => {
    if (current === panel) current = undefined
  })
}
