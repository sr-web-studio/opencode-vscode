<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { AppState } from "@occ/core/protocol"
  import { folderName } from "@occ/core/paths"
  import { statusLabel } from "@occ/core/session-status"
  import { DRAFT_TITLE, UNTITLED } from "@occ/core/sessions"
  import {
    attentionStatus,
    fitTabs,
    heldOrder,
    nextAfterClose,
    orderTabs,
    OwnSessionsMemo,
    sameNumbers,
    tabSessions as buildTabSessions,
    TabVerifier,
    type TabEntry,
    type TabInfo,
    type TabSession,
  } from "@occ/core/session-tabs"
  import { useStore } from "../context"
  import { registerBackOverlay } from "../back-overlay"
  import { restoreFocus } from "../focus"
  import type { TabsHost } from "../tabs-host"
  import Codicon from "./Codicon.svelte"
  import ProjectAvatar from "./ProjectAvatar.svelte"
  import SessionStatusIcon from "./SessionStatusIcon.svelte"
  import TabsMenu from "./TabsMenu.svelte"

  /**
   * The session tab strip at the top of the chat, like OpenCode Desktop's: the sessions list button, search, one tab
   * per open session (project avatar, title, status), the overflow arrow and `+`. Tabs are the sessions the user has
   * opened; closing one only takes it off the strip. The rules (order, fit, cap, when a tab is gone) are in
   * `@occ/core/session-tabs`; the host decides where the sessions come from and how a tab opens (`TabsHost`).
   */
  let { app, host, hasDraftText }: { app: AppState; host: TabsHost; hasDraftText: boolean } = $props()
  const store = useStore()

  /** Space between two tabs, in px; the same as the CSS `gap` below. */
  const GAP = 2

  // The statuses age (a reply stops being new, a turn stops counting as recent) on the sessions pane's own 30 s beat.
  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(timer)
  })

  const currentID = $derived(app.target.kind === "session" ? app.target.id : undefined)
  const draft = $derived(app.target.kind === "draft")
  const catalog = $derived(host.catalog(now))
  const byId = $derived(new Map(catalog.sessions.map((session) => [session.id, session])))
  const projects = $derived(new Set(catalog.sessions.map((session) => session.directory)).size)
  // The chat's own records (an archived session is in no host list but still has a title). A streamed answer replaces
  // `app` without touching these lists, so the memo hands back the same map and nothing below runs again.
  const ownMemo = new OwnSessionsMemo()
  const own = $derived(ownMemo.get(app.sessions, app.archived))

  /** What the strip knows about a session: the host's row, else the chat's record. */
  function known(id: string): TabInfo | undefined {
    const row = byId.get(id)
    if (row) return { title: row.title, last: row.last, directory: row.directory }
    const mine = own.get(id)
    return mine ? { title: mine.title || UNTITLED, last: mine.last } : undefined
  }

  // Opening a session from anywhere (the pane, the drawer, a notification, a link, this strip) adds its tab. Only a
  // change of session counts: a title update must not bring back a tab the user just closed.
  let lastOpened: string | undefined
  $effect(() => {
    const id = currentID
    if (id === lastOpened) return
    lastOpened = id
    if (!id) return
    untrack(() => {
      const info = known(id)
      host.list.open({ id, directory: info?.directory ?? app.directory, title: info?.title, last: info?.last }, id)
    })
  })

  // A tab closes on its own only when the server confirms its session deleted. Tabs no list carries are looked up a
  // few at a time; a session that moved to another folder keeps its tab and opens in its new folder.
  const verifier = untrack(
    () =>
      new TabVerifier(
        (tab) => host.lookup?.(tab) ?? Promise.resolve({ state: "unknown" as const }),
        (verdict) => {
          if (verdict.gone) {
            if (verdict.id !== currentID) host.list.remove(verdict.id)
          } else if (verdict.directory) host.list.move(verdict.id, verdict.directory)
        },
      ),
  )
  $effect(() => {
    if (!host.lookup || catalog.loading) return
    const tabs = host.list.tabs
    const listed = catalog.listed
    const keep = new Set(currentID ? [currentID] : [])
    void now
    untrack(() => verifier.update(tabs, listed, keep))
  })
  $effect(() => () => verifier.stop())

  // Titles, activity times and folders are kept with the tabs, so a restored strip reads right before the lists arrive.
  $effect(() => {
    void byId
    void own
    untrack(() => host.list.remember(known))
  })

  /** The strip's sessions, with a fallback for a tab whose session no list carries yet. */
  const tabSessions = $derived(buildTabSessions(host.list.tabs, byId, own, { untitled: UNTITLED, project: folderName }))

  /* -------------------------------------------------------------- order */

  /** The order is held while the pointer or the keyboard is in the strip, or its dropdown is open: no tab moves then. */
  let frozen = $state<string[] | undefined>()
  let pointerInside = $state(false)
  let focusInside = $state(false)
  let menu = $state<"overflow" | "search" | undefined>()
  const live = $derived(orderTabs(host.list.tabs, (id) => tabSessions.get(id)))
  const order = $derived(heldOrder(frozen, live))
  $effect(() => {
    const hold = pointerInside || focusInside || !!menu
    untrack(() => {
      if (hold && !frozen) frozen = order
      else if (!hold) frozen = undefined
    })
  })

  /** The tabs in strip order; a draft is the newest, so its "New session" tab comes first. */
  const entries = $derived<TabEntry[]>([
    ...(draft ? [{ kind: "draft" } as const] : []),
    ...order.flatMap((id): TabEntry[] => {
      const session = tabSessions.get(id)
      return session ? [{ kind: "session", session }] : []
    }),
  ])
  const activeIndex = $derived(draft ? 0 : entries.findIndex((entry) => entry.kind === "session" && entry.session.id === currentID))

  /* ---------------------------------------------------------------- fit */

  let strip: HTMLDivElement | undefined = $state()
  let nav: HTMLElement | undefined = $state()
  let area: HTMLDivElement | undefined = $state()
  let measure: HTMLDivElement | undefined = $state()
  let available = $state(Number.POSITIVE_INFINITY)
  /** The narrowest and widest a tab may be and the overflow button's width, in px: read once from three hidden probes. */
  let sizes = $state.raw<number[]>([0, 0, 0])

  /**
   * Read the probes and the row's width. Every tab has the same width, so nothing depends on the titles: only the row's
   * size and the probes (which follow the font size) matter. The state is written only when a value changed, so an
   * unchanged strip does not re-fit.
   */
  function remeasure(): void {
    if (!area || !measure) return
    const [min, max, more] = [...measure.children].map((el) => el.getBoundingClientRect().width)
    const next = [min ?? 0, max ?? 0, more ?? 0]
    // The `+` always follows the tabs.
    const nextAvailable = area.clientWidth - next[2]! - GAP
    if (!sameNumbers(next, sizes)) sizes = next
    if (nextAvailable !== available) available = nextAvailable
  }

  $effect(() => {
    if (!area || !measure || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => remeasure())
    observer.observe(area)
    observer.observe(measure)
    remeasure()
    return () => observer.disconnect()
  })
  // The overflow button's width follows its count's digits.
  $effect(() => {
    void entries.length
    queueMicrotask(remeasure)
  })

  const measured = $derived(sizes[1]! > 0)
  const fit = $derived(
    measured
      ? fitTabs(entries.length, available, { gap: GAP, overflow: sizes[2]!, min: sizes[0]!, max: sizes[1]!, active: activeIndex < 0 ? undefined : activeIndex })
      : { visible: entries.map((_, i) => i), hidden: [], width: 0 },
  )
  const visible = $derived(fit.visible.map((index) => entries[index]!))
  const hiddenSessions = $derived(fit.hidden.flatMap((index) => (entries[index]?.kind === "session" ? [(entries[index] as { session: TabSession }).session] : [])))

  /* ------------------------------------------------------------ actions */

  function select(session: TabSession): void {
    menu = undefined
    if (session.id === currentID) return
    host.list.open({ id: session.id, directory: session.directory, title: session.title, last: session.last }, currentID)
    host.open(session.id, session.directory)
  }

  /** Close a tab. The session stays on the server; closing the one on screen moves to the next tab, else a new session. */
  function close(id: string): void {
    if (id === currentID) {
      const next = nextAfterClose(order, id)
      const session = next ? tabSessions.get(next) : undefined
      host.list.close(id)
      if (session) host.open(session.id, session.directory)
      else store.dispatch({ type: "newDraft", hasText: false })
      return
    }
    host.list.close(id)
  }

  /**
   * Close a tab from the strip itself (its ×, Delete). When the keyboard was on the strip, it moves to the tab that
   * took the closed one's place, else the last tab, else the search button: never lost to the page.
   */
  function closeFromStrip(id: string): void {
    const picks = [...(nav?.querySelectorAll<HTMLElement>(".pick") ?? [])]
    const at = picks.findIndex((el) => el.dataset.id === id)
    const hadFocus = !!strip?.contains(document.activeElement)
    close(id)
    if (!hadFocus) return
    void tick().then(() => {
      const left = [...(nav?.querySelectorAll<HTMLElement>(".pick") ?? [])]
      restoreFocus(left[Math.min(Math.max(at, 0), left.length - 1)] ?? strip?.querySelector<HTMLElement>("[data-search]"), strip)
    })
  }

  /** The draft's tab: closing it goes back to the newest open tab. */
  function closeDraft(): void {
    const first = order[0] ? tabSessions.get(order[0]) : undefined
    if (first) host.open(first.id, first.directory)
  }

  function newSession(): void {
    menu = undefined
    store.dispatch({ type: "newDraft", hasText: hasDraftText })
  }

  // While the menu is open, a hardware Back button (Android) closes it like Escape does.
  $effect(() => {
    if (!menu) return
    return registerBackOverlay(() => dismiss(true))
  })

  function toggleMenu(kind: "overflow" | "search"): void {
    menu = menu === kind ? undefined : kind
  }

  /** Escape gives the keyboard back to the button that opened the menu (the menu is still in the strip right now). */
  function dismiss(refocus: boolean): void {
    const kind = menu
    if (refocus) restoreFocus(strip?.querySelector<HTMLElement>(kind === "search" ? "[data-search]" : "[data-overflow]") ?? strip?.querySelector<HTMLElement>("[data-search]"), strip)
    menu = undefined
  }

  function tabKey(e: KeyboardEvent, id: string): void {
    if (e.key === "Delete") {
      e.preventDefault()
      closeFromStrip(id)
    }
  }

  function focusOut(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null
    if (!next || !strip?.contains(next)) focusInside = false
  }

  const tabLabel = (session: TabSession): string =>
    [session.title, projects > 1 ? session.project : undefined, statusLabel(session.status), session.id === currentID ? "current tab" : undefined].filter(Boolean).join(", ")
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="strip" bind:this={strip} onpointerenter={() => (pointerInside = true)} onpointerleave={() => (pointerInside = false)} onfocusin={() => (focusInside = true)} onfocusout={focusOut}>
  {#if host.sessions}
    <button
      class="btn"
      class:on={host.sessions.pressed?.()}
      onclick={() => host.sessions?.toggle()}
      title={host.sessions.label}
      aria-label={host.sessions.label}
      aria-pressed={host.sessions.pressed?.()}><Codicon name="layout" /></button
    >
  {/if}
  <button
    class="btn"
    class:on={menu === "search"}
    data-search
    data-tabs-trigger
    onclick={() => toggleMenu("search")}
    title="Search sessions"
    aria-label="Search sessions"
    aria-expanded={menu === "search"}><Codicon name="search" /></button
  >
  <div class="area" bind:this={area}>
    <nav class="tabs" aria-label="Open sessions" bind:this={nav}>
      {#each visible as entry (entry.kind === "draft" ? "\u0000draft" : entry.session.id)}
        {@render tab(entry)}
      {/each}
    </nav>
    {#if hiddenSessions.length > 0}
      <button
        class="btn more"
        class:on={menu === "overflow"}
        data-overflow
        data-tabs-trigger
        onclick={() => toggleMenu("overflow")}
        title="{hiddenSessions.length} more open {hiddenSessions.length === 1 ? 'tab' : 'tabs'} and all sessions"
        aria-label="{hiddenSessions.length} more open {hiddenSessions.length === 1 ? 'tab' : 'tabs'} and all sessions"
        aria-expanded={menu === "overflow"}><Codicon name="chevron-down" /><span class="count">{hiddenSessions.length}</span></button
      >
    {/if}
    <button class="btn" onclick={newSession} title="New session" aria-label="New session"><Codicon name="add" /></button>
  </div>
  <!-- Invisible probes the fit is computed from: the narrowest tab, the widest tab, and the overflow button. -->
  <div class="clip" aria-hidden="true" inert>
    <div class="measure" bind:this={measure}>
      <span class="probe-min"></span>
      <span class="probe-max"></span>
      <span class="btn more"><Codicon name="chevron-down" /><span class="count">{Math.max(hiddenSessions.length, 1)}</span></span>
    </div>
  </div>
  {#if menu}
    <TabsMenu
      hidden={hiddenSessions}
      sessions={catalog.sessions}
      loading={catalog.loading}
      showProject={projects > 1}
      {currentID}
      focusFilter={menu === "search"}
      onopen={select}
      onclose={close}
      ondismiss={dismiss}
    />
  {/if}
</div>

{#snippet tab(entry: TabEntry)}
  {#if entry.kind === "draft"}
    <div class="tab active" style:width={fit.width > 0 ? `${fit.width}px` : undefined}>
      <button class="pick" aria-current="page" title={DRAFT_TITLE}>
        <span class="avatar-new"><Codicon name="edit" /></span>
        <span class="title">{DRAFT_TITLE}</span>
      </button>
      {#if order.length > 0}
        <span class="end">
          <span class="slot">
            <button class="x" onclick={closeDraft} title="Close tab" aria-label="Close tab {DRAFT_TITLE}"><Codicon name="close" /></button>
          </span>
        </span>
      {/if}
    </div>
  {:else}
    {@const session = entry.session}
    {@const active = session.id === currentID}
    {@const attention = attentionStatus(session.status)}
    <div class="tab" class:active class:unread={session.status === "unread"} data-status={session.status} style:width={fit.width > 0 ? `${fit.width}px` : undefined}>
      <button
        class="pick"
        data-id={session.id}
        aria-current={active ? "page" : undefined}
        aria-label={tabLabel(session)}
        title={tabLabel(session)}
        onclick={() => select(session)}
        onauxclick={(e) => {
          if (e.button !== 1) return
          e.preventDefault()
          close(session.id)
        }}
        onkeydown={(e) => tabKey(e, session.id)}
      >
        <ProjectAvatar name={session.project} directory={session.directory} />
        <span class="title">{session.title}</span>
      </button>
      <!-- A running, waiting or failed tab keeps its icon in view, with the close button beside it. Any other status
           shares one slot with the close button, which is as wide as the button whether it shows or not: the tab
           keeps its width under the pointer. -->
      <span class="end">
        {#if attention}<span class="status"><SessionStatusIcon status={session.status} quiet /></span>{/if}
        <span class="slot">
          {#if !attention}<span class="status plain"><SessionStatusIcon status={session.status} quiet /></span>{/if}
          <button class="x" onclick={() => closeFromStrip(session.id)} title="Close tab (the session is kept)" aria-label="Close tab {session.title}"><Codicon name="close" /></button>
        </span>
      </span>
    </div>
  {/if}
{/snippet}

<style>
  .strip {
    --tab-row: max(var(--oc-menu-row), 28px);
    --tab-x: max(calc(var(--tab-row) - 8px), 20px);
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px calc(var(--oc-edge) - 4px);
    border-bottom: 1px solid var(--oc-hairline);
    min-width: 0;
  }
  .area {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .tabs {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    overflow: hidden;
  }
  .btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: var(--tab-row);
    height: var(--tab-row);
    padding: 0 4px;
    border-radius: 4px;
    color: var(--oc-muted);
  }
  .btn:hover,
  .btn.on {
    color: var(--oc-fg);
    background: var(--oc-hover);
  }
  .count {
    font-size: 0.8em;
  }
  .tab {
    position: relative;
    /* The width is set by the fit: one width for every tab, the active one included. */
    flex: none;
    display: flex;
    align-items: center;
    height: var(--tab-row);
    border-radius: 4px;
    color: var(--oc-muted);
  }
  .tab.active {
    background: var(--oc-selected);
    color: var(--oc-selected-fg);
  }
  .tab:not(.active):hover {
    background: var(--oc-hover);
    color: var(--oc-fg);
  }
  .tab.unread .title {
    font-weight: 600;
    color: var(--oc-fg);
  }
  /* Not `.link`: the global link class would colour and underline the tab, and the phone pads chat links to 44px. */
  .pick {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 0.45em;
    padding: 0 0.25em 0 0.45em;
    border-radius: 4px;
    text-align: left;
  }
  .pick:focus-visible,
  .x:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .avatar-new {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35em;
    height: 1.35em;
  }
  .end {
    flex: none;
    display: inline-flex;
    align-items: center;
    padding-right: 2px;
  }
  .status {
    display: inline-flex;
    padding: 0 2px;
  }
  /* `quiet` draws nothing for a read session. */
  .status:empty {
    display: none;
  }
  /* One fixed slot, as wide as the close button, for the plain status or the close button: never a width change. */
  .slot {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--tab-x);
    height: var(--tab-x);
  }
  .x {
    position: absolute;
    inset: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    color: inherit;
    visibility: hidden;
  }
  .x:hover {
    background: var(--oc-hover);
  }
  .tab.active .x,
  .tab:hover .x,
  .tab:focus-within .x {
    visibility: visible;
  }
  .tab:is(.active, :hover, :focus-within) .plain {
    visibility: hidden;
  }
  /* A finger has no hover: only the tab on screen offers its close button, and it is full size. */
  @media (hover: none) {
    .tab.active .slot {
      width: var(--tab-row);
      height: var(--tab-row);
    }
    /* Nothing ever replaces an inactive tab's status here, so its slot only takes the status's own room. */
    .tab:not(.active) .slot {
      width: auto;
    }
    .tab:not(.active) .x {
      display: none;
    }
    .tab:not(.active) .plain {
      visibility: visible;
    }
  }
  .clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }
  .measure {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    display: flex;
    gap: 2px;
    white-space: nowrap;
  }
  .measure > :global(*) {
    flex: none;
  }
  /* The narrowest tab keeps a readable title: the avatar, about 8 characters and the status or close slot. */
  .probe-min {
    width: 9.5em;
  }
  .probe-max {
    width: 14em;
  }
  /* A phone is narrow: a smaller narrowest tab (still about 6 characters of title) leaves room for a second tab. */
  @media (hover: none) {
    .probe-min {
      width: 8em;
    }
  }
  /* The close button's own `visibility: visible` would otherwise show through the hidden copies. */
  .clip :global(*) {
    visibility: hidden !important;
  }
</style>
