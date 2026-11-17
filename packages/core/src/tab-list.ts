/**
 * The open session tabs and how they are written back. The rules are in `session-tabs.ts`; this keeps the list and
 * decides when to write it: at once when the set of tabs changes (open, close, a confirmed deletion, a move), and at
 * most every `REMEMBER_MS` for the titles and activity times it keeps so a restored strip reads right.
 *
 * Plain TypeScript with an injectable cell and timer, so it is tested without Svelte: the UI wraps it with a reactive
 * cell (`packages/ui/src/tab-list.svelte.ts`).
 */
import { closeTab, moveTab, openTab, parseTabs, rememberTabs, type SessionTab, type TabInfo } from "./session-tabs"

/** Where the tabs are kept: the host's own store (VS Code: the webview state; the phone: its key-value store). */
export type TabStorage = { get<T>(key: string): T | undefined; set(key: string, value: unknown): void }

/** Holds the current list. The UI passes a reactive one so the strip redraws; the default is a plain variable. */
export type TabCell = { get(): SessionTab[]; set(tabs: SessionTab[]): void }

/** Runs `fn` after `ms`; returns a cancel function. */
export type Schedule = (fn: () => void, ms: number) => () => void

/** The storage key of the open tabs in the host's own store (VS Code: the webview state, so one list per window). */
export const TABS_KEY = "sessionTabs"

/** Title and activity updates are written at most this often; opening and closing a tab are written at once. */
export const REMEMBER_MS = 2000

/** A store that keeps nothing: the tabs of a phone that has no saved server live only as long as the app. */
export const NO_STORAGE: TabStorage = { get: () => undefined, set: () => {} }

const plainCell = (): TabCell => {
  let tabs: SessionTab[] = []
  return { get: () => tabs, set: (next) => void (tabs = next) }
}

const timeout: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms)
  return () => clearTimeout(timer)
}

export class TabListCore {
  private cancel: (() => void) | undefined

  constructor(
    private readonly storage: TabStorage,
    private readonly key: string = TABS_KEY,
    private readonly cell: TabCell = plainCell(),
    private readonly schedule: Schedule = timeout,
  ) {
    this.cell.set(parseTabs(storage.get(key)))
  }

  get tabs(): SessionTab[] {
    return this.cell.get()
  }

  /** Open a session as a tab; past the cap the least recently active tab other than `current` goes. */
  open(tab: SessionTab, current?: string): void {
    this.set(openTab(this.tabs, tab, current), true)
  }

  /** Close a tab. The session itself is untouched. */
  close(id: string): void {
    this.set(closeTab(this.tabs, id), true)
  }

  /** The server confirmed the session deleted. */
  remove(id: string): void {
    this.set(closeTab(this.tabs, id), true)
  }

  /** The server says the session lives in another folder now. */
  move(id: string, directory: string): void {
    this.set(moveTab(this.tabs, id, directory), true)
  }

  /** Keep the newest titles, activity times and folders, so a restored strip reads right before the lists arrive. */
  remember(known: (id: string) => TabInfo | undefined): void {
    this.set(rememberTabs(this.tabs, known), false)
  }

  /** Write anything still pending (the view is going away). */
  flush(): void {
    if (!this.cancel) return
    this.cancel()
    this.cancel = undefined
    this.write()
  }

  private set(next: SessionTab[], now: boolean): void {
    if (next === this.tabs) return
    this.cell.set(next)
    if (now) {
      this.cancel?.()
      this.cancel = undefined
      this.write()
    } else if (!this.cancel) {
      this.cancel = this.schedule(() => {
        this.cancel = undefined
        this.write()
      }, REMEMBER_MS)
    }
  }

  private write(): void {
    this.storage.set(this.key, this.tabs)
  }
}
