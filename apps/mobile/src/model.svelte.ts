/**
 * The state of the app: saved servers, the connected server's workspace (one controller per open project), the screen
 * stack, the toast and the modal. Screens read it and call its methods; the editor integrations of the shared UI
 * (open a file, a diff, a terminal, a confirmation) are implemented here as screens and dialogs.
 */
import { Controller } from "@occ/core/controller"
import type { EventEnvelope } from "@occ/core/api"
import { dataUri } from "@occ/core/attachments"
import { ImageCache } from "@occ/core/image-cache"
import { safeImageMime, type ImageRef } from "@occ/core/images"
import { folderName, shortenHome } from "@occ/core/paths"
import type { ModelSelection } from "@occ/core/models"
import { defaultViewSettings, type ViewSettings } from "@occ/core/protocol"
import { deleteQuestion, DELETE_BUTTON, DELETE_DETAIL } from "@occ/core/delete-session"
import { errorMessage } from "@occ/core/errors"
import { checkProjectName, MAX_PROJECT_NAME, normalizeProjectName } from "@occ/core/project-names"
import { normalizeServerUrl } from "@occ/core/server-url"
import { EXPORT_FORMATS, type ExportFormat } from "@occ/core/session-export"
import { enhanceModelKey, parseEnhanceModel, parseViewSettings, patchViewSettings, resetSettingKeys, VIEW_KEY } from "./lib/app-settings"
import { makeClient, redeemPairing, testConnection } from "./lib/client"
import { parseDeepLink, routeDeepLink } from "./lib/deep-link"
import { saveExport } from "./lib/export-file"
import { LinkGate } from "./lib/link-gate"
import { chooseLanding, lastUsedKey, parseLastUsed } from "./lib/landing"
import { backAction, canPop, directoriesInUse, pop, popKey, push, stackForSession, stackForWorker, type Entry, type Screen } from "./lib/nav"
import { settleWithin, startIntent } from "./lib/start"
import { DEFAULT_NOTIFY, NO_STATUS, NOTIFY_VERSION, nativeServers, parseNotifySettings, visibleSessionOf, type NotifySettings, type NotifyStatus } from "./lib/notify"
import {
  askBatteryExemption,
  askNotificationPermission,
  canWatchInBackground,
  clearSessionNotification,
  configureService,
  openBatterySettings,
  openNotificationSettings,
  serviceStatus,
  setVisibleSession,
} from "./lib/notify-native"
import { choiceAnswer, type ModalOption } from "./lib/modal-choice"
import { parsePairingLink } from "./lib/pairing-link"
import { pickFiles } from "./lib/picker"
import { ProjectNames } from "./lib/project-names"
import { buildOverview } from "./lib/overview"
import { OverviewStore } from "./lib/overview.svelte"
import { guessHome, projectFolders, type ProjectLike } from "./lib/projects"
import { launchUrl, onHardwareBack, onPause, onResume, onUrlOpen, openInBrowser } from "./lib/platform"
import { ProfileStore, type Profile, type ProfileInput } from "./lib/profiles"
import { secureKV } from "./lib/secure"
import { REVERT_BUTTON, REVERT_DETAIL, REVERT_TITLE } from "./lib/texts"
import { Workspace, type ProjectInfo } from "./lib/workspace"
import type { MobileHost } from "./lib/bridge"

export type Toast = { id: number; level: "info" | "warning" | "error"; text: string }
/** A text field in a dialog: the name dialog and anything like it. */
export type ModalInput = {
  value: string
  label?: string
  placeholder?: string
  help?: string
  maxLength?: number
  /** A friendly message under the field; the confirm button stays disabled while it is set. */
  validate?: (value: string) => string | undefined
}
export type ModalSpec = { title: string; detail?: string; confirm?: string; danger?: boolean; input?: ModalInput; options?: ReadonlyArray<ModalOption> }
type Modal = ModalSpec & { id: number; resolve: (result: boolean | string | undefined) => void }
export type Problem = { profileID: string; kind: string; message: string }

let keySeq = 0
const nextKey = () => ++keySeq

function readJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: what this remembers (last session, pins) is not worth an error.
  }
}

const LINK_DEDUPE_MS = 2500
const NOTIFY_KEY = "occ.notify"
/** Set once the owner has seen the notification-permission explanation (whatever the answer). */
const NOTIFY_ASKED_KEY = "occ.notify.asked"
/** Set once the owner has seen the battery explanation. */
const BATTERY_ASKED_KEY = "occ.notify.battery"

class AppModel {
  profiles = $state.raw<Profile[]>([])
  /** The server last used (opened again at the next start). */
  activeID = $state<string | undefined>()
  /** The server this app is connected to now. */
  profile = $state.raw<Profile | undefined>()
  stack = $state.raw<Entry[]>([{ key: nextKey(), screen: { kind: "servers" } }])
  toast = $state.raw<Toast | undefined>()
  modal = $state.raw<Modal | undefined>()
  /** The server whose connection test is running. */
  connecting = $state<string | undefined>()
  problem = $state.raw<Problem | undefined>()
  ready = $state(false)
  /** The Settings layer is open above the screen stack. */
  settingsOpen = $state(false)
  /** The project/session drawer slides over the stack; Android back closes it first. */
  drawerOpen = $state(false)
  /** The whole server as the drawer lists it: one snapshot and one event stream, not a controller per project. */
  readonly overview = new OverviewStore()
  /** What the chat looks like on this phone; applied to every open project's controller. */
  viewSettings = $state.raw<ViewSettings>(defaultViewSettings)
  /** Bumped when a saved setting outside `viewSettings` changes (an enhancement model, a reset). */
  settingsTick = $state(0)
  /** Background notifications: the owner's switches (not secret; the service gets them too). */
  notifySettings = $state.raw<NotifySettings>(DEFAULT_NOTIFY)
  /** What the watching service reports (refreshed while the Settings screen is open). */
  notifyStatus = $state.raw<NotifyStatus>(NO_STATUS)

