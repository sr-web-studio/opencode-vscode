import * as vscode from "vscode"
import { Controller } from "@occ/core/controller"
import { NotificationEngine } from "@occ/core/notifications/engine"
import type { NoticeCommand } from "@occ/core/notifications/types"
import { folderName, shortenHome } from "@occ/core/paths"
import { homedir } from "node:os"
import { SetupError, connect } from "./connection"
import { deleteSessionCommand } from "./delete-session"
import { openGlobalConfigCommand } from "./global-config"
import { HostActions } from "./host"
import { createMcpHost } from "./mcp"
import { VscodeNotifier } from "./notifier"
import { affectsConnection, affectsView, readConnectionSettings, readNotificationSettings, readTerminalSettings, readViewSettings } from "./settings"
import { ShellTerminals } from "./terminal"
import { ImagePreviews } from "./images"
import { DiffViews } from "./diffs"
import { ChatViewProvider, VIEW_ID } from "./view"
import { WorkerPanels } from "./workers"
import { Voice } from "./voice"
import { normalizeServerUrl } from "@occ/core/server-url"
import { VOICE_FEED_COMMAND, type VoiceFeed } from "@occ/core/dictation"

const PASSWORD_KEY = "opencode.serverPassword"
const PINS_KEY = "opencode.pinnedModels"

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0]
  const directory = folder?.uri.fsPath ?? ""
  const output = vscode.window.createOutputChannel("OpenCode", { log: true })
  context.subscriptions.push(output)

  const controller = new Controller({
    directory,
    folderName: directory ? folderName(directory) : "",
    displayPath: shortenHome(directory, homedir()),
    storage: {
      get: (key) => context.workspaceState.get(key),
      set: (key, value) => void context.workspaceState.update(key, value),
    },
    onEvent: (ev) => void engine.handle(ev).catch((e: unknown) => output.debug(`Notification engine failed on ${ev.type}: ${e instanceof Error ? e.message : String(e)}`)),
    // Pins follow the user across windows and machines (Settings Sync keys), and never touch OpenCode config.
    pins: {
      get: () => context.globalState.get<string[]>(PINS_KEY, []),
      set: (pins) => void context.globalState.update(PINS_KEY, pins),
    },
    log: (line) => output.info(line),
    mcp: createMcpHost((line) => output.info(line)),
  })
  context.globalState.setKeysForSync([PINS_KEY])
  // `provider` is created below; dictation text is only posted after a recording starts, long after activation.
  const voice = new Voice(context.secrets, (v) => controller.setVoice(v), (m) => provider.post(m), (line) => output.info(line), {
    vsix: vscode.Uri.joinPath(context.extensionUri, "dist", "opencode-voice.vsix"),
    version: String(context.extension.packageJSON.version ?? ""),
  })
  void voice.refresh()
  // Installing OpenCode installs its voice companion on this computer too (also from a remote window). Quietly, a
  // little after startup; a failure is only logged here and explained when the mic is clicked.
  // Never in the host smoke test, which must not install anything.
  const companionTimer = setTimeout(() => process.env.OPENCODE_SMOKE || void voice.ensureCompanion(false), 4000)
  context.subscriptions.push({ dispose: () => clearTimeout(companionTimer) })
  controller.setSettings(readViewSettings())

  let terminals!: ShellTerminals
  let workers!: WorkerPanels
  const images = new ImagePreviews(context.globalStorageUri, controller)
  void images.cleanup()
  const host: HostActions = new HostActions(directory, () => terminals, () => workers, () => images, () => diffs)
  const diffs = new DiffViews((path) => host.resolvePath(path))
  terminals = new ShellTerminals(controller, readTerminalSettings)
  workers = new WorkerPanels(context.extensionUri, controller, () => host)
  const provider = new ChatViewProvider(context.extensionUri, controller, host)

  /* ---------------------------------------------------------- notifications */
  const runNotice = async (cmd: NoticeCommand) => {
    if (cmd.type === "open") {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      await controller.open(cmd.sessionID)
    } else {
      await controller.dispatch({ type: "permission", sessionID: cmd.sessionID, requestID: cmd.requestID, decision: cmd.decision })
    }
  }
  const notifier = new VscodeNotifier(runNotice, { os: () => readNotificationSettings().os, log: (line) => output.debug(line) })
  const engine = new NotificationEngine({
    directory,
    settings: readNotificationSettings,
    ui: () => ({ windowFocused: vscode.window.state.focused && provider.visible, visibleSessionID: controller.currentSessionID }),
    notifier,
    session: (id) => controller.lookupSession(id),
    shellSession: (id) => controller.shellSessionID(id),
    owns: (id) => controller.listsSession(id),
    log: (line) => output.debug(line),
  })
  notifier.bind(engine)

  /* ------------------------------------------------------------ status bar */
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
  status.command = "opencode.focus"
  status.name = "OpenCode"
  const paintStatus = () => {
    const c = controller.snapshot().connection
    const ok = c.status === "connected"
    status.text = ok ? "$(check) OpenCode" : "$(warning) OpenCode"
    const tip = new vscode.MarkdownString()
    tip.appendMarkdown(ok ? "**OpenCode** connected" : `**OpenCode** ${c.status === "setup" ? "needs setup" : c.status}`)
    if (c.url) tip.appendMarkdown(`\n\n${c.url}`)
    if (c.version) tip.appendMarkdown(`\n\nVersion ${c.version}`)
    if (c.message) tip.appendText(`\n\n${c.message}`)
    status.tooltip = tip
  }
  const unsubStatus = controller.subscribe(paintStatus)
  status.show()

  /* ------------------------------------------------------------ connection */
  let generation = 0
  /** The connected server's host name, for "Open Global Config" (its config is on that computer). */
  let serverHostname: string | undefined
  const start = async (): Promise<void> => {
    const mine = ++generation
    controller.detach()
    serverHostname = undefined
    if (!directory) {
      controller.setConnection({ status: "setup", reason: "folder", message: "Open a folder to use OpenCode." })
      return
    }
    let delay = 1000
    while (mine === generation) {
      controller.setConnection({ status: "connecting" })
      try {
        const settings = readConnectionSettings()
        const password = await context.secrets.get(PASSWORD_KEY)
        const conn = await connect({ ...settings, password })
        if (mine !== generation) return
        serverHostname = conn.hostname
        controller.setConnection({ status: "connecting", url: conn.url, version: conn.version })
        controller.attach(conn.client)
        return
      } catch (e) {
        if (mine !== generation) return
        if (e instanceof SetupError) {
          controller.setConnection({ status: "setup", reason: "cli", message: e.message })
          return
        }
        controller.setConnection({ status: "error", message: e instanceof Error ? e.message : "Could not reach OpenCode" })
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 15_000)
      }
    }
  }

  /* -------------------------------------------------------------- commands */
  context.subscriptions.push(
    status,
    { dispose: unsubStatus },
    provider,
    terminals,
    workers,
    images,
    diffs,
    { dispose: () => { generation++; controller.detach() } },
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand("opencode.focus", () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
    vscode.commands.registerCommand("opencode.newSession", async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      provider.newSession()
    }),
    vscode.commands.registerCommand("opencode.deleteSession", () => deleteSessionCommand(controller)),
    vscode.commands.registerCommand("opencode.mcps", async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      await controller.dispatch({ type: "mcp", op: "open" })
    }),
    vscode.commands.registerCommand("opencode.openGlobalConfig", () => openGlobalConfigCommand(serverHostname)),
    vscode.commands.registerCommand("opencode.reconnect", () => start()),
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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("opencode.voice.engine")) void voice.refresh()
      if (e.affectsConfiguration("opencode.voice.localLanguages") || e.affectsConfiguration("opencode.voice.localLanguage") || e.affectsConfiguration("opencode.voice.maxLanguages")) voice.syncLanguages()
      if (affectsView(e)) controller.setSettings(readViewSettings())
      if (affectsConnection(e)) void start()
    }),
  )

  void start()
}

export function deactivate(): void {
  // Nothing to stop: the OpenCode service is shared, detached, and must keep running.
}
