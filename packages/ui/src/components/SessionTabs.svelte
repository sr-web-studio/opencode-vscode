<script lang="ts">
  import { untrack } from "svelte"
  import type { AppState } from "@occ/core/protocol"
  import { folderName } from "@occ/core/paths"
  import { statusLabel } from "@occ/core/session-status"
  import { DRAFT_TITLE, UNTITLED } from "@occ/core/sessions"
  import { fitTabs, heldOrder, nextAfterClose, orderTabs, type TabSession } from "@occ/core/session-tabs"
  import { useStore } from "../context"
  import { restoreFocus } from "../focus"
  import type { TabsHost } from "../tabs-host"
  import Codicon from "./Codicon.svelte"
  import ProjectAvatar from "./ProjectAvatar.svelte"
  import SessionStatusIcon from "./SessionStatusIcon.svelte"
  import TabsMenu from "./TabsMenu.svelte"

  /**
   * The session tab strip at the top of the chat, like OpenCode Desktop's: the sessions list button, search, one tab
   * per open session (project avatar, title, status), the overflow arrow and `+`. Tabs are the sessions the user has
   * opened; closing one only takes it off the strip. The rules (order, fit, prune) are in `@occ/core/session-tabs`;
   * the host decides where the sessions come from and how a tab opens (`TabsHost`).
   */
  let { app, host, hasDraftText }: { app: AppState; host: TabsHost; hasDraftText: boolean } = $props()
  const store = useStore()

  /** Space between two tabs, in px; the same as the CSS `gap` below. */
  const GAP = 2

  const currentID = $derived(app.target.kind === "session" ? app.target.id : undefined)
  const draft = $derived(app.target.kind === "draft")
  const catalog = $derived(host.catalog())
  const byId = $derived(new Map(catalog.sessions.map((session) => [session.id, session])))
  const projects = $derived(new Set(catalog.sessions.map((session) => session.directory)).size)

  /** The chat's own record of a session: an archived one is not in the host's list but still has a title. */
  function ownTitle(id: string): string | undefined {
    return (app.sessions.find((s) => s.id === id) ?? app.archived.find((s) => s.id === id))?.title?.trim() || undefined
  }

  /** What the strip knows about a session: the host's row, else the chat's record, else what the tab remembered. */
  function known(id: string): Pick<TabSession, "title" | "last"> | undefined {
    const row = byId.get(id)
    if (row) return { title: row.title, last: row.last }
    const own = app.sessions.find((s) => s.id === id) ?? app.archived.find((s) => s.id === id)
    return own ? { title: own.title?.trim() || UNTITLED, last: Math.max(own.time.updated, own.time.created) } : undefined
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
      host.list.open({ id, directory: byId.get(id)?.directory ?? app.directory, title: info?.title ?? ownTitle(id), last: info?.last })
    })
  })

  // Sessions deleted on the server leave the strip; a list that is loading or cut off proves nothing.
  $effect(() => {
    const proofs = catalog.proofs
    const keep = new Set(currentID ? [currentID] : [])
    untrack(() => host.list.prune(proofs, keep))
  })

  // Titles and activity times are kept with the tabs, so a restored strip reads right before the lists arrive.
  $effect(() => {
    void byId
    untrack(() => host.list.remember(known))
  })

  /** The strip's sessions, with a fallback for a tab whose session no list carries yet. */
  const tabSessions = $derived(
    new Map(
      host.list.tabs.map((tab): [string, TabSession] => {
        const row = byId.get(tab.id)
        if (row) return [tab.id, row]
        return [tab.id, { id: tab.id, directory: tab.directory, title: ownTitle(tab.id) ?? tab.title ?? UNTITLED, project: folderName(tab.directory), status: "read", last: tab.last ?? 0 }]
      }),
    ),
  )

  /* -------------------------------------------------------------- order */

  /** The order is held while the pointer is over the strip or its dropdown is open, so a tab never moves under it. */
  let frozen = $state<string[] | undefined>()
  let pointerInside = $state(false)
  let menu = $state<"overflow" | "search" | undefined>()
  const live = $derived(orderTabs(host.list.tabs, (id) => tabSessions.get(id)))
  const order = $derived(heldOrder(frozen, live))
  $effect(() => {
    const hold = pointerInside || !!menu
    untrack(() => {
      if (hold && !frozen) frozen = order
      else if (!hold) frozen = undefined
    })
  })

  /** The tabs in strip order; a draft is the newest, so its "New session" tab comes first. */
  type Entry = { kind: "draft" } | { kind: "session"; session: TabSession }
  const entries = $derived<Entry[]>([
    ...(draft ? [{ kind: "draft" } as const] : []),
    ...order.flatMap((id): Entry[] => {
      const session = tabSessions.get(id)
      return session ? [{ kind: "session", session }] : []
    }),
  ])
  const activeIndex = $derived(draft ? 0 : entries.findIndex((entry) => entry.kind === "session" && entry.session.id === currentID))

  /* ---------------------------------------------------------------- fit */

  let strip: HTMLDivElement | undefined = $state()
  let area: HTMLDivElement | undefined = $state()
  let measure: HTMLDivElement | undefined = $state()
  let available = $state(Number.POSITIVE_INFINITY)
  let widths = $state<number[]>([])
  let mins = $state<number[]>([])
  let button = $state(0)

  function remeasure(): void {
    if (!area || !measure) return
    const children = [...measure.children] as HTMLElement[]
    const probe = children.pop()
    button = probe?.getBoundingClientRect().width ?? 0
    widths = children.map((el) => el.getBoundingClientRect().width)
    mins = children.map((el) => parseFloat(getComputedStyle(el).minWidth) || 0)
    // The `+` always follows the tabs.
    available = area.clientWidth - button - GAP
  }

  $effect(() => {
    if (!area || !measure || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => remeasure())
    observer.observe(area)
    observer.observe(measure)
    remeasure()
    return () => observer.disconnect()
  })
  // A tab added, closed, renamed or re-ordered changes the widths; the observer only sees the row's own size.
  $effect(() => {
    void entries
    void currentID
    queueMicrotask(remeasure)
  })

  const fit = $derived(
    widths.length === entries.length
      ? fitTabs(widths, available, { gap: GAP, overflow: button, min: mins, active: activeIndex < 0 ? undefined : activeIndex })
      : { visible: entries.map((_, i) => i), hidden: [] },
  )
  const visible = $derived(fit.visible.map((index) => entries[index]!))
  const hiddenSessions = $derived(fit.hidden.flatMap((index) => (entries[index]?.kind === "session" ? [(entries[index] as { session: TabSession }).session] : [])))

  /* ------------------------------------------------------------ actions */

  function select(session: TabSession): void {
    menu = undefined
    if (session.id === currentID) return
    host.list.open({ id: session.id, directory: session.directory, title: session.title, last: session.last })
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

  /** The draft's tab: closing it goes back to the newest open tab. */
  function closeDraft(): void {
    const first = order[0] ? tabSessions.get(order[0]) : undefined
    if (first) host.open(first.id, first.directory)
  }

  function newSession(): void {
    menu = undefined
    store.dispatch({ type: "newDraft", hasText: hasDraftText })
  }

  function toggleMenu(kind: "overflow" | "search"): void {
    menu = menu === kind ? undefined : kind
  }

  /** Escape gives the keyboard back to the button that opened the menu (the menu is still in the strip right now). */
  function dismiss(refocus: boolean): void {
    const kind = menu
    if (refocus) restoreFocus(strip?.querySelector<HTMLElement>(kind === "search" ? "[data-search]" : "[data-overflow]"), strip)
    menu = undefined
  }

  function tabKey(e: KeyboardEvent, id: string): void {
    if (e.key === "Delete") {
      e.preventDefault()
      close(id)
    }
  }

  const tabLabel = (session: TabSession): string =>
    [session.title, projects > 1 ? session.project : undefined, statusLabel(session.status), session.id === currentID ? "current tab" : undefined].filter(Boolean).join(", ")
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="strip" bind:this={strip} onpointerenter={() => (pointerInside = true)} onpointerleave={() => (pointerInside = false)}>
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
    <nav class="tabs" aria-label="Open sessions">
      {#each visible as entry (entry.kind === "draft" ? "\u0000draft" : entry.session.id)}
        {@render tab(entry, false)}
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
  <!-- Every tab at its natural width, invisible and clipped: what the fit is computed from. The last child is the
       overflow button's size. -->
  <div class="clip" aria-hidden="true" inert>
    <div class="measure" bind:this={measure}>
      {#each entries as entry (entry.kind === "draft" ? "\u0000draft" : entry.session.id)}
        {@render tab(entry, true)}
      {/each}
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

{#snippet tab(entry: Entry, probe: boolean)}
  {#if entry.kind === "draft"}
    <div class="tab active" class:probe>
      <button class="pick" aria-current="page" title={DRAFT_TITLE} tabindex={probe ? -1 : undefined}>
        <span class="avatar-new"><Codicon name="edit" /></span>
        <span class="title">{DRAFT_TITLE}</span>
      </button>
      {#if order.length > 0}
        <span class="end">
          <button class="x" onclick={closeDraft} title="Close tab" aria-label="Close tab {DRAFT_TITLE}" tabindex={probe ? -1 : undefined}><Codicon name="close" /></button>
        </span>
      {/if}
    </div>
  {:else}
    {@const session = entry.session}
    {@const active = session.id === currentID}
    <div class="tab" class:active class:probe class:unread={session.status === "unread"} data-status={session.status}>
      <button
        class="pick"
        aria-current={active ? "page" : undefined}
        aria-label={tabLabel(session)}
        title={tabLabel(session)}
        tabindex={probe ? -1 : undefined}
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
      <span class="end">
        <span class="status"><SessionStatusIcon status={session.status} quiet /></span>
        <button class="x" onclick={() => close(session.id)} title="Close tab (the session is kept)" aria-label="Close tab {session.title}" tabindex={probe ? -1 : undefined}
          ><Codicon name="close" /></button
        >
      </span>
    </div>
  {/if}
{/snippet}

<style>
  .strip {
    --tab-row: max(var(--oc-menu-row), 28px);
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px calc(var(--oc-side) - 6px) 3px calc(var(--oc-side) - 6px);
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
    flex: 0 1 auto;
    display: flex;
    align-items: center;
    max-width: 14em;
    min-width: 6.5em;
    height: var(--tab-row);
    border-radius: 4px;
    color: var(--oc-muted);
  }
  .tab.active {
    min-width: 8.5em;
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
  /* The status sits where the close button appears; the close button replaces it on hover or focus. */
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
  .status:empty {
    display: none;
  }
  .x {
    display: none;
    align-items: center;
    justify-content: center;
    width: max(calc(var(--tab-row) - 8px), 20px);
    height: max(calc(var(--tab-row) - 8px), 20px);
    border-radius: 3px;
    color: inherit;
  }
  .x:hover {
    background: var(--oc-hover);
  }
  .tab.active .x,
  .tab:hover .x,
  .tab:focus-within .x {
    display: inline-flex;
  }
  .tab:not(.active):is(:hover, :focus-within) .status {
    display: none;
  }
  /* A finger has no hover: only the tab on screen offers its close button, and it is full size. */
  @media (hover: none) {
    /* A phone is narrow: smaller floors let a second tab sit next to the one on screen instead of only the arrow. */
    .tab {
      min-width: 4.5em;
      flex-shrink: 4;
    }
    /* The tab on screen gives way last, so its title stays readable next to its full-size close button. */
    .tab.active {
      min-width: 6.5em;
      flex-shrink: 1;
    }
    .tab:not(.active) .x {
      display: none;
    }
    .tab:not(.active) .status {
      display: inline-flex;
    }
    .x {
      width: var(--tab-row);
      height: var(--tab-row);
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
</style>
