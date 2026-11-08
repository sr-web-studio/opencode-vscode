import * as vscode from "vscode"
import { forwardMismatchNotice, redirectLoopbackPort, signInAdvice, type McpHost } from "@occ/core/mcp"
import { isLocalServer } from "@occ/core/server-url"
import { readConnectionSettings } from "./settings"

/** The port VS Code maps a forwarded `127.0.0.1:<port>` to (a URL without a port means 80 or 443). */
function portOf(uri: vscode.Uri): number | undefined {
  try {
    const u = new URL(uri.toString(true))
    return u.port ? Number(u.port) : u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : undefined
  } catch {
    return undefined
  }
}

/**
 * What `/mcps` needs from VS Code: the browser, a port forward for the sign-in callback, an input box for a pasted code
 * and a confirmation dialog. In a remote window `openExternal` opens the browser on the user's own computer, while the
 * sign-in callback (`http://127.0.0.1:<port>/callback`) is served by OpenCode on the remote machine. Asking VS Code for
 * the external URI of that port first makes it forward the port, so the redirect reaches the server.
 */
export function createMcpHost(log: (line: string) => void): McpHost {
  return {
    async openSignIn(url) {
      if (!/^https?:\/\//i.test(url)) throw new Error("The sign-in address is not a web link.")
      const port = redirectLoopbackPort(url)
      const advice = signInAdvice({ port, remoteHost: !!vscode.env.remoteName, serverLocal: isLocalServer(readConnectionSettings().serverUrl) })
      let notice = advice.notice
      if (advice.forward) {
        try {
          const mapped = await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${advice.forward}`))
          const got = portOf(mapped)
          log(`mcp sign-in: callback port ${advice.forward} is reachable on your computer as ${mapped.toString(true)}`)
          notice = forwardMismatchNotice(advice.forward, got)
          if (notice) log(`mcp sign-in: ${notice}`)
        } catch (e) {
          notice = `VS Code could not forward the sign-in callback port ${advice.forward}. Sign-in may not complete here.`
          log(`mcp sign-in: asExternalUri failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else if (notice) log(`mcp sign-in: ${notice}`)
      if (!(await vscode.env.openExternal(vscode.Uri.parse(url, true)))) throw new Error("VS Code could not open the browser.")
      return notice
    },
    askCode: (prompt) => Promise.resolve(vscode.window.showInputBox({ title: "OpenCode sign-in", prompt, ignoreFocusOut: true })),
    async confirm(message, action) {
      return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action
    },
  }
}
