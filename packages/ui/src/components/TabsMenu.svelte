<script lang="ts">
  import { onMount, tick } from "svelte"
  import { filterTabSessions, type TabSession } from "@occ/core/session-tabs"
  import { statusLabel } from "@occ/core/session-status"
  import { focusOpened, restoreFocus } from "../focus"
  import Codicon from "./Codicon.svelte"
  import ProjectAvatar from "./ProjectAvatar.svelte"
  import SessionStatusIcon from "./SessionStatusIcon.svelte"

  /**
   * The tab strip's dropdown: the open tabs that did not fit, then every session of the project(s) in the host's list
   * order (the sessions pane in VS Code, the drawer on the phone), with a filter. Picking a row opens it as a tab.
   */
  let {
    hidden,
    sessions,
    loading,
    showProject,
    currentID,
    focusFilter,
    onopen,
    onclose,
    ondismiss,
  }: {
    /** Open tabs the strip had no room for, in strip order. */
    hidden: TabSession[]
    /** Every session the host lists, in its own order. */
    sessions: TabSession[]
    loading: boolean
    /** The rows name their project (more than one project is listed). */
    showProject: boolean
    currentID?: string
    /** Put the cursor in the filter (the search button), rather than on the first row (the overflow arrow). */
    focusFilter: boolean
    onopen: (session: TabSession) => void
    onclose: (id: string) => void
    ondismiss: (refocus: boolean) => void
  } = $props()

  /** Long lists are cut here; the filter reaches the rest. Keeps the dropdown instant with hundreds of sessions. */
  const LIMIT = 100

  let query = $state("")
  let menu: HTMLDivElement | undefined = $state()
  let filter: HTMLInputElement | undefined = $state()

  const hiddenShown = $derived(filterTabSessions(hidden, query))
  const matching = $derived(filterTabSessions(sessions, query))
  const all = $derived(matching.slice(0, LIMIT))
  const more = $derived(matching.length - all.length)

  onMount(() => {
    // The user opened this: the cursor goes to the filter (search) or the first row (the overflow arrow).
    let cancel = (): void => {}
    void tick().then(() => {
      cancel = focusOpened(() => (focusFilter ? filter : (menu?.querySelector<HTMLElement>("[data-item]") ?? filter)))
    })
    const outside = (e: PointerEvent) => {
      const target = e.target as Node | null
      // The strip's own buttons toggle the menu themselves.
      if (target && (menu?.contains(target) || (target as Element).closest?.("[data-tabs-trigger]"))) return
      ondismiss(false)
    }
    window.addEventListener("pointerdown", outside, true)
    return () => {
      cancel()
      window.removeEventListener("pointerdown", outside, true)
    }
  })

  function items(): HTMLElement[] {
    return [...(menu?.querySelectorAll<HTMLElement>("[data-item]") ?? [])]
  }

  /** Everything Tab can reach inside the dialog, in document order: the filter, then each row and close button. */
  function focusables(): HTMLElement[] {
    return [...(menu?.querySelectorAll<HTMLElement>("input, button") ?? [])].filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0)
  }

  // The keyboard is inside the menu, so moving it to another element of the menu is always allowed.
  const go = (el: HTMLElement | undefined): void => restoreFocus(el, menu)

  /** The row the keyboard is on, or the row whose close button has it. */
  function currentRow(list: HTMLElement[]): number {
    const active = document.activeElement as HTMLElement | null
    const at = list.indexOf(active as HTMLElement)
    if (at >= 0 || !active?.dataset.close) return at
    return list.findIndex((el) => el.dataset.id === active.dataset.close)
  }

  function move(step: number): void {
    const list = items()
    if (list.length === 0) return
    const at = currentRow(list)
    go(list[at < 0 ? (step > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + step))])
  }

  function key(e: KeyboardEvent): void {
    const inFilter = document.activeElement === filter
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      ondismiss(true)
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      move(1)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (currentRow(items()) === 0) go(filter)
      else move(-1)
    } else if ((e.key === "Home" || e.key === "End") && !inFilter) {
      // In the filter, Home and End move the caret as usual.
      e.preventDefault()
      const list = items()
      go(e.key === "Home" ? list[0] : list.at(-1))
    } else if (e.key === "Tab") {
      // A modal dropdown: Tab cycles inside it until Escape or a pick closes it.
      const list = focusables()
      if (list.length === 0) return
      const at = list.indexOf(document.activeElement as HTMLElement)
      const last = list.length - 1
      if (e.shiftKey && at <= 0) {
        e.preventDefault()
        go(list[last])
      } else if (!e.shiftKey && (at === last || at < 0)) {
        e.preventDefault()
        go(list[0])
      }
    }
  }

  /** Close an open tab from the list; the keyboard goes to the next open tab's row, else the previous, else the filter. */
  function closeRow(id: string, index: number): void {
    onclose(id)
    void tick().then(() => {
      const rows = [...(menu?.querySelectorAll<HTMLElement>("[data-open-tab]") ?? [])]
      go(rows[Math.min(index, rows.length - 1)] ?? filter)
    })
  }

  function filterKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault()
      const first = hiddenShown[0] ?? all[0]
      if (first) onopen(first)
    }
  }

  const label = (session: TabSession): string =>
    [session.title, showProject ? session.project : undefined, statusLabel(session.status), session.id === currentID ? "current session" : undefined].filter(Boolean).join(", ")
