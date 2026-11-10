<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { AppState } from "@occ/core/protocol"
  import { statusLabel, unreadCount, type SessionStatus } from "@occ/core/session-status"
  import { applyPaneOrder, buildPane, filterPane, freezePane, PANE_WIDTH, paneFolders, type FrozenPane, type PaneProject, type PaneRow } from "@occ/core/sessions-pane"
  import { useStore } from "../context"
  import { focusGuarded } from "../focus"
  import Codicon from "./Codicon.svelte"

  /**
   * The sessions list inside the chat, like Copilot Chat's: a column on the left when the view is wide enough, an
   * overlay over the chat when it is not. It is now the only session list in the editor: the old folder and session
   * dropdowns are gone, so everything they did (switch, new, delete, rename, archived) lives here.
   *
   * The phone never renders it (`capabilities.sessionsPane` is false there; its own drawer already lists every project
   * and session).
   */
  let { app, overlay, onclose }: { app: AppState; overlay: boolean; onclose: () => void } = $props()
  const store = useStore()

  let query = $state("")
  let searching = $state(false)
  let searchInput: HTMLInputElement | undefined = $state()
  let pane: HTMLDivElement | undefined = $state()
  /** The user's own expand/collapse choice per project, so a live update does not reopen what they closed. */
  let toggled = $state<Record<string, boolean>>({})
  let now = $state(Date.now())
  let frozen = $state<FrozenPane>()
  /** The row whose title is being edited (pencil, F2). */
  let editing = $state<{ id: string; value: string } | undefined>()
  let editInput: HTMLInputElement | undefined = $state()

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(timer)
  })

  const layout = $derived(buildPane(paneFolders(app, store.folderSessions), now))
  /** Every folder has its list: before that, the order would be a guess from empty groups. */
  const loadedAll = $derived(paneFolders(app, store.folderSessions).every((folder) => folder.loaded))
  /**
   * The shared order places the rows when the pane opens (and when the search changes); while it stays open the frozen
   * ids keep every row where it was, so a live event never moves a row under the pointer. The next open sorts again.
   * It waits for every folder's list, so groups do not freeze in an arbitrary order before their sessions arrive.
   */
  $effect(() => {
    void query
    if (!loadedAll) return
    frozen = untrack(() => freezePane(layout))
  })
  const ordered = $derived(frozen ? applyPaneOrder(layout, frozen) : layout)
  const shown = $derived(filterPane(ordered, query))
  const anyLoading = $derived(!loadedAll)
  const totalUnread = $derived(
    shown.kind === "sessions"
      ? unreadCount(shown.sessions.map((row) => row.status))
      : shown.kind === "projects"
        ? unreadCount(shown.projects.flatMap((project) => project.sessions.map((row) => row.status)))
        : 0,
  )
  const canRename = $derived(app.features.rename && !app.readOnly)

  function rowLabel(row: PaneRow): string {
    return [row.title, statusLabel(row.status), row.description, row.archived ? "archived" : undefined, row.current ? "current session" : undefined].filter(Boolean).join(", ")
  }

  function projectOpen(project: PaneProject): boolean {
    return toggled[project.directory] ?? project.expanded
  }

  function toggleProject(project: PaneProject): void {
    toggled = { ...toggled, [project.directory]: !projectOpen(project) }
  }

  function open(row: PaneRow): void {
    if (store.bridge.openSessionInFolder) store.bridge.openSessionInFolder(row.id, row.directory)
    else {
      store.dispatch({ type: "switchFolder", directory: row.directory })
      store.dispatch({ type: "openSession", id: row.id })
    }
    if (overlay) onclose()
  }

  function newSession(): void {
    store.dispatch({ type: "newDraft", hasText: false })
    if (overlay) onclose()
  }

  /** Refresh redraws from the lists the host already holds; it never adds server calls of its own. */
  function refresh(): void {
    if (store.bridge.refreshSessions) store.bridge.refreshSessions()
    else store.dispatch({ type: "refresh" })
  }

  function askDelete(row: PaneRow): void {
    store.bridge.confirmDeleteSession(row.id, row.title, row.directory)
  }

  /**
   * Rename a session from the pane. The host renames it in the folder that owns the row, without switching the chat
   * there, so a row that moved folders meanwhile can never rename whatever the chat had opened instead.
   */
  function rename(row: PaneRow, title: string): void {
    const value = title.trim()
    if (!value || value === row.title) return
    if (store.bridge.renameSession) {
      store.bridge.renameSession(row.id, row.directory, value)
      return
    }
    store.dispatch({ type: "rename", id: row.id, title: value })
  }

  async function startEdit(row: PaneRow): Promise<void> {
    if (!canRename) return
    editing = { id: row.id, value: row.title }
    await tick()
    // The user asked for this (pencil, F2): the field may take focus.
    focusGuarded(editInput)
    editInput?.select()
  }

  function commitEdit(row: PaneRow): void {
    const e = editing
    editing = undefined
    if (e && e.id === row.id) rename(row, e.value)
  }

  function editKey(e: KeyboardEvent, row: PaneRow): void {
    e.stopPropagation()
    if (e.key === "Enter") {
      e.preventDefault()
      commitEdit(row)
    } else if (e.key === "Escape") {
      e.preventDefault()
      editing = undefined
    }
  }

  async function toggleSearch(): Promise<void> {
    searching = !searching
    if (!searching) {
      query = ""
      return
    }
    await tick()
    focusGuarded(searchInput)
  }

  function move(delta: number): void {
    const rows = Array.from(pane?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))]
    if (next) focusGuarded(next)
  }

  function rowKey(e: KeyboardEvent, row: PaneRow): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      open(row)
    } else if (e.key === "F2") {
      e.preventDefault()
      void startEdit(row)
    } else if (e.key === "Delete") {
      e.preventDefault()
      // A running or waiting session cannot be deleted (the controller refuses it too); archived ones can.
      if (row.state === "idle") askDelete(row)
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      move(1)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      move(-1)
    } else if (e.key === "Home") {
      e.preventDefault()
      const first = pane?.querySelector<HTMLElement>('[role="option"]')
      if (first) focusGuarded(first)
    } else if (e.key === "End") {
      e.preventDefault()
      const rows = Array.from(pane?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
      const last = rows[rows.length - 1]
      if (last) focusGuarded(last)
    }
  }

  function searchKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      const first = pane?.querySelector<HTMLElement>('[role="option"]')
      if (first) focusGuarded(first)
    }
  }
