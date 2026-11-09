import type { FormInfo, PermissionRequest, SessionInfo, SlimModel, SlimProvider } from "./api"
import type { ViewTarget } from "./draft"
import type { EnhanceMode } from "./enhance"
import type { ModelSelection } from "./models"
import type { PromptFile } from "./attachments"
import type { CommandSummary, SkillSummary } from "./commands"
import type { ImageRef } from "./images"
import type { McpState } from "./mcp"
import type { VoiceEngine } from "./dictation"
import type { SessionView } from "./transcript/types"
import type { Worker } from "./workers"

export type ConnectionState = {
  status: "connecting" | "connected" | "disconnected" | "setup" | "error"
  /** For `setup`: what is missing. `cli` shows install instructions and "Set CLI path"; `folder` asks to open a folder. */
  reason?: "cli" | "folder"
  message?: string
  url?: string
  version?: string
}

/** Settings the webview follows live. Mirrors the `opencode.*` configuration keys. */
export type ViewSettings = {
  collapseCompletedSteps: boolean
  expandToolDetails: boolean
  showReasoning: "collapsed" | "expanded" | "hidden"
  /** Resolved px size: the setting, else `max(chat.editor.fontSize, 14)`. */
  fontSize: number
  todoDefaultExpanded: boolean
  /** `terminal.integrated.fontFamily`, for command output. Empty falls back to the editor font. */
  terminalFontFamily: string
}

export const defaultViewSettings: ViewSettings = {
  collapseCompletedSteps: true,
  expandToolDetails: false,
  showReasoning: "collapsed",
  fontSize: 14,
  todoDefaultExpanded: false,
  terminalFontFamily: "",
}

/** What this server version can do. The UI hides what is missing instead of failing. */
export type Features = { revert: boolean; rename: boolean }

/** Text to put back into the prompt box (after a revert). `tick` changes with every request. */
export type PromptRestore = { tick: number; text: string }

/**
 * The last or running "Enhance prompt" call. `source` is the text the request was made from: the prompt box only
 * replaces its text when that is still what it shows. `tick` changes with every request.
 */
export type EnhanceState = {
  tick: number
  status: "running" | "done" | "error"
  mode: EnhanceMode
  source: string
  /** The enhanced prompt (`done`). */
  text?: string
  /** A short line for the user (`error`). Never the prompt text. */
  error?: string
}

export type AgentSummary = { id: string; name: string; description?: string }

/**
 * One workspace folder of a multi-root window. Only the VS Code host fills `AppState.folders`, and only when the window
 * has two or more folders; the Android app never does, so its UI is unchanged.
 */
export type FolderInfo = {
  directory: string
  /** The folder's name in the workspace (the last path segment, or the name given in a `.code-workspace`). */
  name: string
  /** The project's name in OpenCode, when it has one. The dropdown shows this instead of `name`. */
  projectName?: string
  /** `~`-shortened path for the dropdown. */
  displayPath: string
  /** The folder the chat view shows. */
  active: boolean
  /** A session of this folder is executing. */
  busy?: boolean
  /** A session of this folder waits for the user (a permission or a question). */
  attention?: boolean
}

