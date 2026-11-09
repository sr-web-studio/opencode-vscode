import * as vscode from "vscode"
import { Controller } from "@occ/core/controller"
import type { EventEnvelope } from "@occ/core/api"
import { FolderRegistry, folderStorageKey, type FolderEntry } from "@occ/core/folders"
import { NotificationEngine } from "@occ/core/notifications/engine"
import type { NoticeCommand } from "@occ/core/notifications/types"
import { folderName, sameDirectory, shortenHome } from "@occ/core/paths"
import { normalizeModelSelection } from "@occ/core/models"
import { homedir } from "node:os"
import { SetupError, connect } from "./connection"
import { deleteSessionCommand } from "./delete-session"
import { openGlobalConfigCommand, openProjectConfigCommand } from "./global-config"
import { HostActions } from "./host"
import { MinWidth } from "./min-width"
import { createMcpHost } from "./mcp"
import { VscodeNotifier } from "./notifier"
import { pairMobileCommand } from "./pair-mobile"
import { ProjectNames } from "./project-names"
import { renameProjectCommand } from "./rename-project"
import { affectsConnection, affectsView, readConnectionSettings, readNotificationSettings, readTerminalSettings, readViewSettings } from "./settings"
import { registerSettingsPage } from "./settings-page"
import { ShellTerminals } from "./terminal"
import { ImagePreviews } from "./images"
import { DiffViews } from "./diffs"
import { ChatViewProvider, VIEW_ID } from "./view"
import { directoryArg, SESSIONS_VIEW_ID, sessionTarget, SessionsTreeProvider } from "./sessions-tree"
import { WorkerPanels } from "./workers"
import { Voice } from "./voice"
import { normalizeServerUrl } from "@occ/core/server-url"
import { VOICE_FEED_COMMAND, type VoiceFeed } from "@occ/core/dictation"

