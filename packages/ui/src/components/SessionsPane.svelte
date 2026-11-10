<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { ActivityState } from "@occ/core/activity-order"
  import type { AppState } from "@occ/core/protocol"
  import { applyPaneOrder, buildPane, filterPane, freezePane, PANE_WIDTH, paneFolders, type FrozenPane, type PaneProject, type PaneRow } from "@occ/core/sessions-pane"
  import { useStore } from "../context"
  import { focusGuarded } from "../focus"
  import Codicon from "./Codicon.svelte"

  /**
   * The sessions list inside the chat, like Copilot Chat's: a column on the left when the view is wide enough, an
   * overlay over the chat when it is not. The phone never renders it (`capabilities.sessionsPane` is false there; its
   * own drawer already lists every project and session).
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

  function statusLabel(state: ActivityState): string {
    if (state === "waiting") return "Waiting for you"
    if (state === "running") return "Running"
    return "Idle"
  }

  function rowLabel(row: PaneRow): string {
    return [row.title, statusLabel(row.state), row.description, row.current ? "current session" : undefined].filter(Boolean).join(", ")
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
    <span class="title">Sessions</span>
    <div class="actions">
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
                {@render projectState(project.state)}
                <span class="pname-text">{project.name}</span>
              </div>
            {:else}
              <button class="pname" onclick={() => toggleProject(project)} aria-expanded={open} aria-label={open ? `Collapse ${project.name}` : `Expand ${project.name}`}>
                <span class="chev"><Codicon name={open ? "chevron-down" : "chevron-right"} /></span>
                {@render projectState(project.state)}
                <span class="pname-text">{project.name}</span>
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

{#snippet projectState(state: ActivityState)}
  <span class="pstate" class:waiting={state === "waiting"} class:running={state === "running"}>
    {#if state === "running"}<Codicon name="loading" spin label="Running" />
    {:else if state === "waiting"}<Codicon name="bell-dot" label="Waiting for you" />
    {:else}<Codicon name="folder" />{/if}
  </span>
{/snippet}

{#snippet sessionRow(row: PaneRow)}
  <div
    class="row"
    class:current={row.current}
    role="option"
    tabindex="0"
    aria-selected={row.current}
    aria-label={rowLabel(row)}
    title={rowLabel(row)}
    onclick={() => open(row)}
    onkeydown={(e) => rowKey(e, row)}
  >
    <span class="state" class:waiting={row.state === "waiting"} class:running={row.state === "running"}>
      {#if row.state === "running"}<Codicon name="loading" spin />
      {:else if row.state === "waiting"}<Codicon name="bell-dot" />
      {:else}<Codicon name="comment-discussion" />{/if}
    </span>
    <span class="text">{row.title}</span>
    <span class="when muted">{row.description}</span>
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
  .pstate {
    display: inline-flex;
    flex: none;
    color: var(--oc-muted);
  }
  .pstate.waiting {
    color: var(--oc-amber);
  }
  .pstate.running {
    color: var(--oc-accent);
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
  .state {
    display: inline-flex;
    flex: none;
    color: var(--oc-muted);
  }
  .state.waiting {
    color: var(--oc-amber);
  }
  .state.running {
    color: var(--oc-accent);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    flex: none;
    font-size: 0.85em;
  }
  .del {
    opacity: 0;
    width: 22px;
    height: 22px;
  }
  .row:hover .del,
  .row:focus-within .del,
  .del:focus-visible {
    opacity: 1;
  }
  .del:hover {
    color: var(--oc-error);
    background: var(--oc-hover);
  }
  @media (hover: none) {
    .del,
    .pencil {
      opacity: 1;
    }
  }
</style>