/** Everything the UI renders. Plain data: it crosses postMessage (VS Code) or stays in memory (browser). */
export type AppState = {
  connection: ConnectionState
  settings: ViewSettings
  directory: string
  folderName: string
  /** The active folder's project name in OpenCode, when it has one. */
  projectName?: string
  /** `~`-shortened project path for display. */
  displayPath: string
  /** The workspace folders of a VS Code multi-root window (two or more). Absent in a single-folder window and in the app. */
  folders?: FolderInfo[]
  target: ViewTarget
  /** Root sessions of this project, newest first. */
  sessions: SessionInfo[]
  archived: SessionInfo[]
  showArchived: boolean
  sessionsLoaded: boolean
  running: string[]
  waiting: string[]
  /** Current session's transcript (empty for a draft). */
  view: SessionView
  loadingView: boolean
  /** Pending permission requests of the current session. */
  permissions: PermissionRequest[]
  /** Oldest pending form of the current session. */
  form?: FormInfo
  agents: AgentSummary[]
  models: SlimModel[]
  providers: SlimProvider[]
  /** Effective selection for the current session or draft. */
  agent?: string
  model?: ModelSelection
  /** Last send/stop/switch error, shown once and cleared by the next action. */
  error?: string
  /** True while the first prompt of a draft is being sent (create → prompt). */
  sending: boolean
  /** Bumped when `+` is pressed inside an empty draft: the prompt box focuses. */
  focusTick: number
  /** Bumped when a fresh draft opens: the prompt box clears. */
  draftEpoch: number
  /** A read-only worker tab: no prompt box, no session switcher, no revert. */
  readOnly: boolean
  /** Header of a worker tab. */
  workerTitle?: string
  /** Workers (child sessions) of the current session, from the transcript plus `session.list({ parentID })`. */
  workers: Worker[]
  /** `Worker.key`s the user removed from the list (this extension only; the sessions stay on the server). Running workers show anyway. */
  hiddenWorkers: string[]
  /** Background shells of the current session that are still running. */
  runningShells: number
  /** Pinned model keys (`provider/model`), kept by the host in `globalState`. */
  pins: string[]
  features: Features
  /** Older messages exist above the loaded part ("Show earlier messages"). */
  hasEarlier: boolean
  loadingEarlier: boolean
  /** Bumped when older messages were added above, so the view can keep its place. */
  earlierTick: number
  /** A live compaction ended: the turns before it can be trimmed once the user is at the end (`trimCompacted`). */
  trimPending: boolean
  /** Bumped when the user sends a prompt: the transcript jumps to the end. */
  sentTick: number
  restore?: PromptRestore
  /** The running or last "Enhance prompt" call. */
  enhance?: EnhanceState
  /** The model chosen for enhancement, when it still exists on the server. Absent: the server's default model. */
  enhanceModel?: ModelSelection
  /** The server's default model, to label "OpenCode default" in the enhancement menu. */
  enhanceDefault?: ModelSelection
  /** A saved enhancement model that this server does not offer any more: the default is used instead. */
  enhanceModelStale?: boolean
  /**
   * Voice input. `engine`: the chosen speech engine. `ready`: a click on the mic can start dictation (local: this
   * computer has the engine; soniox: the user saved a working key, which itself never reaches the webview).
   * `capture`: the recording companion is reachable. `recording`: the state of the current dictation.
   * `languages`: the active on-device languages (`opencode.voice.localLanguages`), the first one records; the label
   * next to the mic shows it (only for the `local` engine, and a click switches when there are two or more).
   */
  voice: { engine: VoiceEngine; ready: boolean; capture: boolean; recording: "off" | "starting" | "on" | "stopping"; languages: string[] }
  /** The server's slash commands (`command.list`), refreshed when the popup opens. */
  commands: CommandSummary[]
  /** The server's skills (`skill.list`), loaded when `/skills` is used. */
  skills: SkillSummary[]
  /** The `/mcps` panel and the status chip. */
  mcp: McpState
}

export type Action =
  | { type: "ready" }
  /** Handled by the host, not by a Controller: it binds the view to that folder's controller. */
  | { type: "switchFolder"; directory: string }
  | { type: "openSession"; id: string }
  | { type: "newDraft"; hasText: boolean }
  /** `skills`: skills chosen with `/skills`, sent with this prompt. */
  | { type: "send"; text: string; files?: PromptFile[]; skills?: Array<{ id: string }> }
  | { type: "rename"; id: string; title: string }
  | { type: "togglePin"; key: string }
  /** Remove finished workers (`Worker.key`) from the panel list. Never touches the sessions on the server. */
  | { type: "hideWorkers"; keys: string[] }
  | { type: "revert"; messageID: string }
  /**
   * Delete a stopped root session on the server, for every client. Only dispatched after the host's confirmation
   * (`confirmDeleteSession`); the controller refuses running, waiting, worker and unknown sessions.
   */
  | { type: "deleteSession"; sessionID: string }
  | { type: "redo" }
  /** `/compact` and `/fork` on the current session. */
  | { type: "compact" }
  | { type: "fork" }
  /** The popup opened: refresh the server's commands or skills (cached for a few seconds). */
  | { type: "loadCommands" }
  | { type: "loadSkills" }
  | { type: "mcp"; op: "open" | "close" | "refresh" | "cancelSignIn" }
  | { type: "mcp"; op: "toggle" | "signIn" | "signOut"; server: string }
  | { type: "loadEarlier" }
  | { type: "trimCompacted" }
  | { type: "stop" }
  /** Stop one worker (a child session of the current session). The lead keeps running. Refused for any other session id. */
  | { type: "stopWorker"; sessionID: string }
  /** A queued prompt: `steer` hands it to the agent at its next step ("Send now"); `cancel` removes it. */
  | { type: "queued"; inboxID: string; op: "steer" | "cancel" }
  | { type: "pickAgent"; id: string }
  | { type: "pickModel"; model: ModelSelection }
  /** One stateless call that rewrites `text` (never the session's model or history). */
  | { type: "enhance"; mode: EnhanceMode; text: string }
  | { type: "enhanceCancel" }
  /** The model enhancement uses; `undefined` goes back to the server's default model. Never touches the session. */
  | { type: "pickEnhanceModel"; model?: ModelSelection }
  | { type: "permission"; sessionID: string; requestID: string; decision: "once" | "always" | "reject" }
  | { type: "formReply"; answer: Record<string, string | number | boolean | string[]> }
  | { type: "formCancel" }
  | { type: "toggleArchived" }
  | { type: "refresh" }
  | { type: "dismissError" }