  /** The home folder seen in the project list, for `~` in paths. */
  home: string | undefined

  /** OpenCode's project of each folder on this server: the authoritative id and the name (`location.get` + `project.list`). */
  private projectNames = new ProjectNames({ setProject: (directory, projectID, name) => this.setProject(directory, projectID, name) })
  /** Folder → authoritative project id, for the project rows. Reactive: a row's title settles when its answer arrives. */
  projectIDs = $state.raw<ReadonlyMap<string, string>>(new Map())
  /** Folder → the name OpenCode has for it (undefined: the folder name shows). */
  projectTitles = $state.raw<ReadonlyMap<string, string | undefined>>(new Map())

  private readonly store = new ProfileStore(secureKV)
  private workspace: Workspace<Controller> | undefined
  /** Project folders whose controller finished a sync (reactive: a chat screen waits for it before opening a session). */
  private synced = $state.raw<ReadonlySet<string>>(new Set())
  /** Resolvers waiting for a folder's first sync (a drawer action on a project that has no chat open). */
  private readonly syncedWaiters = new Map<string, Array<() => void>>()
  private readonly caches = new Map<string, ImageCache>()
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private markProfilesLoaded: () => void = () => {}
  /** Deep links wait here until the saved servers are loaded (a cold start delivers the launch link first). */
  private readonly links = new LinkGate({
    ready: new Promise<void>((resolve) => {
      this.markProfilesLoaded = resolve
    }),
    handle: (raw) => this.routeLink(raw),
    dedupeMs: LINK_DEDUPE_MS,
  })
  private started = false
  /** The session each open project's controller shows (a chat opens "the newest one" without saying which). */
  private readonly viewing = new Map<string, string | undefined>()
  private shownSession = ""
  /** The app is in front. A backgrounded app has no chat on screen, so turn ends stay unread. */
  private foreground = true

  /* ----------------------------------------------------------- start */

  async init(): Promise<void> {
    if (this.started) return
    this.started = true
    onHardwareBack(() => this.back())
    onResume(() => {
      this.foreground = true
      this.workspace?.resume()
      this.overview.resume()
      // Back in front: the session on screen counts as seen again, so its notification goes.
      this.shownSession = ""
      this.syncVisible()
      this.syncOnScreen()
      void this.syncNotify()
    })
    onPause(() => {
      this.foreground = false
      this.syncOnScreen()
      this.overview.pause()
    })
    onUrlOpen((url) => void this.openLink(url))
    try {
      this.profiles = await this.store.list()
      this.activeID = await this.store.activeID()
    } finally {
      this.markProfilesLoaded()
    }
    this.viewSettings = parseViewSettings(readJSON(VIEW_KEY))
    this.notifySettings = parseNotifySettings(readJSON(NOTIFY_KEY))
    void this.syncNotify()
    // The saved-server list is the bottom of the stack, not the first screen: keep the neutral start screen until the
    // launch link or the last server is resolved, or the list (with its addresses) would flash before the chat.
    try {
      await settleWithin(this.start())
    } finally {
      this.ready = true
    }
  }

  /** Open what a cold start asks for: the session of the launch link, else the chat of the server used last. */
  private async start(): Promise<void> {
    const intent = startIntent(await launchUrl(), this.profiles, this.activeID)
    if (intent.kind === "link") await this.openLink(intent.raw)
    else if (intent.kind === "reconnect") await this.connect(intent.profile)
  }

  /* ------------------------------------------------------------ stack */

  get top(): Entry {
    return this.stack[this.stack.length - 1]!
  }

  private setStack(next: Entry[]) {
    this.stack = next
    this.settingsOpen = false
    this.settle()
    this.syncVisible()
    this.syncOnScreen()
  }

  push(screen: Screen) {
    this.setStack(push(this.stack, screen, nextKey()))
  }

  pop() {
    // Settings is a layer over the stack, not an entry of it (nav.ts is not ours): back closes it first.
    if (this.settingsOpen) {
      this.settingsOpen = false
      return
    }
    this.setStack(pop(this.stack))
  }

  openSettings() {
    this.closeDrawer()
    this.settingsOpen = true
    this.syncOnScreen()
    void this.refreshNotifyStatus()
  }

  /** Close Settings and show the saved server list (the screen the gear lives on). */
  goServers() {
    this.setStack([{ key: nextKey(), screen: { kind: "servers" } }])
  }

  /** Close the screen with this key, unless something else has been opened above it since. */
  close(key: number) {
    this.setStack(popKey(this.stack, key))
  }

