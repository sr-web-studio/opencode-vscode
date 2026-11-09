import * as vscode from "vscode"
import { randomBytes } from "node:crypto"
import { normalizeModelSelection } from "@occ/core/models"
import {
  buildSettingsSections,
  coerceSettingValue,
  configurationProperties,
  resolveWriteTarget,
  type ActionRow,
  type ConfigurationSchema,
  type PropertySchema,
  type SecretRow,
  type SettingSnapshot,
  type SettingsState,
  type ToSettingsHost,
  type ToSettingsWebview,
} from "./settings-model"

const PANEL_TYPE = "opencode.settings"
const PANEL_TITLE = "OpenCode Settings"
const SETTINGS_SECTION = "opencode"
const ENHANCE_MODEL_KEY = "opencode.enhanceModel"
const COMPANION_ID = "sr-web-studio.opencode-voice"
const COMPANION_PING = "opencode.companion.ping"
const MOBILE_SETUP_URL = "https://github.com/sr-web-studio/opencode-vscode/blob/main/docs/mobile-setup.md"
const SECRET_KEYS = { serverPassword: "opencode.serverPassword", sonioxKey: "opencode.voice.sonioxKey" } as const

/** Companion commands, mirrored from `companion/package.json`; shown only when the companion is installed. */
const COMPANION_COMMANDS: ActionRow[] = [
  { id: "chooseMicrophone", label: "Choose microphone…", description: "Pick which microphone voice input records.", command: "opencode.companion.voice.chooseMicrophone", button: "Choose…" },
  {
    id: "removeLanguages",
    label: "Remove downloaded languages…",
    description: "Delete on-device speech packs you no longer use.",
    command: "opencode.companion.voice.removeLanguages",
    button: "Remove…",
  },
  { id: "showLog", label: "Show voice log", description: "Open the OpenCode Voice output channel for diagnostics.", command: "opencode.companion.voice.showLog", button: "Show" },
  { id: "micSettings", label: "Open microphone settings", description: "Open the operating system's microphone privacy page.", command: "opencode.companion.voice.micSettings", button: "Open" },
  {
    id: "testAttention",
    label: "Test window attention",
    description: "Ask the OS for attention after 5 seconds, to try it from another window.",
    command: "opencode.companion.testAttention",
    button: "Test",
  },
]

const ACTIONS: ActionRow[] = [
  {
    id: "globalConfig",
    label: "Open global OpenCode config",
    description: "Open the OpenCode server's own config file in an editor. This page never changes it.",
    command: "opencode.openGlobalConfig",
    icon: "json",
    button: "Open",
    group: "OpenCode config",
  },
  {
    id: "projectConfig",
    label: "Open project OpenCode config",
    description: "Open this workspace folder's own OpenCode config (opencode.jsonc or .opencode/opencode.jsonc) in an editor. This page never changes it.",
    command: "opencode.openProjectConfig",
    icon: "json",
    button: "Open",
    group: "OpenCode config",
  },
  {
    id: "renameProject",
    label: "Rename project…",
    description: "Change the name OpenCode shows for the chat view's workspace folder, in the browser UI and on the phone. This never renames the folder on disk or changes OpenCode config.",
    command: "opencode.renameProject",
    icon: "edit",
    button: "Rename…",
    group: "Project",
  },
  {
    id: "pairMobile",
    label: "Pair mobile device…",
    description: "Show a QR code and link for the OpenCode (unofficial) Android app.",
    command: "opencode.pairMobileDevice",
    icon: "device-mobile",
    button: "Pair…",
    group: "Quick actions",
  },
  {
    id: "reconnect",
    label: "Reconnect",
    description: "Detach and connect to the OpenCode server again.",
    command: "opencode.reconnect",
    icon: "debug-restart",
    button: "Reconnect",
    group: "Quick actions",
  },
  {
    id: "voiceLanguage",
    label: "Choose voice language…",
    description: "Pick the language voice input records, grouped by what is already downloaded.",
    command: "opencode.voice.chooseLanguage",
    icon: "globe",
    button: "Choose…",
    group: "Quick actions",
  },
]

