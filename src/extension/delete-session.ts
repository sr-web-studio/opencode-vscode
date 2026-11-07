import * as vscode from "vscode"
import type { Controller } from "../core/controller"
import { confirmDelete, deletableSessions } from "../core/delete-session"
import { relativeTime } from "../core/format"
import { UNTITLED } from "../core/sessions"

/**
 * "OpenCode: Delete Session…": pick one of this folder's stopped root sessions, confirm in the same modal as the trash
 * icon, then delete. Archived sessions are included once "Show archived" has loaded them in the panel.
 */
export async function deleteSessionCommand(controller: Controller): Promise<void> {
  const state = controller.snapshot()
  if (state.connection.status !== "connected") {
    void vscode.window.showWarningMessage("OpenCode is not connected, so sessions cannot be deleted right now.")
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
  if (!(await confirmDelete((message, options, ...buttons) => vscode.window.showWarningMessage(message, options, ...buttons), pick.label))) return
  await controller.dispatch({ type: "deleteSession", sessionID: pick.id })
  // The panel shows a refusal on its error line; with the panel closed the user still has to hear about it.
  const error = controller.snapshot().error
  if (error) void vscode.window.showErrorMessage(error)
}