  /**
   * Open the session of a chat screen. A worker (child session) never becomes a writable chat: the screen is replaced by
   * the read-only worker screen. The root list already knows the roots; only an unknown id asks the server for its parent.
   */
  async openChatSession(ctl: Controller, directory: string, sessionID: string, key: number): Promise<void> {
    const known = ctl.sessionMeta(sessionID)
    const worker = known ? !!known.parentID : !!(await this.sessionParent(sessionID))
    if (worker) {
      this.replace(key, { kind: "worker", directory, sessionID })
      return
    }
    // The controller marks the turn seen itself (`open`), in the editor and in OpenCode's own UI too.
    await ctl.dispatch({ type: "openSession", id: sessionID })
  }

  private async sessionParent(sessionID: string): Promise<string | undefined> {
    try {
      return (await this.client.session.get({ sessionID })).parentID
    } catch {
      return undefined
    }
  }

  /** Replace the screen with this key (a chat that turns out to be a worker). */
  private replace(key: number, screen: Screen) {
    this.setStack(this.stack.map((e) => (e.key === key ? { key, screen } : e)))
  }

  /** Android back: a dialog first, then the drawer, then Settings, then the top screen. False at the bottom: the app leaves. */
  back(): boolean {
    const action = backAction({ modal: !!this.modal, drawer: this.drawerOpen, settings: this.settingsOpen, canPop: canPop(this.stack) })
    if (action === "modal") {
      this.answer(false)
      return true
    }
    if (action === "drawer") {
      this.closeDrawer()
      return true
    }
    if (action === "settings") {
      this.settingsOpen = false
      this.syncOnScreen()
      return true
    }
    if (action === "exit") return false
    this.pop()
    return true
  }

  /* ---------------------------------------------------------- drawer */

  /** The folder of the screen the drawer is opened over; its project starts expanded. */
  get currentDirectory(): string | undefined {
    const screen = this.top.screen
    return "directory" in screen ? screen.directory : undefined
  }

  openDrawer(): void {
    this.drawerOpen = true
    this.overview.setDrawerOpen(true)
    // The drawer covers the chat: a turn that ends now is "New reply", not something the user has read.
    this.syncOnScreen()
  }

  closeDrawer(): void {
    if (!this.drawerOpen) return
    this.drawerOpen = false
    this.overview.setDrawerOpen(false)
    // The chat is in front again, so whatever ended meanwhile has been seen.
    this.syncOnScreen()
  }

  /** Tap a session in the drawer: close it and open that chat, the same stack a notification tap builds. */
  openSession(directory: string, sessionID: string): void {
    this.closeDrawer()
    this.setStack(stackForSession(directory, nextKey, sessionID, this.serversInStack))
  }

  /** `+` on a project in the drawer: close it and start a new session in that folder. */
  newSession(directory: string): void {
    this.closeDrawer()
    this.setStack(this.chatEntries({ kind: "chat", directory, draft: true }))
  }

  /** The drawer's refresh: ask for a fresh snapshot of every project and root session. */
  refreshOverview(): void {
    this.overview.retry()
  }

  /**
   * Rename a session from the drawer. It writes only the title on the server, so the open controllers and the drawer
   * both pick it up from the `session.renamed` event.
   */
  async renameSession(sessionID: string, current: string): Promise<void> {
    const value = await this.ask({
      title: "Rename session",
      detail: "The name shown in the drawer, in OpenCode's own UI and in every other client.",
      confirm: "Save",
      input: { value: current, label: "Session name", placeholder: "Session name", maxLength: 200 },
    })
    if (value === undefined) return
    const title = value.trim()
    if (!title || title === current) return
    try {
      await this.client.session.update({ sessionID, title })
      this.notify("info", "Session renamed.")
    } catch (e) {
      this.notify("error", `Could not rename the session: ${errorMessage(e)}`)
    }
  }

  /**
   * Delete a session from the drawer, after the usual confirmation. The controller of that folder does the work, so
   * its guards apply: only a stopped, answered root session without a running worker can go. The controller is created
   * on demand and dropped again by `settle` when no screen of that folder is open.
   */
  async deleteSession(directory: string, sessionID: string, title: string): Promise<void> {
    const ok = await this.confirm({ title: deleteQuestion(title), detail: DELETE_DETAIL, confirm: DELETE_BUTTON, danger: true })
    if (!ok) return
    try {
      const ctl = this.controller(directory)
      if (!(await this.whenSynced(directory))) {
        this.notify("warning", "That project is still loading. Try again in a moment.")
        return
      }
      await ctl.dispatch({ type: "deleteSession", sessionID })
    } catch (e) {
      this.notify("error", `Could not delete the session: ${errorMessage(e)}`)
    } finally {
      this.settle()
    }
  }

  /** The saved-server list belongs under the chat only when there is more than one server to go back to. */
  private get serversInStack(): boolean {
    return this.profiles.length > 1
  }

  private chatEntries(screen: Screen): Entry[] {
    return [...this.baseEntries(), { key: nextKey(), screen }]
  }

  private baseEntries(): Entry[] {
    return this.serversInStack ? [{ key: nextKey(), screen: { kind: "servers" } }] : []
  }

