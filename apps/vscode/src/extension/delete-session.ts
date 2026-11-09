import * as vscode from "vscode"
import type { Controller } from "@occ/core/controller"
import { confirmDelete, deletableSessions } from "@occ/core/delete-session"
import { relativeTime } from "@occ/core/format"
import { UNTITLED } from "@occ/core/sessions"
import { chooseDeleteTarget } from "./delete-session-target"

/**
 * "OpenCode: Delete Session…": pick one of this folder's stopped root sessions (Command Palette), or delete the one
 * the sessions sidebar named (`sessionID`). Both paths use the same modal confirmation; nothing is deleted without it.
 * Archived sessions are included once "Show archived" has loaded them in the panel.
 */
export async function deleteSessionCommand(controller: Controller, sessionID?: string): Promise<void> {
  const state = controller.snapshot()
  if (state.connection.status !== "connected") {
    void vscode.window.showWarningMessage("OpenCode is not connected, so sessions cannot be deleted right now.")
    return
  }

  const choice = chooseDeleteTarget(state, sessionID)
  if (choice.kind === "gone") {
    void vscode.window.showInformationMessage("That session no longer exists.")
    return
  }
  if (choice.kind === "running") {
    void vscode.window.showInformationMessage("This session is running; stop it first, then delete it.")
    return
  }
  if (choice.kind === "waiting") {
    void vscode.window.showInformationMessage("This session is waiting for your answer; answer or reject it first, then delete it.")
    return
  }
  if (choice.kind === "worker") {
    void vscode.window.showInformationMessage("This session is a worker; it is deleted together with its parent session.")
    return
  }

  const remove = async (id: string, title: string | undefined): Promise<void> => {
    if (!(await confirmDelete((message, options, ...buttons) => vscode.window.showWarningMessage(message, options, ...buttons), title))) return
    await controller.dispatch({ type: "deleteSession", sessionID: id })
    // The panel shows a refusal on its error line; with the panel closed the user still has to hear about it.
    const error = controller.snapshot().error
    if (error) void vscode.window.showErrorMessage(error)
  }

  // A sidebar row already names the session: confirm it directly, never ask the user to pick it again.
  if (choice.kind === "target") {
    await remove(choice.session.id, choice.session.title)
    return
  }

  const sessions = deletableSessions(state)
  if (sessions.length === 0) {
    void vscode.window.showInformationMessage("There is no session to delete. Running sessions and workers cannot be deleted; stop them first.")
    return
  }
  const now = Date.now()
  const items = [...sessions]
    .sort((a, b) => b.time.updated - a.time.updated)
    .map((s) => ({
      label: s.title?.trim() || UNTITLED,
      description: relativeTime(s.time.updated, now) + (s.time.archived !== undefined ? " · archived" : ""),
      id: s.id,
    }))
  const pick = await vscode.window.showQuickPick(items, { title: "Delete Session", placeHolder: "Choose the session to delete (you will be asked to confirm)", matchOnDescription: true })
  if (!pick) return
  await remove(pick.id, pick.label)
}
