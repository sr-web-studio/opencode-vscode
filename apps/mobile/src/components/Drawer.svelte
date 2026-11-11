<script lang="ts">
  import { tick, untrack } from "svelte"
  import { fade, fly } from "svelte/transition"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { relativeTime } from "@occ/core/format"
  import type { ActivityState } from "@occ/core/activity-order"
  import { statusLabel, type SessionStatus } from "@occ/core/session-status"
  import { workerLabel } from "@occ/core/worker-activity"
  import { applyFrozenOrder, buildOverview, filterOverview, freezeOrder, splitEmptyProjects, type FrozenOrder, type OverviewGroup } from "../lib/overview"
  import { expandedKey, isExpanded, parseExpanded, parseShowEmpty, serializeShowEmpty, setExpanded, showEmptyKey } from "../lib/drawer-prefs"
  import { model } from "../model.svelte"

  /** What one opening of the drawer holds still: the row ids, and which projects were open by default then. */
  type Freeze = { order: FrozenOrder; open: Record<string, boolean> }

  /** The one list of every project and its root sessions, opened from the top bar. */
  let query = $state("")
  let now = $state(Date.now())
  let panel = $state<HTMLElement>()
  let expanded = $state(parseExpanded(localStorage.getItem(expandedKey(model.profile?.id ?? ""))))
  let showEmpty = $state(parseShowEmpty(localStorage.getItem(showEmptyKey(model.profile?.id ?? ""))))
  /** The session whose action row is open; one at a time, so a tap never lands on a hidden control. */
  let actionsFor = $state<string>()
  /** Archived sessions are the exception, not the rule: hidden on every start, like the editor's sessions pane. */
  let showArchived = $state(false)
  let frozen = $state<Freeze>()

  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  const duration = reduce ? 0 : 200

  const liveGroups = $derived(model.overview.data ? buildOverview(model.overview.data, { resolved: model.projectIDs, titles: model.projectTitles }, Date.now(), { archived: showArchived }) : [])
  /** Only the presence of the first snapshot is tracked: it tells the freeze when there is finally a list to hold. */
  const hasData = $derived(!!model.overview.data)
  const groups = $derived(frozen ? applyFrozenOrder(liveGroups, frozen.order) : liveGroups)
  const matched = $derived(filterOverview(groups, query))
  /** A search looks everywhere; without one the folders with no sessions wait behind the toggle at the end. */
  const split = $derived(query.trim() ? { listed: matched, empty: [] as OverviewGroup[] } : splitEmptyProjects(matched, model.currentDirectory))

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(timer)
  })
  // Each server remembers its own collapsed projects; switching servers must not carry the old answers over.
  $effect(() => {
    const key = expandedKey(model.profile?.id ?? "")
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key)
    } catch {
      // Storage blocked: the drawer still works, it just cannot remember this visit.
    }
    expanded = parseExpanded(raw)
  })
  // Same for the empty-project switch: what one server's list needs says nothing about another's.
  $effect(() => {
    const key = showEmptyKey(model.profile?.id ?? "")
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key)
    } catch {
      // Storage blocked: the switch still works for this visit.
    }
    showEmpty = parseShowEmpty(raw)
  })
  $effect(() => {
    if (model.drawerOpen) void tick().then(() => panel?.focus())
    // Opening the drawer always shows every project; a filter left from last time would hide them without a reason.
    else {
      query = ""
      actionsFor = undefined
    }
  })
  /**
   * The shared order decides placement when the drawer opens and when the search changes; while it stays open the
   * frozen ids keep every row where it was, so a live event never moves a row under the user's finger. New rows are
   * slotted in at their shared-order position, removed ones disappear, and the next open sorts from scratch.
   *
   * `query` and `hasData` are read on purpose (a new search, or the first snapshot arriving, re-takes the order); the
   * list itself is read untracked, so status updates and new sessions do not re-sort it.
   */
  $effect(() => {
    if (!model.drawerOpen) {
      frozen = undefined
      return
    }
    void query
    // Before the first snapshot there is no order to hold; take it as soon as the list exists.
    if (!hasData) return
    frozen = untrack(() => freeze(liveGroups))
  })

  function freeze(list: ReadonlyArray<OverviewGroup>): Freeze {
    return {
      order: freezeOrder(list),
      open: Object.fromEntries(list.map((group) => [group.directory, openByDefault(group.directory, group.state)])),
    }
  }

  /** The second line of a row: the words behind the icon, when there is something to say. */
  function statusText(status: SessionStatus): string | undefined {
    return status === "read" ? undefined : statusLabel(status)
  }

  /** A project's second line: how many sessions it has, and the folder it is, so two same-named projects can be told apart. */
  function subtitle(group: OverviewGroup): string {
    if (group.sessionCount === 0) return `No sessions · ${group.path}`
    if (group.sessions.length === 0) return `No active sessions · ${group.path}`
    const n = group.sessions.length
    return `${n} ${n === 1 ? "session" : "sessions"} · ${group.path}`
  }

  function openByDefault(directory: string, state: ActivityState): boolean {
    return directory === model.currentDirectory || state !== "idle"
  }

  function toggle(directory: string, open: boolean): void {
    expanded = setExpanded(expanded, directory, !open)
    try {
      localStorage.setItem(expandedKey(model.profile?.id ?? ""), JSON.stringify(expanded))
    } catch {
      // The drawer still works for this visit; remembering the toggle is not worth an error.
    }
  }

  /** Reveal or hide the projects without sessions; the answer is remembered for this server. */
  function toggleEmpty(): void {
    showEmpty = !showEmpty
    try {
      localStorage.setItem(showEmptyKey(model.profile?.id ?? ""), serializeShowEmpty(showEmpty))
    } catch {
      // The switch still works for this visit.
    }
  }