  /**
   * Where a fresh connection opens: the chat last used on that server, else the most active project's chat with the
   * drawer over it, else the empty state that points at the drawer. The overview is awaited when nothing was
   * remembered, and when the remembered session's row is not known yet: without its id the chat would open on a draft
   * ("New session") and only then switch to the session. The refresh joins the one `connect` already started.
   */
  private async land(): Promise<void> {
    const profile = this.profile
    if (!profile) return
    const last = parseLastUsed(readJSON(lastUsedKey(profile.id)))
    if (!last || !this.overview.data) await this.overview.refresh()
    const groups = this.overview.data ? buildOverview(this.overview.data, { resolved: this.projectIDs, titles: this.projectTitles }, Date.now()) : []
    const landing = chooseLanding(groups, last)
    if (landing.kind === "empty") {
      this.setStack(this.chatEntries({ kind: "home" }))
      return
    }
    this.setStack(stackForSession(landing.directory, nextKey, landing.sessionID, this.serversInStack, landing.title))
    // No remembered chat: the drawer is how the owner picks one, so show it over the project's chat.
    if (!last) this.openDrawer()
  }

  /** Dispose the controllers of projects that no screen shows any more; leave the server when its list is gone. */
  private settle() {
    const ws = this.workspace
    if (!ws) return
    // `home` keeps the server connected (the drawer lives on it) even though no folder is open.
    if (!this.stack.some((e) => "directory" in e.screen || e.screen.kind === "home")) {
      this.closeWorkspace()
      return
    }
    for (const dir of ws.keepOnly(directoriesInUse(this.stack))) this.drop(dir)
  }

  private drop(dir: string) {
    this.viewing.delete(dir)
    this.synced = new Set([...this.synced].filter((d) => d !== dir))
    // A dialog waiting for this folder's first sync must not hang once the folder is closed.
    const waiters = this.syncedWaiters.get(dir)
    if (waiters) {
      this.syncedWaiters.delete(dir)
      for (const done of waiters) done()
    }
    this.caches.get(dir)?.clear()
    this.caches.delete(dir)
  }

  private closeWorkspace() {
    this.overview.disconnect()
    this.closeDrawer()
    for (const dir of this.workspace?.directories ?? []) this.drop(dir)
    this.workspace?.dispose()
    this.workspace = undefined
    this.profile = undefined
    this.viewing.clear()
    // Names belong to one server: a different server can use the same folders with other projects.
    this.resetProjectNames()
  }

  /** Forget every project id and name (a server switch, or leaving the server). */
  private resetProjectNames(): void {
    this.projectNames = new ProjectNames({ setProject: (directory, projectID, name) => this.setProject(directory, projectID, name) })
    this.projectIDs = new Map()
    this.projectTitles = new Map()
  }

  /* ---------------------------------------------------------- servers */

  async saveProfile(input: ProfileInput): Promise<Profile> {
    const saved = await this.store.save(input)
    this.profiles = await this.store.list()
    void this.syncNotify()
    return saved
  }

  async removeProfile(id: string): Promise<void> {
    await this.store.remove(id)
    this.profiles = await this.store.list()
    if (this.activeID === id) this.activeID = undefined
    if (this.profile?.id === id) this.closeWorkspace()
    void this.syncNotify()
  }

  /**
   * Test the server, then open its last chat. `navigate: false` keeps the screens as they are (a deep link builds its
   * own). Returns false when the server cannot be used; `problem` says why and the server list shows it.
   */
  async connect(profile: Profile, navigate = true): Promise<boolean> {
    if (this.workspace && this.profile?.id === profile.id) {
      if (navigate) await this.land()
      return true
    }
    this.connecting = profile.id
    this.problem = undefined
    const result = await testConnection(profile)
    this.connecting = undefined
    if (!result.ok) {
      this.problem = { profileID: profile.id, kind: result.kind, message: result.message }
      return false
    }
    await this.store.learnHostname(profile.id, result.hostname)
    await this.store.setActive(profile.id)
    this.profiles = await this.store.list()
    this.activeID = profile.id
    void this.offerNotifications()
    const fresh = this.profiles.find((p) => p.id === profile.id) ?? profile
    this.closeWorkspace()
    this.profile = fresh
    this.workspace = new Workspace(makeClient(fresh), (project) => this.makeController(fresh, project))
    // The drawer's one snapshot and one stream; names go through the same ProjectNames cache the drawer reads.
    this.overview.connect(this.workspace.client, {
      onProjects: (list) => {
        this.home = guessHome(list.map((project) => project.canonical))
        void this.learnProjects(list)
      },
    })
    if (navigate) await this.land()
    return true
  }

  /** A pairing link (scanned or pasted): redeem the code, save the server with the token as its password, open it. */
  async pair(text: string): Promise<{ ok: true; profile: Profile } | { ok: false; message: string }> {
    const parsed = parsePairingLink(text)
    if (!parsed.ok) return { ok: false, message: parsed.reason }
    const redeemed = await redeemPairing(parsed.link)
    if (!redeemed.ok) return { ok: false, message: redeemed.message }
    const url = normalizeServerUrl(parsed.link.baseUrl)
    const existing = this.profiles.find((p) => p.url === url)
    const profile = await this.saveProfile({ id: existing?.id, url, password: redeemed.token, name: existing?.name, serverId: existing?.serverId })
    return { ok: true, profile }
  }

  /** The form is done: close it and open the server. */
  finishForm(key: number, profile: Profile) {
    this.close(key)
    void this.connect(profile)
  }

  /* --------------------------------------------------------- projects */

  get client() {
    const ws = this.workspace
    if (!ws) throw new Error("Not connected to a server.")
    return ws.client
  }