const SECRET_ROWS: SecretRow[] = [
  {
    id: "serverPassword",
    label: "Server password",
    description: "Needed only when you connect to an OpenCode server by address. Stored in VS Code's secret storage; this page only shows whether it is set.",
    set: false,
    setCommand: "opencode.setPassword",
    clearCommand: "opencode.clearPassword",
  },
  {
    id: "sonioxKey",
    label: "Soniox voice API key",
    description: "Used by the Soniox speech engine. Stored in VS Code's secret storage on this machine; you pay Soniox directly. This page only shows whether it is set.",
    set: false,
    setCommand: "opencode.voice.setKey",
    clearCommand: "opencode.voice.clearKey",
  },
]

const ALLOWED_COMMANDS = new Set([
  ...SECRET_ROWS.flatMap((row) => [row.setCommand, row.clearCommand]),
  ...ACTIONS.map((action) => action.command),
  ...COMPANION_COMMANDS.map((action) => action.command),
  "opencode.setCliPath",
])

type SettingsPage = { panel?: vscode.WebviewPanel }

function settingsHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64")
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "settings", name))
  const csp = ["default-src 'none'", `style-src ${webview.cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`, `font-src ${webview.cspSource}`, `img-src ${webview.cspSource} data:`].join("; ")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset("settings.css")}">