/** Messages from the extension host to the webview. */
export type ToWebview =
  | { type: "state"; state: AppState }
  /** A light refresh of the folder dropdown (busy/attention dots) when a folder the view is not showing changes. */
  | { type: "folders"; folders: FolderInfo[] }
  | { type: "command"; name: "newSession" }
  | { type: "picked"; requestID: string; files: PickedFile[] }
  /** The answer to `imageData`: a `data:` URI, or nothing when the image is gone or unreadable. */
  | { type: "image"; requestID: string; dataUri?: string }
  /** Dictated text of recording `id` so far (cumulative). The prompt box merges it; `done` is the last update. */
  | { type: "dictation"; id: string; text: string; done: boolean }

/** A file chosen in the host's file dialog. `uri` is `vscode.Uri.file(path).toString()`. */
export type PickedFile = { uri: string; name: string; mime?: string }

/** Host-side effects the webview asks for (files, terminals, links). Not state changes. */
export type HostRequest =
  | { type: "openFile"; path: string; line?: number }
  /** The bytes of a sent image, asked for lazily when its thumbnail scrolls into view. Answered with `image`. */
  | { type: "imageData"; requestID: string; ref: ImageRef }
  /** Open a sent image in the host's viewer (VS Code: the built-in image viewer). */
  | { type: "openImage"; ref: ImageRef; name?: string }
  /** VS Code's diff editor for a file: `patches` are the edit tool's `metadata.files[].patch` of that file, oldest first. */
  | { type: "openDiff"; file: string; patches: string[] }
  /** One editor with all files a turn changed (`vscode.changes`). */
  | { type: "openChanges"; files: Array<{ file: string; patches: string[] }>; title?: string }
  | { type: "showTerminal"; shellID: string; title?: string; sessionID?: string }
  | { type: "openSession"; id: string; readOnly: boolean }
  | { type: "pickFiles"; requestID: string }
  | { type: "confirmRevert"; messageID: string }
  /** The trash icon of a session row: the host shows a modal, and only "Delete" runs the `deleteSession` action. */
  | { type: "confirmDeleteSession"; sessionID: string; title?: string }
  | { type: "openExternal"; url: string }
  | { type: "setCliPath" }
  | { type: "voice" }
  /** The language label next to the mic: the next active on-device language becomes the current one. */
  | { type: "voiceLanguage" }
  | { type: "reconnect" }
  /** "Edit config" in the MCP panel: the host opens the user's global OpenCode config (it never edits it). */
  | { type: "openGlobalConfig" }
  /** The pencil in the folder dropdown: the host asks for a new OpenCode project name for that folder. */
  | { type: "renameProject"; directory: string }
  | { type: "notify"; level: "info" | "warning" | "error"; message: string }

/** Messages from the webview to the extension host. */
export type ToHost = { type: "action"; action: Action } | { type: "host"; request: HostRequest }

/**
 * The VS Code webview's own size and focus, for the host's best-effort minimum width. Deliberately not part of
 * `ToHost`: only the VS Code webview sends it and only the VS Code host handles it, so the Android bridge and every
 * shared component stay exactly as they were.
 */
export type WebviewMetrics = {
  type: "viewMetrics"
  /** The webview's CSS pixel width. */
  width: number
  /** The webview document has focus. */
  focused: boolean
  /** `screen.availWidth` in CSS pixels, or 0 when the webview could not read it. */
  screenWidth: number
}
