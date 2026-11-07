import * as vscode from "vscode"
import { access, mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { homedir, hostname } from "node:os"
import { openGlobalConfig, type ConfigHost, type OpenConfigResult } from "../core/global-config"
import { readConnectionSettings } from "./settings"

const host: ConfigHost = {
  exists: (path) => access(path).then(() => true, () => false),
  async confirmCreate(path) {
    const create = "Create"
    const pick = await vscode.window.showInformationMessage(`Create ${path}?`, { modal: true, detail: "OpenCode has no global config file yet. The new file only contains the schema line; you add the rest." }, create)
    return pick === create
  },
  async create(path, text) {
    await mkdir(dirname(path), { recursive: true })
    // `wx`: fail instead of overwriting a file that appeared in the meantime.
    await writeFile(path, text, { flag: "wx" })
  },
  async open(path) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
    await vscode.window.showTextDocument(doc, { preview: false })
  },
  info: (message) => void vscode.window.showInformationMessage(message),
}

/** The command: open the user's global OpenCode config in an editor. Never edits it. */
export async function openGlobalConfigCommand(serverHostname: string | undefined): Promise<OpenConfigResult | undefined> {
  try {
    return await openGlobalConfig(
      { env: process.env, home: homedir(), platform: process.platform, serverUrl: readConnectionSettings().serverUrl, serverHostname, localHostname: hostname() },
      host,
    )
  } catch (e) {
    void vscode.window.showErrorMessage(`Could not open the OpenCode config: ${e instanceof Error ? e.message : "unknown error"}`)
    return undefined
  }
}