<title>${PANEL_TITLE}</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${asset("settings.js")}"></script>
</body>
</html>`
}

async function companionInfo(): Promise<{ installed: boolean; version?: string }> {
  const extension = vscode.extensions.getExtension(COMPANION_ID)
  if (extension) return { installed: true, version: String(extension.packageJSON.version ?? "") }
  // A `ui` extension is not always visible from a remote extension host; its ping command still is.
  try {
    const info = await vscode.commands.executeCommand<{ version?: unknown }>(COMPANION_PING)
    if (info && typeof info === "object") return { installed: true, version: typeof info.version === "string" ? info.version : undefined }
  } catch {
    // Not installed: the page shows the section disabled with a note.
  }
  return { installed: false }
}

/**
 * Registers the OpenCode Settings editor panel and `opencode.openSettings`. One panel per window: a second call
 * reveals the existing one. Values are read from VS Code's configuration, secrets are only read as set/not set, and
 * every write goes through `workspace.getConfiguration("opencode").update`.
 */
export function registerSettingsPage(context: vscode.ExtensionContext): vscode.Disposable {
  const page: SettingsPage = {}
  const disposables: vscode.Disposable[] = []
  const extensionUri = context.extensionUri

  const configuration = () => vscode.workspace.getConfiguration(SETTINGS_SECTION)
  const schema = () => configurationProperties(context.extension.packageJSON?.contributes?.configuration as ConfigurationSchema | ConfigurationSchema[] | undefined)
  const propertyFor = (key: string): { shortKey: string; property: PropertySchema } | undefined => {
    if (!key.startsWith(`${SETTINGS_SECTION}.`)) return undefined
    const shortKey = key.slice(SETTINGS_SECTION.length + 1)
    const property = schema()[key]
    return property ? { shortKey, property } : undefined
  }

  const post = (message: ToSettingsWebview): void => {
    void page.panel?.webview.postMessage(message)
  }
  const toast = (level: "info" | "error", message: string): void => post({ type: "toast", level, message })

  const buildState = async (): Promise<SettingsState> => {
    const cfg = configuration()
    const properties = schema()
    const snapshots: Record<string, SettingSnapshot> = {}
    for (const key of Object.keys(properties)) {
      const shortKey = key.startsWith(`${SETTINGS_SECTION}.`) ? key.slice(SETTINGS_SECTION.length + 1) : key
      const inspected = cfg.inspect(shortKey)
      snapshots[shortKey] = {
        value: cfg.get(shortKey),
        defaultValue: inspected?.defaultValue,
        globalValue: inspected?.globalValue,
        workspaceValue: inspected?.workspaceValue,
        workspaceFolderValue: inspected?.workspaceFolderValue,
      }
    }
    const [password, sonioxKey, companion] = await Promise.all([context.secrets.get(SECRET_KEYS.serverPassword), context.secrets.get(SECRET_KEYS.sonioxKey), companionInfo()])
    const version = String(context.extension.packageJSON?.version ?? "")
    return {
      version,
      sections: buildSettingsSections(context.extension.packageJSON?.contributes?.configuration as ConfigurationSchema | ConfigurationSchema[] | undefined, snapshots),
      secrets: SECRET_ROWS.map((row) => ({ ...row, set: row.id === "serverPassword" ? !!password : !!sonioxKey })),
      actions: ACTIONS.map((action) => ({ ...action })),
      enhance: normalizeModelSelection(context.globalState.get(ENHANCE_MODEL_KEY)),
      companion: { ...companion, commands: COMPANION_COMMANDS.map((action) => ({ ...action })) },
      about: {
        version,
        links: [
          { label: "Marketplace", url: `https://marketplace.visualstudio.com/items?itemName=${context.extension.id}`, description: "Reviews, versions and the changelog." },
          { label: "GitHub issues", url: "https://github.com/sr-web-studio/opencode-vscode/issues", description: "Report a bug or ask for a feature." },
          { label: "Mobile app setup", url: MOBILE_SETUP_URL, description: "Pair the Android app with this computer." },
        ],
        note: "OpenCode (unofficial) is an independent client for the OpenCode server. It is not affiliated with, endorsed by or supported by the OpenCode team.",
      },
    }
  }

  const push = async (): Promise<void> => {
    if (!page.panel) return
    try {
      post({ type: "state", state: await buildState() })
    } catch (e) {
      toast("error", `Could not read the settings: ${e instanceof Error ? e.message : "unknown error"}`)
    }
  }

  const resetSetting = async (shortKey: string, property: PropertySchema): Promise<void> => {
    const cfg = configuration()
    await cfg.update(shortKey, undefined, vscode.ConfigurationTarget.Global)
    // A Workspace override would keep winning; clear it too, where the scope allows it.
    if (resolveWriteTarget(property, "workspace") === "workspace") {
      await cfg.update(shortKey, undefined, vscode.ConfigurationTarget.Workspace).then(undefined, () => undefined)
      await cfg.update(shortKey, undefined, vscode.ConfigurationTarget.WorkspaceFolder).then(undefined, () => undefined)
    }
  }

  const handle = async (message: ToSettingsHost): Promise<void> => {
    try {
      switch (message.type) {
        case "ready":
        case "refresh":
          await push()
          return
        case "set": {
          const found = propertyFor(message.key)
          if (!found) return toast("error", "That setting is not part of OpenCode (unofficial).")
          const result = coerceSettingValue(found.property, message.value)
          if (!result.ok) return toast("error", result.error)
          const target = resolveWriteTarget(found.property) === "workspace" ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
          await configuration().update(found.shortKey, result.value, target)
          await push()
          return
        }
        case "reset": {
          const found = propertyFor(message.key)
          if (!found) return toast("error", "That setting is not part of OpenCode (unofficial).")
          await resetSetting(found.shortKey, found.property)
          await push()
          return
        }
        case "command": {
          if (!ALLOWED_COMMANDS.has(message.command)) return toast("error", "That action is not available from this page.")
          await vscode.commands.executeCommand(message.command)
          await push()
          return
        }
        case "openSettings":
          await vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`)
          return
        case "openExternal": {
          const allowed = new Set((await buildState()).about.links.map((link) => link.url))
          if (!allowed.has(message.url)) return toast("error", "That link is not available from this page.")
          await vscode.env.openExternal(vscode.Uri.parse(message.url, true))
          return
        }
        case "resetEnhance":
          await context.globalState.update(ENHANCE_MODEL_KEY, undefined)
          await push()
          toast("info", "Enhance prompt now uses the server's default model.")
          return
      }
    } catch (e) {
      toast("error", `Could not complete that: ${e instanceof Error ? e.message : "unknown error"}`)
    }
  }

  const open = (): void => {
    if (page.panel) {
      page.panel.reveal(vscode.ViewColumn.Active)
      void push()
      return
    }
    const panel = vscode.window.createWebviewPanel(PANEL_TYPE, PANEL_TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "settings")],
    })
    panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "opencode.svg")
    panel.webview.html = settingsHtml(panel.webview, extensionUri)
    page.panel = panel
    const panelSubs: vscode.Disposable[] = [
      panel.webview.onDidReceiveMessage((message: ToSettingsHost) => void handle(message)),
      panel.onDidChangeViewState(() => {
        if (panel.visible) void push()
      }),
    ]
    panel.onDidDispose(() => {
      for (const sub of panelSubs) sub.dispose()
      if (page.panel === panel) page.panel = undefined
    })
    void push()
  }

  disposables.push(
    vscode.commands.registerCommand("opencode.openSettings", open),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SETTINGS_SECTION)) void push()
    }),
    context.secrets.onDidChange(() => void push()),
    vscode.extensions.onDidChange(() => void push()),
  )

  return vscode.Disposable.from(...disposables, {
    dispose: () => {
      page.panel?.dispose()
      page.panel = undefined
    },
  })
}