</script>

<div class="pane" class:overlay style:width={overlay ? undefined : `${PANE_WIDTH}px`} bind:this={pane} aria-label="Sessions">
  <header class="head">
    <span class="title"
      >Sessions{#if totalUnread > 0}<span class="badge" role="img" aria-label={`${totalUnread} unread`} title={`${totalUnread} unread`}>{totalUnread}</span>{/if}</span
    >
    <div class="actions">
      <button
        class="icon"
        class:on={app.showArchived}
        onclick={() => store.dispatch({ type: "toggleArchived" })}
        title={app.showArchived ? "Hide archived sessions" : "Show archived sessions"}
        aria-label={app.showArchived ? "Hide archived sessions" : "Show archived sessions"}
        aria-pressed={app.showArchived}><Codicon name="archive" /></button
      >
      <button class="icon" class:on={searching} onclick={() => void toggleSearch()} title="Search sessions" aria-label="Search sessions" aria-expanded={searching}>
        <Codicon name="search" />
      </button>
      <button class="icon" onclick={refresh} title="Refresh sessions" aria-label="Refresh sessions"><Codicon name="refresh" /></button>
      <button class="icon" onclick={newSession} title="New session" aria-label="New session"><Codicon name="add" /></button>
      <button class="icon" onclick={onclose} title="Close sessions" aria-label="Close sessions"><Codicon name="close" /></button>
    </div>
  </header>

  {#if searching}
    <div class="search">
      <Codicon name="search" />
      <input bind:this={searchInput} bind:value={query} type="search" placeholder="Search sessions" aria-label="Search sessions" autocomplete="off" onkeydown={searchKey} />
    </div>
  {/if}

  <div class="body scroll">
    {#if shown.kind === "empty"}
      <p class="hint muted">Open a folder to see its OpenCode sessions.</p>
    {:else if shown.kind === "sessions"}
      {#if shown.sessions.length === 0}
        <p class="hint muted">
          {#if query.trim()}No matching sessions{:else if anyLoading}<Codicon name="loading" spin /> Loading sessions…{:else}No sessions yet. Start one with +.{/if}
        </p>
      {:else}
        <div role="listbox" aria-label="Sessions">
          {#each shown.sessions as row (row.id)}
            {@render sessionRow(row)}
          {/each}
        </div>
      {/if}
    {:else}
      {#each shown.projects as project (project.directory)}
        {@const searching = query.trim().length > 0}
        {@const open = searching ? true : projectOpen(project)}
        <section class="group">
          <div class="phead">
            {#if searching}
              <div class="pname static">
                <span class="chev"><Codicon name="chevron-down" /></span>
                {@render statusIcon(project.status)}
                <span class="pname-text">{project.name}</span>
                {#if project.unread > 0}<span class="badge" aria-hidden="true" title={`${project.unread} unread`}>{project.unread}</span>{/if}
              </div>
            {:else}
              <button
                class="pname"
                onclick={() => toggleProject(project)}
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${project.name}, ${statusLabel(project.status)}${project.unread > 0 ? `, ${project.unread} unread` : ""}`}
              >
                <span class="chev"><Codicon name={open ? "chevron-down" : "chevron-right"} /></span>
                {@render statusIcon(project.status)}
                <span class="pname-text">{project.name}</span>
                {#if project.unread > 0}<span class="badge" aria-hidden="true" title={`${project.unread} unread`}>{project.unread}</span>{/if}
              </button>
            {/if}
            {#if store.bridge.renameProject}
              <button class="icon pencil" onclick={() => store.bridge.renameProject?.(project.directory)} title="Rename project" aria-label="Rename {project.name}">
                <Codicon name="edit" />
              </button>
            {/if}
          </div>
          {#if open}
            {#if project.sessions.length === 0}
              <p class="hint muted">No sessions yet.</p>
            {:else}
              <div role="listbox" aria-label={project.name}>
                {#each project.sessions as row (row.id)}
                  {@render sessionRow(row)}
                {/each}
              </div>
            {/if}
          {/if}
        </section>
      {/each}
    {/if}
  </div>
</div>

{#snippet statusIcon(status: SessionStatus)}
  <span class="state {status}">
    {#if status === "running"}<Codicon name="loading" spin />
    {:else if status === "waiting"}<Codicon name="bell-dot" />
    {:else if status === "failed"}<Codicon name="error" />
    {:else if status === "unread"}<Codicon name="circle-filled" />
    {:else}<Codicon name="check" />{/if}
  </span>
{/snippet}

{#snippet sessionRow(row: PaneRow)}
  <div
    class="row"
    class:current={row.current}
    class:unread={row.status === "unread"}
    class:archived={row.archived}
    role="option"
    tabindex="0"
    aria-selected={row.current}
    aria-label={rowLabel(row)}
    title={rowLabel(row)}
    onclick={() => editing?.id === row.id || open(row)}
    onkeydown={(e) => rowKey(e, row)}
  >
    {@render statusIcon(row.status)}
    {#if editing && editing.id === row.id}
      <input
        class="edit"
        bind:this={editInput}
        bind:value={editing.value}
        aria-label="Session title"
        onkeydown={(e) => editKey(e, row)}
        onblur={() => commitEdit(row)}
        onclick={(e) => e.stopPropagation()}
      />
    {:else}
      <span class="text">{row.title}</span>
      {#if canRename}
        <button
          class="icon ren"
          onmousedown={(e) => e.preventDefault()}
          onclick={(e) => {
            e.stopPropagation()
            void startEdit(row)
          }}
          title="Rename session (F2)"
          aria-label="Rename {row.title}"><Codicon name="edit" /></button
        >
      {/if}
      {#if row.state === "idle"}
        <button
          class="icon del"
          onmousedown={(e) => e.preventDefault()}
          onclick={(e) => {
            e.stopPropagation()
            askDelete(row)
          }}
          title="Delete session…"
          aria-label="Delete {row.title}"><Codicon name="trash" /></button
        >
      {/if}
      <span class="when muted">{row.description}</span>
    {/if}
  </div>
{/snippet}

<style>
  .pane {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-right: 1px solid var(--oc-hairline);
    color: var(--oc-fg);
  }
  .pane.overlay {
    position: absolute;
    z-index: 30;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(86%, 280px);
    box-shadow: 0 0 24px var(--vscode-widget-shadow);
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.45em 0.4em 0.45em 0.8em;
    border-bottom: 1px solid var(--oc-hairline);
  }
  .title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.1em;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    color: var(--oc-muted);
    flex: none;
  }
  .icon:hover,
  .icon.on {
    color: var(--oc-fg);
    background: var(--oc-hover);
  }
  .search {
    flex: none;
    position: relative;
    padding: 0.4em 0.5em;
    border-bottom: 1px solid var(--oc-hairline);
  }
  .search :global(.codicon) {
    position: absolute;
    left: 1em;
    top: 50%;
    transform: translateY(-50%);
    color: var(--oc-muted);
    pointer-events: none;
  }
  .search input {
    width: 100%;
    padding: 0.25em 0.5em 0.25em 1.9em;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--oc-hairline));
    border-radius: 3px;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.25em 0;
  }
  .hint {
    margin: 0;
    padding: 0.6em 0.9em;
    font-size: 0.9em;
  }
  .group {
    margin-bottom: 0.15em;
  }
  .phead {
    display: flex;
    align-items: center;
    gap: 0.1em;
    padding-right: 0.25em;
  }
  .pname {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.3em 0.3em 0.3em 0.55em;
    text-align: left;
    font-weight: 600;
    border-radius: 4px;
  }
  .pname:hover {
    background: var(--oc-hover);
  }
  /* While a search is active, every matching group stays open: its header is a label, not a toggle. */
  .pname.static:hover {
    background: none;
  }
  .chev,
  .state {
    display: inline-flex;
    flex: none;
    color: var(--oc-muted);
  }
  .state.waiting {
    color: var(--oc-amber);
  }
  .state.running,
  .state.unread {
    color: var(--oc-accent);
  }
  .state.failed {
    color: var(--oc-error);
  }
  .badge {
    flex: none;
    min-width: 1.35em;
    padding: 0 0.35em;
    border-radius: 999px;
    background: var(--oc-accent);
    color: var(--vscode-badge-foreground, var(--oc-selected-fg));
    font-size: 0.75em;
    font-weight: 600;
    line-height: 1.35em;
    text-align: center;
  }
  .pname-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pencil {
    opacity: 0;
  }
  .phead:hover .pencil,
  .pencil:focus-visible {
    opacity: 1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.45em;
    min-height: 28px;
    padding: 0.1em 0.4em 0.1em 0.9em;
    cursor: pointer;
    border-radius: 3px;
  }
  .group .row {
    padding-left: 1.5em;
  }
  .row:hover {
    background: var(--oc-hover);
  }
  .row.current {
    background: var(--oc-selected);
    color: var(--oc-selected-fg);
  }
  .row.current .muted,
  .row.current .state {
    color: var(--oc-selected-fg);
  }
  .row.unread .text {
    font-weight: 600;
  }
  .row.archived .text,
  .row.archived .when {
    opacity: 0.6;
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edit {
    flex: 1;
    min-width: 0;
    padding: 0.1em 0.3em;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 3px;
  }
  .when {
    flex: none;
    font-size: 0.85em;
  }
  .del,
  .ren {
    opacity: 0;
    width: 22px;
    height: 22px;
  }
  .row:hover .del,
  .row:hover .ren,
  .row:focus-within .del,
  .row:focus-within .ren,
  .del:focus-visible,
  .ren:focus-visible {
    opacity: 1;
  }
  .del:hover {
    color: var(--oc-error);
    background: var(--oc-hover);
  }
  .ren:hover {
    color: var(--oc-fg);
    background: var(--oc-hover);
  }
  @media (hover: none) {
    .del,
    .ren,
    .pencil {
      opacity: 1;
    }
  }
</style>