</script>

{#snippet stateIcon(status: SessionStatus)}
  <span class="state {status}">
    {#if status === "running"}<Codicon name="loading" spin />
    {:else if status === "waiting"}<Codicon name="bell-dot" />
    {:else if status === "failed"}<Codicon name="error" />
    {:else if status === "unread"}<Codicon name="circle-filled" />
    {:else}<Codicon name="check" />{/if}
  </span>
{/snippet}

{#snippet project(group: OverviewGroup)}
  {@const open = query.trim() ? true : isExpanded(expanded, group.directory, frozen?.open[group.directory] ?? openByDefault(group.directory, group.state))}
  <section class="group">
    <div class="prow">
      <button
        class="pname"
        onclick={() => toggle(group.directory, open)}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${group.title}, ${group.sessions.length === 0 ? "no sessions" : statusLabel(group.status)}${group.workers > 0 ? `, ${workerLabel(group.workers)}` : ""}${group.unread > 0 ? `, ${group.unread} unread` : ""}`}
      >
        <!-- The folder says what the row is; the aggregated status sits at the end, so a collapsed project keeps it. -->
        <span class="state folder"><Codicon name={open ? "folder-opened" : "folder"} /></span>
        <span class="main">
          <span class="t"
            >{group.title}{#if group.unread > 0}<span class="badge" aria-hidden="true" title={`${group.unread} unread`}>{group.unread}</span>{/if}</span
          >
          <span class="s">{subtitle(group)}</span>
        </span>
      </button>
      <span class="end">{group.last ? relativeTime(group.last, now) : ""}</span>
      {#if group.sessions.length > 0}{@render stateIcon(group.status)}{/if}
      {#if group.workers > 0}<span class="workers" title={workerLabel(group.workers)} aria-hidden="true"><Codicon name="organization" /></span>{/if}
      <button class="iconbtn" onclick={() => model.newSession(group.directory)} aria-label={`New session in ${group.title}`} title="New session"><Codicon name="add" /></button>
      <button class="iconbtn" onclick={() => void model.renameProject(group.directory)} aria-label={`Rename ${group.title}`} title="Rename project"><Codicon name="edit" /></button>
    </div>
    {#if open}
      {#if group.sessions.length === 0}
        <div class="empty">{group.sessionCount === 0 ? "No sessions yet" : "No active sessions"}</div>
      {:else}
        {#each group.sessions as session (session.id)}
          <div class="srow-wrap" class:archived={session.archived}>
            <button
              class="srow"
              onclick={() => model.openSession(group.directory, session.id)}
              aria-label={`${session.title}, ${statusLabel(session.status)}${session.workers > 0 ? `, ${workerLabel(session.workers)}` : ""}${session.archived ? ", archived" : ""}`}
            >
              {@render stateIcon(session.status)}
              <span class="main">
                <span class="t" class:unread={session.status === "unread"}>{session.title}</span>
                {#if session.workers > 0 || statusText(session.status)}
                  <span class="s">
                    {#if session.workers > 0}<span class="workers"><Codicon name="organization" /> {workerLabel(session.workers)}</span>{/if}
                    {#if session.workers > 0 && statusText(session.status)}
                      ·
                    {/if}
                    {statusText(session.status) ?? ""}
                  </span>
                {/if}
              </span>
              <span class="end">{relativeTime(session.last, now)}</span>
            </button>
            <button
              class="iconbtn more"
              onclick={() => (actionsFor = actionsFor === session.id ? undefined : session.id)}
              aria-expanded={actionsFor === session.id}
              aria-label={`Actions for ${session.title}`}><Codicon name="kebab-vertical" /></button
            >
          </div>
          {#if actionsFor === session.id}
            <div class="rowactions">
              <button
                class="abtn"
                onclick={() => {
                  actionsFor = undefined
                  void model.renameSession(session.id, session.title)
                }}><Codicon name="edit" /> Rename</button
              >
              {#if session.state === "idle"}
                <button
                  class="abtn danger"
                  onclick={() => {
                    actionsFor = undefined
                    void model.deleteSession(group.directory, session.id, session.title)
                  }}><Codicon name="trash" /> Delete</button
                >
              {/if}
            </div>
          {/if}
        {/each}
      {/if}
    {/if}
  </section>
{/snippet}

{#if model.drawerOpen}
  <div class="scrim" role="presentation" transition:fade={{ duration: reduce ? 0 : 150 }} onclick={() => model.closeDrawer()}></div>
  <div
    class="drawer"
    role="dialog"
    aria-modal="true"
    aria-label="Projects and sessions"
    tabindex="-1"
    bind:this={panel}
    transition:fly={{ x: -340, duration }}
    onkeydown={(e) => e.key === "Escape" && model.closeDrawer()}
  >
    <header class="head">
      <div class="who">
        <span class="srv">{model.profile?.name ?? "Server"}</span>
        <span class="cap">Projects and sessions</span>
      </div>
      <button class="iconbtn" onclick={() => model.refreshOverview()} aria-label="Refresh projects and sessions" title="Refresh">
        <Codicon name={model.overview.loading ? "loading" : "refresh"} spin={model.overview.loading} />
      </button>
      <button
        class="iconbtn"
        class:on={showArchived}
        onclick={() => (showArchived = !showArchived)}
        aria-pressed={showArchived}
        aria-label={showArchived ? "Hide archived sessions" : "Show archived sessions"}
        title={showArchived ? "Hide archived sessions" : "Show archived sessions"}><Codicon name="archive" /></button
      >
      <button class="iconbtn" onclick={() => model.closeDrawer()} aria-label="Close menu"><Codicon name="close" /></button>
    </header>

    <div class="search">
      <Codicon name="search" />
      <input type="search" bind:value={query} placeholder="Search projects and sessions" aria-label="Search projects and sessions" autocomplete="off" />
    </div>

    <div class="body">
      {#if model.overview.error && !model.overview.data}
        <div class="center">
          <p class="err">{model.overview.error}</p>
          <button class="btn" onclick={() => model.overview.retry()}>Try again</button>
        </div>
      {:else if !model.overview.data}
        <div class="center muted"><Codicon name="loading" spin /> Loading projects and sessions…</div>
      {:else if groups.length === 0}
        <div class="center">
          <strong>No projects yet</strong>
          <p class="muted">Projects appear here after you open a folder with OpenCode on your computer.</p>
        </div>
      {:else if matched.length === 0}
        <div class="center muted">No project or session matches “{query}”.</div>
      {:else}
        {#each split.listed as group (group.directory)}
          {@render project(group)}
        {/each}
        {#if !query.trim() && split.empty.length > 0}
          <button class="emptyrow" onclick={toggleEmpty} aria-expanded={showEmpty}>
            <Codicon name={showEmpty ? "chevron-down" : "chevron-right"} />
            <span>{showEmpty ? "Hide empty projects" : `Show empty projects (${split.empty.length})`}</span>
          </button>
          {#if showEmpty}
            {#each split.empty as group (group.directory)}
              {@render project(group)}
            {/each}
          {/if}
        {/if}
      {/if}
    </div>

    <footer class="foot">
      <div class="srvname"><Codicon name="server" /> {model.profile?.name ?? "Server"}</div>
      <div class="fbtns">
        <button class="fbtn" onclick={() => model.openSettings()}><Codicon name="settings-gear" /> Settings</button>
      </div>
    </footer>
  </div>
{/if}

<style>
  button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0;
    cursor: pointer;
  }
  .scrim {
    position: absolute;
    z-index: 50;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
  }
  .drawer {
    position: absolute;
    z-index: 51;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(86vw, 340px);
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: calc(var(--sat) + 4px) 0 calc(var(--sab) + 4px) var(--sal);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    color: var(--oc-fg);
    border-right: 1px solid var(--oc-hairline);
    box-shadow: 0 0 32px var(--vscode-widget-shadow);
    outline: none;
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px 4px 16px;
    min-height: 52px;
  }
  .who {
    flex: 1;
    min-width: 0;
  }
  .srv {
    display: block;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cap {
    display: block;
    font-size: 0.78em;
    color: var(--oc-muted);
  }
  .iconbtn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    border-radius: 8px;
    font-size: 18px;
  }
  .iconbtn:active {
    background: var(--oc-hover);
  }
  /* The archive switch has no label, so its pressed state must be visible. */
  .iconbtn.on {
    color: var(--vscode-textLink-foreground);
    background: var(--vscode-list-activeSelectionBackground);
  }
  .search {
    flex: none;
    position: relative;
    padding: 4px 12px 10px;
  }
  .search :global(.codicon) {
    position: absolute;
    left: 24px;
    top: 50%;
    transform: translateY(-50%);
    margin-top: -3px;
    color: var(--oc-muted);
    pointer-events: none;
  }
  .search input {
    width: 100%;
    min-height: 44px;
    padding: 8px 12px 8px 36px;
    border-radius: 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--oc-hairline));
    color: var(--vscode-input-foreground);
  }
  .search input::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .group {
    border-bottom: 1px solid var(--oc-hairline);
  }
  .prow {
    display: flex;
    align-items: center;
    background: var(--vscode-editor-background);
  }
  .pname {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 8px 0 8px 16px;
    text-align: left;
  }
  .pname:active {
    background: var(--oc-hover);
  }
  .main {
    flex: 1;
    min-width: 0;
  }
  .t {
    display: block;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t.unread {
    font-weight: 700;
  }
  .badge {
    display: inline-block;
    margin-left: 6px;
    min-width: 1.4em;
    padding: 0 0.35em;
    border-radius: 999px;
    background: var(--oc-accent);
    color: var(--vscode-badge-foreground, var(--oc-selected-fg));
    font-size: 0.78em;
    font-weight: 600;
    line-height: 1.4em;
    text-align: center;
    vertical-align: middle;
  }
  .s {
    display: block;
    font-size: 0.82em;
    color: var(--oc-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .workers {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--oc-accent);
  }
  .srow-wrap {
    display: flex;
    align-items: center;
    border-top: 1px solid var(--oc-hairline);
    content-visibility: auto;
    contain-intrinsic-size: auto 50px;
  }
  .srow {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 50px;
    padding: 6px 4px 6px 24px;
    text-align: left;
  }
  .srow:active {
    background: var(--oc-hover);
  }
  .more {
    min-width: 44px;
    color: var(--oc-muted);
  }
  /* The archived rows are still there, but they are history: dimmed like the editor's pane does. */
  .srow-wrap.archived .t,
  .srow-wrap.archived .end,
  .srow-wrap.archived .state {
    opacity: 0.6;
  }
  /* A session's actions, one tap below its row: labelled buttons beat a long-press or a swipe nobody discovers. */
  .rowactions {
    display: flex;
    gap: 6px;
    padding: 0 12px 8px 40px;
  }
  .abtn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    border-radius: 8px;
    border: 1px solid var(--oc-hairline);
    color: var(--oc-accent);
  }
  .abtn.danger {
    color: var(--oc-error);
  }
  .abtn:active {
    background: var(--oc-hover);
  }
  .emptyrow {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 48px;
    padding: 6px 16px;
    text-align: left;
    color: var(--oc-muted);
    font-size: 0.9em;
  }
  .emptyrow:active {
    background: var(--oc-hover);
  }
  .end {
    flex: none;
    font-size: 0.8em;
    color: var(--oc-muted);
  }
  .empty {
    padding: 8px 16px 12px 40px;
    color: var(--oc-muted);
    font-size: 0.9em;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
    padding: 24px;
    min-height: 60%;
  }
  .center p {
    margin: 0;
    max-width: 28em;
  }
  .muted {
    color: var(--oc-muted);
  }
  .err {
    color: var(--oc-error);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 8px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-weight: 500;
  }
  .foot {
    flex: none;
    padding: 10px 12px 4px;
    border-top: 1px solid var(--oc-hairline);
    background: var(--vscode-editor-background);
  }
  .srvname {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 4px 6px;
    font-size: 0.82em;
    color: var(--oc-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fbtns {
    display: flex;
    gap: 6px;
  }
  .fbtn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    border-radius: 8px;
    border: 1px solid var(--oc-hairline);
    color: var(--oc-accent);
  }
  .fbtn:active {
    background: var(--oc-hover);
  }
  .state {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    color: var(--oc-muted);
  }
  /* A project with no sessions keeps its folder icon, never a check that would read as "seen". */
  .state.folder {
    color: var(--oc-muted);
  }
  .state.running,
  .state.unread {
    color: var(--oc-accent);
  }
  .state.waiting {
    color: var(--oc-amber);
  }
  .state.failed {
    color: var(--oc-error);
  }
</style>