const PASSWORD_KEY = "opencode.serverPassword"
const PINS_KEY = "opencode.pinnedModels"
const ENHANCE_MODEL_KEY = "opencode.enhanceModel"
/** The workspace folder the chat view showed last (a `.code-workspace` can open several). */
const ACTIVE_FOLDER_KEY = "opencode.activeFolder"

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("OpenCode", { log: true })
  context.subscriptions.push(output)

  const workspaceFolders = (): readonly vscode.WorkspaceFolder[] => vscode.workspace.workspaceFolders ?? []
  const folderEntries = (): FolderEntry[] =>
    workspaceFolders().map((folder) => ({
      directory: folder.uri.fsPath,
      folderName: folder.name || folderName(folder.uri.fsPath),
      displayPath: shortenHome(folder.uri.fsPath, homedir()),
    }))

  /**
   * `project.updated` reaches every controller (the event has no location); one handler applies it to the folder list.
   */
  let applyProjectEvent: (ev: EventEnvelope) => void = () => {}
  /*
   * One controller per workspace folder, all attached to the same server connection, so sessions, notifications,
   * workers and background shells of every folder keep working. The chat view is bound to the active one.
   */
  const folders = new FolderRegistry<Controller>({
    make: (entry) =>
      new Controller({
        directory: entry.directory,
        folderName: entry.folderName,
        displayPath: entry.displayPath,
        storage: {
          // The first folder keeps the keys used before multi-root support; every other folder has its own.
          get: (key) => context.workspaceState.get(folderStorageKey(key, entry.directory, entry.primary)),
          set: (key, value) => void context.workspaceState.update(folderStorageKey(key, entry.directory, entry.primary), value),
        },
        onEvent: (ev) => {
          applyProjectEvent(ev)
          void engine.handle(ev).catch((e: unknown) => output.debug(`Notification engine failed on ${ev.type}: ${e instanceof Error ? e.message : String(e)}`))
        },
        // Pins follow the user across windows and machines (Settings Sync keys), and never touch OpenCode config.
        pins: {
          get: () => context.globalState.get<string[]>(PINS_KEY, []),
          set: (pins) => void context.globalState.update(PINS_KEY, pins),
        },
        // The "Enhance prompt" model is independent of the session's model and is never written to OpenCode config.
        enhanceModel: {
          get: () => normalizeModelSelection(context.globalState.get<unknown>(ENHANCE_MODEL_KEY)),
          set: (model) => void context.globalState.update(ENHANCE_MODEL_KEY, model),
        },
        log: (line) => output.info(line),
        mcp: createMcpHost((line) => output.info(line)),
      }),
    remember: {
      get: () => context.workspaceState.get<string>(ACTIVE_FOLDER_KEY),
      set: (directory) => void context.workspaceState.update(ACTIVE_FOLDER_KEY, directory),
    },
  })
  folders.sync(folderEntries())
  // OpenCode's own project names for the folder dropdown and the chat header. Fetched on connect and on a folder add,
  // and kept current by `project.updated`, so a rename in the browser UI or on the phone shows here live.
  const projectNames = new ProjectNames(folders, (line) => output.debug(line))
  applyProjectEvent = (ev) => projectNames.apply(ev)
  context.globalState.setKeysForSync([PINS_KEY, ENHANCE_MODEL_KEY])

  // `provider` is created below; dictation text is only posted after a recording starts, long after activation.
  const voice = new Voice(
    context.secrets,
    (v) => folders.setVoice(v),
    (m) => provider.post(m),
    (line) => output.info(line),
    {
      vsix: vscode.Uri.joinPath(context.extensionUri, "dist", "opencode-voice.vsix"),
      version: String(context.extension.packageJSON.version ?? ""),
    },
  )
  void voice.refresh()
  // Installing OpenCode installs its voice companion on this computer too (also from a remote window). Quietly, a
  // little after startup; a failure is only logged here and explained when the mic is clicked.
  // Never in the host smoke test, which must not install anything.
  const companionTimer = setTimeout(() => process.env.OPENCODE_SMOKE || void voice.ensureCompanion(false), 4000)
  context.subscriptions.push({ dispose: () => clearTimeout(companionTimer) })
  folders.setSettings(readViewSettings())

  let terminals!: ShellTerminals
  let workers!: WorkerPanels
  const images = new ImagePreviews(context.globalStorageUri, folders)
  void images.cleanup()
  /** The workspace folder's own name, used when OpenCode has no project name for it. */
  const displayFolderName = (directory: string): string => folderEntries().find((entry) => sameDirectory(entry.directory, directory))?.folderName ?? folderName(directory)
  const renameProject = (directory?: string) => renameProjectCommand({ folders, projectNames, folderName: displayFolderName, log: (line) => output.info(line) }, directory)
  const host: HostActions = new HostActions(
    () => folders.active.directory,
    () => terminals,
    () => workers,
    () => images,
    () => diffs,
    (directory) => void renameProject(directory),
  )
  const diffs = new DiffViews((path) => host.resolvePath(path))
  terminals = new ShellTerminals(folders, readTerminalSettings)
  workers = new WorkerPanels(context.extensionUri, folders, () => host)
  const minWidth = new MinWidth((line) => output.debug(line))
  const provider = new ChatViewProvider(context.extensionUri, folders, host, minWidth)

  /* -------------------------------------------------------- sessions sidebar */
  // The primary-sidebar tree reads the controllers this window already keeps attached, so it never asks the server
  // for anything of its own. It shows a message with no folder, a flat list with one, and project nodes with several.
  const sessionsTree = new SessionsTreeProvider(folders)
  const sessionsView = vscode.window.createTreeView(SESSIONS_VIEW_ID, { treeDataProvider: sessionsTree, showCollapseAll: true })
  sessionsTree.attach(sessionsView)
  const syncSessionsMessage = () => {
    sessionsView.message = sessionsTree.message()
  }
  const offSessionsMessage = sessionsTree.onDidChangeTreeData(syncSessionsMessage)
  syncSessionsMessage()

  /* ---------------------------------------------------------- notifications */
  const lookupSession = async (id: string) => {
    for (const controller of folders.controllers()) {
      const known = controller.sessionMeta(id)
      if (known) return known
    }
    // A child session this window has not fetched yet: any controller can ask the shared client.
    return folders.active.lookupSession(id)
  }
  const lookupShellSession = async (id: string) => {
    for (const controller of folders.controllers()) {
      if (!controller.directory) continue
      const sessionID = await controller.shellSessionID(id)
      if (sessionID) return sessionID
    }
    return undefined
  }
  const runNotice = async (cmd: NoticeCommand) => {
    if (cmd.type === "open") {
      // A notice can belong to a folder the view is not showing: switch first, then open the session there.
      const controller = folders.activateForSession(cmd.sessionID, cmd.directory)
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      await controller.open(cmd.sessionID)
    } else {
      const controller = folders.controllerAt(cmd.directory ?? "") ?? folders.forSession(cmd.sessionID)
      await controller.dispatch({ type: "permission", sessionID: cmd.sessionID, requestID: cmd.requestID, decision: cmd.decision })
    }
  }
  const notifier = new VscodeNotifier(runNotice, { os: () => readNotificationSettings().os, log: (line) => output.debug(line) })
  const engine = new NotificationEngine({
    directory: "",
    // Every workspace folder's sessions notify; the view's active folder only decides what is on screen.
    directories: () => folders.directories(),
    settings: readNotificationSettings,
    ui: () => ({ windowFocused: vscode.window.state.focused && provider.visible, visibleSessionID: folders.active.currentSessionID }),
    notifier,
    session: (id) => lookupSession(id),
    shellSession: (id) => lookupShellSession(id),
    owns: (id) => folders.controllers().some((controller) => controller.listsSession(id)),
    log: (line) => output.debug(line),
  })
  notifier.bind(engine)

  /* ------------------------------------------------------------ status bar */
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
  status.command = "opencode.focus"
  status.name = "OpenCode"
  const paintStatus = () => {
    const c = folders.active.snapshot().connection
    const ok = c.status === "connected"
    status.text = ok ? "$(check) OpenCode" : "$(warning) OpenCode"
    const tip = new vscode.MarkdownString()
    tip.appendMarkdown(ok ? "**OpenCode** connected" : `**OpenCode** ${c.status === "setup" ? "needs setup" : c.status}`)
    if (c.url) tip.appendMarkdown(`\n\n${c.url}`)
    if (c.version) tip.appendMarkdown(`\n\nVersion ${c.version}`)
    if (c.message) tip.appendText(`\n\n${c.message}`)
    status.tooltip = tip
  }
  let unsubStatus = folders.active.subscribe(paintStatus)
  const offActiveStatus = folders.onActive(() => {
    unsubStatus()
    unsubStatus = folders.active.subscribe(paintStatus)
  })
  status.show()

  /* ------------------------------------------------------------ connection */
  let generation = 0
  let starting = false
  /** The connected server's host name, for "Open Global Config" (its config is on that computer). */
  let serverHostname: string | undefined
  const start = async (): Promise<void> => {
    const mine = ++generation
    starting = true
    folders.detach()
    serverHostname = undefined
    try {
      if (workspaceFolders().length === 0) {
        folders.setConnection({ status: "setup", reason: "folder", message: "Open a folder to use OpenCode." })
        return
      }
      let delay = 1000
      while (mine === generation) {
        folders.setConnection({ status: "connecting" })
        try {
          const settings = readConnectionSettings()
          const password = await context.secrets.get(PASSWORD_KEY)
          const conn = await connect({ ...settings, password })
          if (mine !== generation) return
          serverHostname = conn.hostname
          folders.setConnection({ status: "connecting", url: conn.url, version: conn.version })
          // One connection, every folder.
          folders.attach(conn.client)
          void projectNames.refresh(conn.client, folders.directories())
          return
        } catch (e) {
          if (mine !== generation) return
          if (e instanceof SetupError) {
            folders.setConnection({ status: "setup", reason: "cli", message: e.message })
            return
          }
          folders.setConnection({ status: "error", message: e instanceof Error ? e.message : "Could not reach OpenCode" })
          await new Promise((r) => setTimeout(r, delay))
          delay = Math.min(delay * 2, 15_000)
        }
      }
    } finally {
      if (mine === generation) starting = false
    }
  }

  /* -------------------------------------------------------------- commands */
  context.subscriptions.push(
    status,
    { dispose: unsubStatus },
    { dispose: offActiveStatus },
    provider,
    sessionsTree,
    sessionsView,
    offSessionsMessage,
    terminals,
    workers,
    images,
    diffs,
    minWidth,
    {
      dispose: () => {
        generation++
        folders.dispose()
      },
    },
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    registerSettingsPage(context),
    vscode.commands.registerCommand("opencode.focus", () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
    vscode.commands.registerCommand("opencode.newSession", async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      provider.newSession()
    }),
    // A session row (or the row's command) opens the chat on that session in the folder that owns it.
    vscode.commands.registerCommand("opencode.sessions.open", async (arg?: unknown) => {
      const target = sessionTarget(arg)
      if (!target) return
      const controller = folders.activateForSession(target.sessionID, target.directory)
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      await controller.open(target.sessionID)
    }),
    // Refresh redraws from the controllers' current state; it never adds server calls of its own.
    vscode.commands.registerCommand("opencode.sessions.refresh", () => sessionsTree.refresh()),
    vscode.commands.registerCommand("opencode.sessions.switchFolder", (arg?: unknown) => {
      const directory = directoryArg(arg)
      if (directory) folders.setActive(directory)
    }),
    // A sidebar row names its session and folder; the palette passes nothing and acts on the active folder.
    // Deleting does not switch the chat's folder: the folder's own controller does the work.
    vscode.commands.registerCommand("opencode.deleteSession", (arg?: unknown) => {
      const target = sessionTarget(arg)
      const directory = target?.directory ?? directoryArg(arg)
      const controller = (directory ? folders.controllerAt(directory) : undefined) ?? (target ? folders.forSession(target.sessionID) : folders.active)
      return deleteSessionCommand(controller, target?.sessionID)
    }),
    vscode.commands.registerCommand("opencode.mcps", async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      await folders.active.dispatch({ type: "mcp", op: "open" })
    }),
    vscode.commands.registerCommand("opencode.openGlobalConfig", () => openGlobalConfigCommand(serverHostname)),
    // The project config belongs to the folder the chat view shows, so the command reads the active folder when it runs.
    vscode.commands.registerCommand("opencode.openProjectConfig", () => openProjectConfigCommand(folders.activeDirectoryName, serverHostname)),
    // The project name belongs to the folder the chat view shows, so the command reads the active folder when it runs.
    // From the sessions sidebar a project node passes its own directory.
    vscode.commands.registerCommand("opencode.renameProject", (arg?: unknown) => renameProject(directoryArg(arg))),
    vscode.commands.registerCommand("opencode.reconnect", () => start()),
    vscode.commands.registerCommand("opencode.pairMobileDevice", () =>
      pairMobileCommand({
        client: () => (folders.active.snapshot().connection.status === "connected" ? folders.active.api : undefined),
        windowUrl: () => folders.active.snapshot().connection.url,
        log: (line) => output.info(line),
      }),
    ),
    voice,
    vscode.commands.registerCommand("opencode.voice.setKey", () => voice.setKey()),
    vscode.commands.registerCommand("opencode.voice.clearKey", () => voice.clearKey()),
    vscode.commands.registerCommand("opencode.voice.toggle", () => voice.click()),
    vscode.commands.registerCommand("opencode.voice.chooseLanguage", () => voice.chooseLanguage()),
    // From the palette: pick among the active languages; from the label next to the mic ("next"): cycle.
    vscode.commands.registerCommand("opencode.voice.switchLanguage", (how?: unknown) => voice.switchLanguage(how !== "next")),
    // The companion (laptop side) sends the heard text here.
    vscode.commands.registerCommand(VOICE_FEED_COMMAND, (u: VoiceFeed) => voice.feed(u)),
    voice.watchCompanion(),
    vscode.commands.registerCommand("opencode.setPassword", async () => {
      const url = normalizeServerUrl(readConnectionSettings().serverUrl)
      if (!url) {
        // The local service needs no password: the extension reads its credentials itself.
        const pick = await vscode.window.showInformationMessage(
          "A password is only needed for an OpenCode server you connect to by address. Set its address first in the OpenCode: Server Url setting.",
          "Open Setting",
        )
        if (pick) void vscode.commands.executeCommand("workbench.action.openSettings", "opencode.serverUrl")
        return
      }
      const value = await vscode.window.showInputBox({
        title: "OpenCode Server Password",
        prompt: `Password of the OpenCode server at ${url} (its OPENCODE_SERVER_PASSWORD). Stored in VS Code's secret storage.`,
        password: true,
        ignoreFocusOut: true,
      })
      if (value === undefined) return
      await context.secrets.store(PASSWORD_KEY, value)
      await start()
    }),
    vscode.commands.registerCommand("opencode.clearPassword", async () => {
      await context.secrets.delete(PASSWORD_KEY)
      await start()
    }),
    vscode.commands.registerCommand("opencode.setCliPath", async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, openLabel: "Use this opencode" })
      const file = picked?.[0]?.fsPath
      if (!file) return
      // This is a VS Code setting for the extension, not OpenCode configuration.
      await vscode.workspace.getConfiguration("opencode").update("cliPath", file, vscode.ConfigurationTarget.Global)
    }),
    // A folder added or removed changes which controllers exist. The connection itself stays: new folders join it.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (workspaceFolders().length === 0) {
        generation++
        starting = false
        folders.detach()
        folders.setConnection({ status: "setup", reason: "folder", message: "Open a folder to use OpenCode." })
        folders.sync([])
        return
      }
      folders.sync(folderEntries())
      if (folders.connectedClient) void projectNames.refresh(folders.connectedClient, folders.directories())
      // Adding the first folder needs a connection; adding another one joins the existing connection in the registry.
      if (!folders.connectedClient && !starting) void start()
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("opencode.voice.engine")) void voice.refresh()
      if (e.affectsConfiguration("opencode.voice.localLanguages") || e.affectsConfiguration("opencode.voice.localLanguage") || e.affectsConfiguration("opencode.voice.maxLanguages"))
        voice.syncLanguages()
      if (affectsView(e)) folders.setSettings(readViewSettings())
      if (affectsConnection(e)) void start()
    }),
  )

  void start()
}

export function deactivate(): void {
  // Nothing to stop: the OpenCode service is shared, detached, and must keep running.
}
