import * as vscode from "vscode"
import { defaultNotificationSettings, type NotificationSettings } from "@occ/core/notifications/types"
import type { ViewSettings } from "@occ/core/protocol"

const cfg = () => vscode.workspace.getConfiguration("opencode")

/** Resolved transcript font: the setting, else `max(chat editor font size, 14)` (readable by default). */
function fontSize(): number {
  const own = cfg().get<number>("transcript.fontSize", 0)
  if (own > 0) return own
  const chat = vscode.workspace.getConfiguration("chat.editor").get<number>("fontSize", 0)
  return Math.max(chat > 0 ? chat : 0, 14)
}

export type TerminalSettings = { reveal: "onStart" | "never" | "off"; maxOpen: number; mode: "session" | "perCommand" }

export function readTerminalSettings(): TerminalSettings {
  const c = cfg()
  const reveal = c.get<string>("terminal.reveal", "onStart")
  const max = c.get<number>("terminal.maxOpen", 5)
  return {
    reveal: reveal === "never" || reveal === "off" ? reveal : "onStart",
    maxOpen: Number.isFinite(max) && max >= 1 ? Math.floor(max) : 5,
    mode: c.get<string>("terminal.mode", "session") === "perCommand" ? "perCommand" : "session",
  }
}

export function readViewSettings(): ViewSettings {
  const c = cfg()
  const reasoning = c.get<string>("transcript.showReasoning", "collapsed")
  return {
    collapseCompletedSteps: c.get<boolean>("transcript.collapseCompletedSteps", true),
    expandToolDetails: c.get<boolean>("transcript.expandToolDetails", false),
    showReasoning: reasoning === "expanded" || reasoning === "hidden" ? reasoning : "collapsed",
    fontSize: fontSize(),
    todoDefaultExpanded: c.get<boolean>("todo.defaultExpanded", false),
    terminalFontFamily: vscode.workspace.getConfiguration("terminal.integrated").get<string>("fontFamily", "") || "",
  }
}

export function readNotificationSettings(): NotificationSettings {
  const c = cfg()
  const d = defaultNotificationSettings
  return {
    enabled: c.get<boolean>("notifications.enabled", d.enabled),
    attention: c.get<boolean>("notifications.attention", d.attention),
    completed: c.get<boolean>("notifications.completed", d.completed),
    failed: c.get<boolean>("notifications.failed", d.failed),
    workers: c.get<boolean>("notifications.workers", d.workers),
    shells: c.get<boolean>("notifications.shells", d.shells),
    whenFocused: c.get<string>("notifications.whenFocused", d.whenFocused) === "always" ? "always" : "never",
    os: c.get<string>("notifications.os", d.os) === "off" ? "off" : "auto",
  }
}

export const readConnectionSettings = () => ({
  serverUrl: cfg().get<string>("serverUrl", ""),
  cliPath: cfg().get<string>("cliPath", ""),
})

/** Config keys whose change requires a new connection. */
export const affectsConnection = (e: vscode.ConfigurationChangeEvent) => e.affectsConfiguration("opencode.serverUrl") || e.affectsConfiguration("opencode.cliPath")

export const affectsView = (e: vscode.ConfigurationChangeEvent) =>
  e.affectsConfiguration("opencode.transcript") || e.affectsConfiguration("opencode.todo") || e.affectsConfiguration("chat.editor.fontSize") || e.affectsConfiguration("terminal.integrated.fontFamily")