  get connected(): boolean {
    return !!this.workspace
  }

  /** The live controller of a project folder (created on first use, disposed when its last screen closes). */
  controller(directory: string): Controller {
    const ws = this.workspace
    if (!ws) throw new Error("Not connected to a server.")
    // The chat shows OpenCode's project name where the folder name would be; the path stays below it.
    const ctl = ws.acquire({ directory, folderName: this.projectTitle(directory) ?? folderName(directory), displayPath: shortenHome(directory, this.home) })
    // A controller starts "on screen"; fix that for a chat that is not the top screen (or a backgrounded app).
    this.syncOnScreen()
    return ctl
  }

  /** Has this project's controller finished its first sync? */
  isSynced(directory: string): boolean {
    return this.synced.has(directory)
  }

  /** Wait for a folder's controller to know its sessions, so a drawer action has the server's own guards to work with. */
  private whenSynced(directory: string): Promise<boolean> {
    if (this.synced.has(directory)) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        resolve(this.synced.has(directory))
      }
      // A server that never answers must not leave the dialog hanging; the caller says to try again.
      const timer = setTimeout(() => {
        const list = this.syncedWaiters.get(directory)
        const at = list?.indexOf(done) ?? -1
        if (list && at >= 0) list.splice(at, 1)
        resolve(false)
      }, 10_000)
      const list = this.syncedWaiters.get(directory)
      if (list) list.push(done)
      else this.syncedWaiters.set(directory, [done])
    })
  }

  /** The name OpenCode has for a folder's project, when it has one. */
  projectTitle(directory: string): string | undefined {
    return this.projectTitles.get(directory)
  }

  /**
   * Learn the project names of a freshly loaded `project.list`: its names first, then each folder's authoritative
   * project id from `location.get`, a few folders at a time. Every answer updates the rows as it arrives.
   */
  async learnProjects(projects: ReadonlyArray<ProjectLike>): Promise<void> {
    const ws = this.workspace
    if (!ws) return
    this.projectNames.applyList(projects)
    await this.projectNames.resolveAll(ws.client, projectFolders(projects))
  }

  /** The authoritative project of one folder, fetched on demand (a rename on a folder whose answer is not in yet). */
  async resolveProject(directory: string): Promise<{ projectID: string; name?: string } | undefined> {
    const ws = this.workspace
    if (!ws) return undefined
    const projectID = await this.projectNames.resolve(ws.client, directory)
    if (!projectID) return undefined
    return { projectID, name: this.projectNames.nameOf(directory) }
  }

  /**
   * Ask for a project name and save it. The dialog starts with the current name; an empty value gives the folder name
   * back. This writes only the project's display name on the OpenCode server: the folder on disk and the OpenCode
   * config files are never touched.
   */
  async renameProject(directory: string): Promise<boolean> {
    const ws = this.workspace
    if (!ws) {
      this.notify("warning", "Connect to a server first.")
      return false
    }
    let project: { projectID: string; name?: string } | undefined
    try {
      project = await this.resolveProject(directory)
    } catch (e) {
      this.notify("error", `Could not find this folder's project: ${errorMessage(e)}`)
      return false
    }
    if (!project) {
      this.notify("warning", "OpenCode has no project for this folder yet. Start a session in it first.")
      return false
    }
    const current = project.name ?? folderName(directory)
    const value = await this.ask({
      title: "Rename project",
      detail: "The name OpenCode shows for this project in the browser UI and on this phone.",
      confirm: "Save",
      input: {
        value: current,
        label: "Project name",
        placeholder: folderName(directory),
        help: "Leave it empty to use the folder name again.",
        maxLength: MAX_PROJECT_NAME,
        validate: (text) => {
          const check = checkProjectName(text)
          return check.ok ? undefined : check.error
        },
      },
    })
    if (value === undefined) return false
    const check = checkProjectName(value)
    if (!check.ok || (check.name ?? "") === (project.name ?? "")) return false
    try {
      // Only the project's display name on the server changes. The folder on disk and the OpenCode config files stay as
      // they are.
      const saved = await ws.client.project.update({ projectID: project.projectID, name: check.name ?? "" })
      this.projectNames.set(directory, project.projectID, normalizeProjectName(saved?.name) ?? check.name)
      this.notify("info", check.name ? `Renamed the project to “${check.name}”.` : "The project uses its folder name again.")
      return true
    } catch (e) {
      this.notify("error", `Could not rename the project: ${errorMessage(e)}`)
      return false
    }
  }

  /** A resolved project or a saved name: mirror it for the screens and relabel an open chat of that folder. */
  private setProject(directory: string, projectID: string | undefined, name: string | undefined): void {
    if (projectID) {
      const ids = new Map(this.projectIDs)
      ids.set(directory, projectID)
      this.projectIDs = ids
    }
    const title = normalizeProjectName(name)
    const titles = new Map(this.projectTitles)
    titles.set(directory, title)
    this.projectTitles = titles
    this.workspace?.get(directory)?.setFolderInfo(title ?? folderName(directory), shortenHome(directory, this.home))
  }

  private makeController(profile: Profile, project: ProjectInfo): Controller {
    const key = (name: string) => `occ.ctl.${profile.id}.${project.directory}.${name}`
    const ctl = new Controller({
      directory: project.directory,
      folderName: project.folderName,
      displayPath: project.displayPath,
      storage: { get: (k) => readJSON(key(k)), set: (k, v) => writeJSON(key(k), v) },
      pins: {
        get: () => {
          const v = readJSON(`occ.pins.${profile.id}`)
          return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
        },
        set: (pins) => writeJSON(`occ.pins.${profile.id}`, pins),
      },
      // The "Enhance prompt" model is independent of the session's model and stays on this phone, per server.
      enhanceModel: {
        get: () => parseEnhanceModel(readJSON(enhanceModelKey(profile.id))),
        set: (m) => writeJSON(enhanceModelKey(profile.id), m),
      },
      mcp: {},
    })
    // A controller made after a change already starts with what Settings shows.
    ctl.setSettings(this.viewSettings)
    const cache = new ImageCache({
      message: async (sessionID, messageID) => ctl.api?.session.message.get({ sessionID, messageID }),
      // This phone has no `file://` attachments: every image it sends is a data URI.
      file: async () => undefined,
    })
    this.caches.set(project.directory, cache)
    // Which session this project's chat shows now: the notification of that session is not needed while it is on screen.
    ctl.subscribe((s) => {
      const id = s.target.kind === "session" ? s.target.id : undefined
      if (this.viewing.get(project.directory) === id && this.viewing.has(project.directory)) return
      this.viewing.set(project.directory, id)
      this.syncVisible()
    })
    ctl.observe({
      resync: () => {
        if (this.synced.has(project.directory)) return
        this.synced = new Set([...this.synced, project.directory])
        const waiters = this.syncedWaiters.get(project.directory)
        if (waiters) {
          this.syncedWaiters.delete(project.directory)
          for (const done of waiters) done()
        }
      },
      event: (ev: EventEnvelope) => {
        // A rename in the browser UI or on another phone reaches every open controller's server-wide stream.
        if (ev.type === "project.updated") {
          this.projectNames.apply(ev)
          return
        }
        if (ev.type !== "session.inbox.enqueued") return
        const item = ev.data?.item
        if (item?.type === "user" && typeof ev.data?.inboxID === "string") cache.seed(ev.data.inboxID, item.payload?.files)
      },
    })
    return ctl
  }

  /** The image bytes of a message as a `data:` URI; undefined when gone or not an image. */
  async imageUri(directory: string, sessionID: string, ref: ImageRef): Promise<string | undefined> {
    const bytes = await this.caches.get(directory)?.get(sessionID, ref)
    return bytes && safeImageMime(bytes.mime) ? dataUri(bytes.mime, bytes.base64) : undefined
  }

  /* ------------------------------------------------------- app settings */

  /** Change chat display settings: save them and update every open chat right away. */
  setViewSettings(patch: Partial<ViewSettings>): void {
    this.viewSettings = patchViewSettings(this.viewSettings, patch)
    writeJSON(VIEW_KEY, this.viewSettings)
    this.applyViewSettings()
  }

  /** The "Enhance prompt" model saved for a server; undefined means its default model. */
  enhanceModelOf(profileID: string): ModelSelection | undefined {
    return parseEnhanceModel(readJSON(enhanceModelKey(profileID)))
  }

  /** Forget a server's enhancement model, so "Enhance prompt" uses the server default again. */
  resetEnhanceModel(profileID: string): void {
    writeJSON(enhanceModelKey(profileID), undefined)
    this.settingsTick++
    // The open chats of that server read the saved model on their next snapshot; this asks for one now.
    if (this.profile?.id === profileID) this.applyViewSettings()
  }

  /**
   * Put chat display and every server's enhancement model back to their defaults. Saved servers, sessions, passwords
   * and the notification switches are not touched.
   */
  resetAppSettings(): void {
    for (const key of resetSettingKeys(this.profiles.map((p) => p.id))) writeJSON(key, undefined)
    this.viewSettings = defaultViewSettings
    this.settingsTick++
    this.applyViewSettings()
  }

  /** Hand the current chat display settings to the controllers that are open. */
  private applyViewSettings(): void {
    const ws = this.workspace
    if (!ws) return
    for (const directory of ws.directories) ws.get(directory)?.setSettings(this.viewSettings)
  }

  /* ---------------------------------------------- background notifications */

  /** Hand the saved servers and the switches to the watching service (it keeps them encrypted and starts or stops). */
  async syncNotify(): Promise<void> {
    this.notifyStatus = await configureService(nativeServers(this.profiles), this.notifySettings)
  }

  async refreshNotifyStatus(): Promise<void> {
    this.notifyStatus = await serviceStatus()
  }

  async setNotify(patch: Partial<NotifySettings>): Promise<void> {
    this.notifySettings = { ...this.notifySettings, ...patch }
    // The version marks the file as v2, so a later read keeps a worker switch the owner turned back on.
    writeJSON(NOTIFY_KEY, { ...this.notifySettings, version: NOTIFY_VERSION })
    // Turning notifications on is the moment to ask Android for permission.
    if (patch.enabled === true) await askNotificationPermission()
    await this.syncNotify()
  }

  /**
   * After the first server that works: say in two sentences what the notifications are for, then ask Android. Asked once;
   * the Settings screen has the same switch for anyone who said no.
   */
  private async offerNotifications(): Promise<void> {
    if (!canWatchInBackground() || !this.notifySettings.enabled) return
    if (readJSON(NOTIFY_ASKED_KEY) === true) return
    writeJSON(NOTIFY_ASKED_KEY, true)
    const ok = await this.confirm({
      title: "Tell me when a session needs me?",
      detail:
        "The app can keep a quiet connection to your server and send a notification when a session asks for permission, has a question, or finishes, even when the app is closed. Each notification names the session and the project. You can change this in Settings.",
      confirm: "Turn on",
    })
    if (!ok) {
      this.notifySettings = { ...this.notifySettings, enabled: false }
      writeJSON(NOTIFY_KEY, { ...this.notifySettings, version: NOTIFY_VERSION })
      await this.syncNotify()
      return
    }
    await askNotificationPermission()
    await this.syncNotify()
    await this.offerBatteryExemption()
  }

  /** One time: the dialog that lets Android keep the connection alive while the screen is off. */
  private async offerBatteryExemption(): Promise<void> {
    if (readJSON(BATTERY_ASKED_KEY) === true) return
    await this.refreshNotifyStatus()
    if (this.notifyStatus.batteryUnrestricted) return
    writeJSON(BATTERY_ASKED_KEY, true)
    const ok = await this.confirm({
      title: "Keep notifications reliable?",
      detail:
        "Phones put idle apps to sleep and then miss events. The next screen asks Android to let this app run in the background. On Samsung phones you can also add it to “Never sleeping apps” (see Settings).",
      confirm: "Continue",
    })
    if (ok) await askBatteryExemption()
  }

  async askBattery(): Promise<void> {
    await askBatteryExemption()
    await this.refreshNotifyStatus()
  }

  openBatterySettings(): void {
    void openBatterySettings()
  }

  openNotificationSettings(): void {
    void openNotificationSettings()
  }

  /**
   * Tell the controllers which chat is on screen. Only a chat screen in the foreground, with no drawer or Settings
   * over it, is a look at its session; a turn that ends while something else is in front stays "New reply" in the
   * drawer.
   */
  private syncOnScreen(): void {
    const top = this.top.screen
    const covered = this.drawerOpen || this.settingsOpen
    const directory = this.foreground && !covered && top.kind === "chat" ? top.directory : undefined
    this.workspace?.showOnScreen(directory)
  }

  /** Tell the service which session is on screen (no notification for it) and clear that session's notification. */
  private syncVisible(): void {
    const top = this.top.screen as { kind: string; directory?: string; sessionID?: string }
    this.rememberLastUsed()
    const sessionID = visibleSessionOf(top, Object.fromEntries(this.viewing))
    const serverId = this.profile?.serverId
    const key = serverId && sessionID ? `${serverId}|${sessionID}` : ""
    if (key === this.shownSession) return
    this.shownSession = key
    void setVisibleSession(serverId, sessionID)
    if (serverId && sessionID) void clearSessionNotification(serverId, sessionID)
  }

  /** Remember the chat on screen for this server, so the next start (or a server switch back) opens it again. */
  private rememberLastUsed(): void {
    const id = this.profile?.id
    const top = this.top.screen
    if (!id || top.kind !== "chat") return
    const sessionID = this.viewing.get(top.directory) ?? top.sessionID
    writeJSON(lastUsedKey(id), { directory: top.directory, sessionID })
  }

  /* -------------------------------------------------------- deep link */

  /**
   * `opencode-mobile://session/<id>?server=<serverId>`: pick the server, find the folder, open the session.
   * Waits for the saved servers (a cold start delivers the link before they are loaded) and drops a repeat delivery.
   */
  openLink(raw: string): Promise<void> {
    return this.links.open(raw)
  }

  /** True when the link opened its session. */
  private async routeLink(raw: string): Promise<boolean> {
    const link = parseDeepLink(raw)
    if (!link) return false
    const bottom = (): Entry[] => [{ key: nextKey(), screen: { kind: "servers" } }]
    const route = routeDeepLink(link, this.profiles, this.activeID)
    if (route.kind === "no-servers") {
      this.setStack(bottom())
      this.notify("info", "Add a server first, then open the link again.")
      return false
    }
    if (route.kind === "unknown-server") {
      this.setStack(bottom())
      this.notify("warning", `This link is for the server “${route.serverId}”, which is not saved on this phone.`)
      return false
    }
    if (route.kind === "ambiguous") {
      this.setStack(bottom())
      this.notify("warning", "This link does not say which server it is for. Open the server first, then the link again.")
      return false
    }
    const ok = await this.connect(route.profile, false)
    if (!ok) {
      this.setStack(bottom())
      this.notify("error", this.problem?.message ?? "Could not connect to the server.")
      return false
    }
    let info: { title?: string; location?: { directory?: string }; parentID?: string } | undefined
    try {
      info = await this.client.session.get({ sessionID: link.sessionID })
    } catch {
      info = undefined
    }
    const directory = info?.location?.directory
    if (!directory) {
      await this.land()
      this.notify("warning", `That session was not found on ${route.profile.name}. It may have been deleted.`)
      return false
    }
    if (info?.parentID) {
      // A worker (child session) is read-only: its own screen, with the parent's chat under it when that is still there.
      let parentDirectory: string | undefined
      try {
        parentDirectory = (await this.client.session.get({ sessionID: info.parentID })).location?.directory
      } catch {
        parentDirectory = undefined
      }
      const parent = parentDirectory ? { directory: parentDirectory, sessionID: info.parentID } : undefined
      this.setStack(stackForWorker(directory, nextKey, link.sessionID, parent, this.serversInStack))
      return true
    }
    // The link already knows the session's name: the chat header is right before this project's controller has synced.
    this.setStack(stackForSession(directory, nextKey, link.sessionID, this.serversInStack, info?.title))
    return true
  }

  /* ----------------------------------------------------- toast, modal */

  notify(level: Toast["level"], text: string) {
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toast = { id: nextKey(), level, text }
    this.toastTimer = setTimeout(() => (this.toast = undefined), level === "error" ? 7000 : 4000)
  }

  dismissToast() {
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toast = undefined
  }

  confirm(spec: ModalSpec & { confirm: string }): Promise<boolean> {
    this.modal?.resolve(false)
    return new Promise((resolve) => {
      this.modal = { ...spec, id: nextKey(), resolve: (result) => resolve(result === true) }
    })
  }

  /** A dialog with one text field. Resolves with the text on Save and undefined on Cancel or back. */
  ask(spec: ModalSpec & { input: ModalInput }): Promise<string | undefined> {
    this.modal?.resolve(false)
    return new Promise((resolve) => {
      this.modal = { ...spec, id: nextKey(), resolve: (result) => resolve(typeof result === "string" ? result : undefined) }
    })
  }

  /** A dialog with one button per option. Resolves with the chosen id, or undefined on Cancel, the scrim or back. */
  choose<T extends string>(spec: ModalSpec & { options: ReadonlyArray<ModalOption<T>> }): Promise<T | undefined> {
    this.modal?.resolve(false)
    return new Promise((resolve) => {
      this.modal = { ...spec, id: nextKey(), resolve: (result) => resolve(choiceAnswer(spec.options, result)) }
    })
  }

  answer(ok: boolean) {
    const m = this.modal
    this.modal = undefined
    m?.resolve(ok)
  }

  /** A choice dialog's button. */
  answerChoice(id: string) {
    const m = this.modal
    this.modal = undefined
    m?.resolve(id)
  }

  /** Save the text of an input dialog (the field's Enter key and the confirm button). */
  answerInput(value: string) {
    const m = this.modal
    this.modal = undefined
    m?.resolve(value)
  }

  /* --------------------------------------------------- the shared UI */

  /** `/export`: choose Markdown or JSON, then share the file. A running session exports what is there so far. */
  private async exportSession(directory: string): Promise<void> {
    const controller = this.workspace?.get(directory)
    if (!controller?.currentSessionID) {
      this.notify("info", "Nothing to export yet.")
      return
    }
    const format = await this.chooseExportFormat()
    if (!format) return
    try {
      const file = await controller.exportSession(format)
      const saved = await saveExport(file.filename, file.content, format === "json" ? "application/json" : "text/markdown")
      // Closing the share sheet is the user's choice: no notice, and the cached copy is harmless.
      if (saved.how === "canceled") return
      const note = saved.how === "share" ? `Exported ${file.filename}.` : saved.how === "documents" ? `Saved ${file.filename} to Documents.` : `Downloaded ${file.filename}.`
      this.notify("info", file.running ? `${note} The session is still running, so the file holds what was written so far.` : note)
    } catch (e) {
      this.notify("error", `Could not export the session: ${errorMessage(e)}`)
    }
  }

  /** `/export`'s one dialog: a button per format, and Cancel. The labels are the same as VS Code's quick pick. */
  private chooseExportFormat(): Promise<ExportFormat | undefined> {
    return this.choose<ExportFormat>({
      title: "Export session",
      detail: "Markdown is a readable transcript; JSON is the full session data.",
      options: EXPORT_FORMATS.map((format) => ({ id: format.format, label: format.label })),
    })
  }

  /** What the editor did for the VS Code UI, as this app's screens. */
  hostFor(directory: string): MobileHost {
    return {
      openFile: (path, line) => this.push({ kind: "file", directory, path, line }),
      imageData: (sessionID, ref) => this.imageUri(directory, sessionID, ref),
      openImage: (sessionID, ref, name) => this.push({ kind: "image", directory, sessionID, ref, name }),
      openDiff: (file, patches) => this.push({ kind: "diff", directory, file, patches }),
      openChanges: (files, title) => this.push({ kind: "changes", directory, title: title ?? "Changes", files }),
      showTerminal: (shellID, title, sessionID) => this.push({ kind: "shell", directory, shellID, title, sessionID }),
      openWorker: (sessionID) => this.push({ kind: "worker", directory, sessionID }),
      pickFiles: async () => {
        const picked = await pickFiles()
        if (picked.problems.length > 0) this.notify("warning", picked.problems.join(" "))
        return picked.files
      },
      exportSession: () => void this.exportSession(directory),
      confirmRevert: () => this.confirm({ title: REVERT_TITLE, detail: REVERT_DETAIL, confirm: REVERT_BUTTON, danger: true }),
      confirmDeleteSession: (title) => this.confirm({ title: deleteQuestion(title), detail: DELETE_DETAIL, confirm: DELETE_BUTTON, danger: true }),
      openExternal: (url) => void openInBrowser(url),
      notify: (level, message) => this.notify(level, message),
      reconnect: () => this.workspace?.get(directory)?.reconnect(),
    }
  }
}

export const model = new AppModel()
