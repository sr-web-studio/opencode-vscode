import * as vscode from "vscode"
import type { Controller } from "@occ/core/controller"
import { errorMessage } from "@occ/core/errors"
import type { FolderRegistry } from "@occ/core/folders"
import { checkProjectName, MAX_PROJECT_NAME, normalizeProjectName } from "@occ/core/project-names"
import type { ProjectNames } from "./project-names"

export type RenameProjectDeps = {
  folders: FolderRegistry<Controller>
  projectNames: ProjectNames
  /** The workspace folder's own name, shown when OpenCode has no project name yet. */
  folderName: (directory: string) => string
  log: (line: string) => void
}

/**
 * Ask for a new OpenCode project name and save it. `directory` is the folder the dropdown's pencil belongs to; the
 * Command Palette and the Settings page pass none and act on the chat view's active folder.
 *
 * This writes only the project's display name on the OpenCode server. It never renames the folder on disk and never
 * changes an OpenCode config file.
 */
export async function renameProjectCommand(deps: RenameProjectDeps, directory?: string): Promise<void> {
  const target = directory ? deps.folders.controllerAt(directory)?.folderPath : deps.folders.activeDirectoryName
  if (!target) {
    void vscode.window.showInformationMessage("Open a folder first.")
    return
  }
  const client = deps.folders.connectedClient
  if (!client) {
    void vscode.window.showWarningMessage("OpenCode is not connected. Reconnect and try again.")
    return
  }
  try {
    const project = await deps.projectNames.resolve(client, target)
    if (!project) {
      void vscode.window.showWarningMessage("OpenCode has no project for this folder yet. Start a session in it first.")
      return
    }
    const fallback = deps.folderName(target)
    const current = project.name ?? fallback
    const value = await vscode.window.showInputBox({
      title: "Rename OpenCode Project",
      prompt: `The name OpenCode shows for this project in the browser UI and on the phone. Leave it empty to use the folder name again. Up to ${MAX_PROJECT_NAME} characters.`,
      value: current,
      valueSelection: [0, current.length],
      validateInput: (input) => {
        const check = checkProjectName(input)
        return check.ok ? undefined : check.error
      },
      ignoreFocusOut: true,
    })
    if (value === undefined) return
    const check = checkProjectName(value)
    if (!check.ok || (check.name ?? "") === (project.name ?? "")) return
    // Only the display name on the server changes. The folder on disk and the OpenCode config files are untouched.
    const saved = await client.project.update({ projectID: project.projectID, name: check.name ?? "" })
    deps.projectNames.set(target, project.projectID, normalizeProjectName(saved?.name) ?? check.name)
    deps.log(`Renamed OpenCode project ${project.projectID} (${target})${check.name ? ` to "${check.name}"` : " to its folder name"}`)
  } catch (e) {
    const message = errorMessage(e)
    deps.log(`Renaming the OpenCode project of ${target} failed: ${message}`)
    void vscode.window.showErrorMessage(`Could not rename the OpenCode project: ${message}`)
  }
}
