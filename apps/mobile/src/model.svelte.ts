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
import { deleteQuestion, DELETE_BUTTON, DELETE_DETAIL } from "@occ/core/delete-session"
import { normalizeServerUrl } from "@occ/core/server-url"
import { makeClient, redeemPairing, testConnection } from "./lib/client"
import { parseDeepLink, routeDeepLink } from "./lib/deep-link"
import { canPop, directoriesInUse, pop, popKey, push, stackForSession, type Entry, type Screen } from "./lib/nav"
import { parsePairingLink } from "./lib/pairing-link"
import { pickFiles } from "./lib/picker"
import { launchUrl, onHardwareBack, onResume, onUrlOpen, openInBrowser } from "./lib/platform"
import { ProfileStore, type Profile, type ProfileInput } from "./lib/profiles"
import { secureKV } from "./lib/secure"
import { REVERT_BUTTON, REVERT_DETAIL, REVERT_TITLE } from "./lib/texts"
import { Workspace, type ProjectInfo } from "./lib/workspace"
import type { MobileHost } from "./lib/bridge"

export type Toast = { id: number; level: "info" | "warning" | "error"; text: string }
export type ModalSpec = { title: string; detail?: string; confirm: string; danger?: boolean }
type Modal = ModalSpec & { resolve: (ok: boolean) => void }
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

  /** The home folder seen in the project list, for `~` in paths. */
  home: string | undefined

  private readonly store = new ProfileStore(secureKV)
  private workspace: Workspace<Controller> | undefined
  /** Project folders whose controller finished a sync (reactive: a chat screen waits for it before opening a session). */
  private synced = $state.raw<ReadonlySet<string>>(new Set())
  private readonly caches = new Map<string, ImageCache>()
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private lastLink = { url: "", at: 0 }
  private started = false

  /* ----------------------------------------------------------- start */

  async init(): Promise<void> {
    if (this.started) return
    this.started = true
    onHardwareBack(() => this.back())
    onResume(() => this.workspace?.resume())
    onUrlOpen((url) => void this.openLink(url))
    this.profiles = await this.store.list()
    this.activeID = await this.store.activeID()
    const launch = await launchUrl()
    this.ready = true
    if (launch && parseDeepLink(launch)) {
      await this.openLink(launch)
      return
    }
    const last = this.profiles.find((p) => p.id === this.activeID)
    if (last) await this.connect(last)
  }

  /* ------------------------------------------------------------ stack */

  get top(): Entry {
    return this.stack[this.stack.length - 1]!
  }

  private setStack(next: Entry[]) {
    this.stack = next
    this.settle()
  }

  push(screen: Screen) {
    this.setStack(push(this.stack, screen, nextKey()))
  }

  pop() {
    this.setStack(pop(this.stack))
  }

  /** Close the screen with this key, unless something else has been opened above it since. */
  close(key: number) {
    this.setStack(popKey(this.stack, key))
  }

  /** Android back: a dialog first, then the top screen. False at the bottom: the app leaves. */
  back(): boolean {
    if (this.modal) {
      this.answer(false)
      return true
    }
    if (!canPop(this.stack)) return false
    this.pop()
    return true
  }

  /** Dispose the controllers of projects that no screen shows any more; leave the server when its list is gone. */
  private settle() {
    const ws = this.workspace
    if (!ws) return
    if (!this.stack.some((e) => e.screen.kind === "projects")) {
      this.closeWorkspace()
      return
    }
    for (const dir of ws.keepOnly(directoriesInUse(this.stack))) this.drop(dir)
  }

  private drop(dir: string) {
    this.synced = new Set([...this.synced].filter((d) => d !== dir))
    this.caches.get(dir)?.clear()
    this.caches.delete(dir)
  }

  private closeWorkspace() {
    for (const dir of this.workspace?.directories ?? []) this.drop(dir)
    this.workspace?.dispose()
    this.workspace = undefined
    this.profile = undefined
  }

  /* ---------------------------------------------------------- servers */

  async saveProfile(input: ProfileInput): Promise<Profile> {
    const saved = await this.store.save(input)
    this.profiles = await this.store.list()
    return saved
  }

  async removeProfile(id: string): Promise<void> {
    await this.store.remove(id)
    this.profiles = await this.store.list()
    if (this.activeID === id) this.activeID = undefined
    if (this.profile?.id === id) this.closeWorkspace()
  }

  /**
   * Test the server, then open its project list. `navigate: false` keeps the screens as they are (a deep link builds its
   * own). Returns false when the server cannot be used; `problem` says why and the server list shows it.
   */
  async connect(profile: Profile, navigate = true): Promise<boolean> {
    if (this.workspace && this.profile?.id === profile.id) {
      if (navigate) this.setStack([this.stack[0]!, { key: nextKey(), screen: { kind: "projects" } }])
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
    const fresh = this.profiles.find((p) => p.id === profile.id) ?? profile
    this.closeWorkspace()
    this.profile = fresh
    this.workspace = new Workspace(makeClient(fresh), (project) => this.makeController(fresh, project))
    if (navigate) this.setStack([{ key: nextKey(), screen: { kind: "servers" } }, { key: nextKey(), screen: { kind: "projects" } }])
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
    return ws.acquire({ directory, folderName: folderName(directory), displayPath: shortenHome(directory, this.home) })
  }

  /** Has this project's controller finished its first sync? */
  isSynced(directory: string): boolean {
    return this.synced.has(directory)
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
      mcp: {},
    })
    const cache = new ImageCache({
      message: async (sessionID, messageID) => ctl.api?.session.message.get({ sessionID, messageID }),
      // This phone has no `file://` attachments: every image it sends is a data URI.
      file: async () => undefined,
    })
    this.caches.set(project.directory, cache)
    ctl.observe({
      resync: () => {
        if (!this.synced.has(project.directory)) this.synced = new Set([...this.synced, project.directory])
      },
      event: (ev: EventEnvelope) => {
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

  /* -------------------------------------------------------- deep link */

  /** `opencode-mobile://session/<id>?server=<serverId>`: pick the server, find the folder, open the session. */
  async openLink(raw: string): Promise<void> {
    const link = parseDeepLink(raw)
    if (!link) return
    const now = Date.now()
    if (this.lastLink.url === raw && now - this.lastLink.at < LINK_DEDUPE_MS) return
    this.lastLink = { url: raw, at: now }
    const bottom = (): Entry[] => [{ key: nextKey(), screen: { kind: "servers" } }]
    const route = routeDeepLink(link, this.profiles, this.activeID)
    if (route.kind === "no-servers") {
      this.setStack(bottom())
      return this.notify("info", "Add a server first, then open the link again.")
    }
    if (route.kind === "unknown-server") {
      this.setStack(bottom())
      return this.notify("warning", `This link is for the server “${route.serverId}”, which is not saved on this phone.`)
    }
    if (route.kind === "ambiguous") {
      this.setStack(bottom())
      return this.notify("warning", "This link does not say which server it is for. Open the server first, then the link again.")
    }
    const ok = await this.connect(route.profile, false)
    if (!ok) {
      this.setStack(bottom())
      return this.notify("error", this.problem?.message ?? "Could not connect to the server.")
    }
    let directory: string | undefined
    try {
      directory = (await this.client.session.get({ sessionID: link.sessionID })).location?.directory
    } catch {
      directory = undefined
    }
    if (!directory) {
      this.setStack([...bottom(), { key: nextKey(), screen: { kind: "projects" } }])
      return this.notify("warning", `That session was not found on ${route.profile.name}. It may have been deleted.`)
    }
    this.setStack(stackForSession(directory, nextKey, link.sessionID))
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

  confirm(spec: ModalSpec): Promise<boolean> {
    this.modal?.resolve(false)
    return new Promise((resolve) => {
      this.modal = { ...spec, resolve }
    })
  }

  answer(ok: boolean) {
    const m = this.modal
    this.modal = undefined
    m?.resolve(ok)
  }

  /* --------------------------------------------------- the shared UI */

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
      confirmRevert: () => this.confirm({ title: REVERT_TITLE, detail: REVERT_DETAIL, confirm: REVERT_BUTTON, danger: true }),
      confirmDeleteSession: (title) => this.confirm({ title: deleteQuestion(title), detail: DELETE_DETAIL, confirm: DELETE_BUTTON, danger: true }),
      openExternal: (url) => void openInBrowser(url),
      notify: (level, message) => this.notify(level, message),
      reconnect: () => this.workspace?.get(directory)?.reconnect(),
    }
  }
}

export const model = new AppModel()