</script>

<!-- A modal dialog of plain lists of buttons: each row is a button that opens its session, and an open tab's row has
     its close button beside it (not inside it). Up/Down/Home/End move between rows, Tab cycles inside the dialog. -->
<div class="menu" bind:this={menu} role="dialog" aria-modal="true" aria-label="Open tabs and all sessions" tabindex="-1" onkeydown={key}>
  <div class="filter">
    <Codicon name="search" />
    <input bind:this={filter} bind:value={query} onkeydown={filterKey} placeholder="Filter sessions" aria-label="Filter sessions" />
  </div>
  <div class="list">
    {#if hiddenShown.length > 0}
      <div class="head muted" id="tabs-menu-open">Open tabs</div>
      <ul aria-labelledby="tabs-menu-open">
        {#each hiddenShown as session, index (session.id)}
          <li class="rowwrap">
            {@render row(session, true)}
            <button class="x muted" data-close={session.id} onclick={() => closeRow(session.id, index)} title="Close tab" aria-label="Close tab {session.title}"><Codicon name="close" /></button>
          </li>
        {/each}
      </ul>
      <div class="divider" role="separator"></div>
    {/if}
    <div class="head muted" id="tabs-menu-all">All sessions</div>
    {#if loading && sessions.length === 0}
      <div class="note muted" role="status"><Codicon name="loading" spin /> Loading sessions…</div>
    {:else if all.length === 0}
      <div class="note muted" role="status">{query.trim() ? "No session matches this filter." : "No sessions yet. Start one with +."}</div>
    {:else}
      <ul aria-labelledby="tabs-menu-all">
        {#each all as session (session.id)}
          <li>{@render row(session, false)}</li>
        {/each}
      </ul>
      {#if more > 0}
        <div class="note muted">{more} more — type to filter.</div>
      {/if}
    {/if}
  </div>
</div>

{#snippet row(session: TabSession, openTab: boolean)}
  <button
    class="row"
    class:current={session.id === currentID}
    data-item
    data-id={session.id}
    data-open-tab={openTab ? "" : undefined}
    aria-current={session.id === currentID ? "page" : undefined}
    aria-label={label(session)}
    title={label(session)}
    onclick={() => onopen(session)}
  >
    <ProjectAvatar name={session.project} directory={session.directory} />
    <span class="title" class:unread={session.status === "unread"}>{session.title}</span>
    {#if showProject}<span class="project muted">{session.project}</span>{/if}
    <SessionStatusIcon status={session.status} quiet />
  </button>
{/snippet}

<style>
  .menu {
    position: absolute;
    top: 100%;
    left: 4px;
    z-index: 40;
    width: min(380px, calc(100% - 8px));
    max-height: min(70vh, 480px);
    display: flex;
    flex-direction: column;
    background: var(--oc-popover);
    color: var(--oc-fg);
    border: 1px solid var(--oc-border);
    border-radius: 6px;
    box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.3));
    overflow: hidden;
  }
  .filter {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.4em;
    min-height: var(--oc-menu-row);
    padding: 0.3em 0.6em;
    border-bottom: 1px solid var(--oc-hairline);
    color: var(--oc-muted);
  }
  .filter input {
    flex: 1;
    min-width: 0;
    padding: 0.25em 0.4em;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
  }
  .filter input:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .list {
    overflow-y: auto;
    padding: 0.25em 0;
  }
  .head {
    padding: 0.35em 0.75em 0.2em;
    font-size: 0.8em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .divider {
    height: 1px;
    margin: 0.3em 0;
    background: var(--oc-hairline);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rowwrap {
    display: flex;
    align-items: stretch;
  }
  .rowwrap .row {
    flex: 1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    width: 100%;
    min-width: 0;
    min-height: var(--oc-menu-row);
    padding: 0.2em 0.75em;
    text-align: left;
  }
  .x:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .row:hover,
  .row:focus-visible,
  .x:hover {
    background: var(--oc-hover);
    color: var(--oc-fg);
    outline: none;
  }
  .row:focus-visible {
    box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
  }
  .row.current {
    background: var(--oc-selected);
    color: var(--oc-selected-fg);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title.unread {
    font-weight: 600;
  }
  .project {
    flex: none;
    max-width: 35%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85em;
  }
  .x {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: max(var(--oc-menu-row), 26px);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.4em 0.75em;
    font-size: 0.9em;
  }
</style>
