import * as vscode from "vscode"
import { randomBytes } from "node:crypto"

/** HTML shell for the webview. Script and style come from `dist/webview`, locked down by a nonce-based CSP. */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64")
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", name))
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
  ].join("; ")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset("main.css")}">
<title>OpenCode</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${asset("main.js")}"></script>
</body>
</html>`
}
