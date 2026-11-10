<script lang="ts">
  import { onMount } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { DELETE_BUTTON, DELETE_DETAIL, deleteQuestion } from "@occ/core/delete-session"
  import { relativeTime } from "@occ/core/format"
  import { sessionStatus, statusLabel, type SessionStatus } from "@occ/core/session-status"
  import { groupSessions, toRows } from "@occ/core/sessions"
  import Bar from "../components/Bar.svelte"
  import ConnectionPill from "../components/ConnectionPill.svelte"
  import { liveState } from "../lib/live.svelte"
  import { model } from "../model.svelte"

  /**
   * All sessions of one project: the project's controller keeps the list live. This screen is also where the phone
   * deletes a stopped session and shows the archived ones, now that the chat's session dropdown is gone.
   */
  let { directory }: { directory: string } = $props()

  // svelte-ignore state_referenced_locally
  const ctl = model.controller(directory)
  const live = liveState(ctl)
  let query = $state("")
  const st = $derived(live.state)
  const now = Date.now()
  /**
   * The server's root list carries archived sessions too (it only separates them when asked), so the archive switch
   * has to filter them out here. With the switch on, the folder's archived page fills in what the root list missed.
   */
  const list = $derived.by(() => {
    const s = st
    if (!s) return []
    const live = s.sessions.filter((session) => session.time.archived === undefined)
    if (!s.showArchived) return live
    const seen = new Set(live.map((session) => session.id))
    const archived = [...s.sessions.filter((session) => session.time.archived !== undefined), ...s.archived].filter((session) => {
      if (seen.has(session.id)) return false
      seen.add(session.id)
      return true
    })
    return [...live, ...archived]
  })
  const groups = $derived(st ? groupSessions(toRows({ sessions: list, running: new Set(st.running), waiting: new Set(st.waiting) }), query, now) : [])
  /** The status of every row, from the server record the row was built from (the light row keeps no outcome). */
  const statuses = $derived.by(() => {
    const s = st
    if (!s) return new Map<string, SessionStatus>()
    const sets = { running: new Set(s.running), waiting: new Set(s.waiting) }
    return new Map([...s.sessions, ...s.archived].map((session) => [session.id, sessionStatus(session, sets)]))
  })
  /** Sessions the server lists for this folder, archived ones included (the switch hides those). */
  const count = $derived(st?.sessions.length ?? 0)
  const failed = $derived(st?.connection.status === "error")
  const title = $derived(model.projectTitle(directory) ?? st?.folderName ?? directory)

  // Opening the project is the moment to learn its authoritative project: the header and the chat show its name.
  onMount(() => void model.resolveProject(directory))

  async function remove(id: string, name: string): Promise<void> {
    const ok = await model.confirm({ title: deleteQuestion(name), detail: DELETE_DETAIL, confirm: DELETE_BUTTON, danger: true })
    if (ok) void ctl.dispatch({ type: "deleteSession", sessionID: id })
  }
</script>

<Bar {title} sub={st?.displayPath} menu>
  {#snippet actions()}
    <ConnectionPill connection={st?.connection} />
    <button
      class="iconbtn"
      class:on={st?.showArchived}
      onclick={() => void ctl.dispatch({ type: "toggleArchived" })}
      aria-pressed={st?.showArchived}
      aria-label={st?.showArchived ? "Hide archived sessions" : "Show archived sessions"}
      title={st?.showArchived ? "Hide archived sessions" : "Show archived sessions"}><Codicon name="archive" /></button
    >
    <button class="iconbtn" onclick={() => void model.renameProject(directory)} aria-label="Rename project" title="Rename project"><Codicon name="edit" /></button>
    <button class="iconbtn" onclick={() => model.push({ kind: "chat", directory, draft: true })} aria-label="New session"><Codicon name="add" /></button>
  {/snippet}
</Bar>

{#if list.length > 0 || st?.showArchived}
  <div class="search"><input type="search" bind:value={query} placeholder="Search sessions" aria-label="Search sessions" autocomplete="off" /></div>
{/if}

<div class="body">
  {#if failed}
    <div class="center">
      <p class="err">{st?.connection.message ?? "Could not load this project."}</p>
      <button class="btn" onclick={() => ctl.reconnect()}>Try again</button>
    </div>
  {:else if !st || !st.sessionsLoaded}
    <div class="center muted"><Codicon name="loading" spin /> Loading sessions…</div>
  {:else if list.length === 0 && count > 0}
    <div class="center">
      <strong>No active sessions</strong>
      <p class="muted">Every session of this project is archived. Show the archive to open one again.</p>
    </div>
  {:else if count === 0}
    <div class="center">
      <strong>No sessions yet</strong>
      <p class="muted">Start one here. It keeps running on the server when you close the app.</p>
      <button class="btn" onclick={() => model.push({ kind: "chat", directory, draft: true })}><Codicon name="add" /> New session</button>
    </div>
  {:else if groups.length === 0}
    <div class="center muted">No session matches “{query}”.</div>
  {:else}
    {#each groups as g (g.name)}
      <h2 class="group">{g.name}</h2>
      {#each g.rows as r (r.id)}
        {@const status = statuses.get(r.id) ?? "read"}
        <div class="row" class:archived={r.archived}>
          <button class="open" onclick={() => model.push({ kind: "chat", directory, sessionID: r.id })} aria-label={`${r.title}, ${statusLabel(status)}`}>
            {@render stateIcon(status)}
            <span class="main">
              <span class="t" class:unread={status === "unread"}>{r.title}</span>
              {#if status !== "read"}<span class="s">{statusLabel(status)}</span>{/if}
            </span>
            <span class="end">{relativeTime(r.updated, now)}</span>
          </button>
          {#if r.dot === "none"}
            <button class="iconbtn del" onclick={() => void remove(r.id, r.title)} aria-label="Delete {r.title}" title="Delete session"><Codicon name="trash" /></button>
          {/if}
        </div>
      {/each}
    {/each}
  {/if}
</div>

{#snippet stateIcon(status: SessionStatus)}
  <span class="state {status}">
    {#if status === "running"}<Codicon name="loading" spin />
    {:else if status === "waiting"}<Codicon name="bell-dot" />
    {:else if status === "failed"}<Codicon name="error" />
    {:else if status === "unread"}<Codicon name="circle-filled" />
    {:else}<Codicon name="check" />{/if}
  </span>
{/snippet}

<style>
  .group {
    margin: 0;
    padding: 14px 16px 4px;
    font-size: 0.8em;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--oc-muted);
  }
  /* The row is a wrapper: the open button is the row, the trash icon sits beside it. */
  :global(.screen) > :not(.chat) .row {
    padding: 0;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 4px 8px 16px;
    text-align: left;
  }
  .row.archived .t,
  .row.archived .end {
    opacity: 0.6;
  }
  .t.unread {
    font-weight: 700;
  }
  .del {
    margin-right: 4px;
    color: var(--oc-muted);
  }
  /* The archive switch has no label, so its pressed state must be visible. */
  .iconbtn.on {
    color: var(--vscode-textLink-foreground);
    background: var(--vscode-list-activeSelectionBackground);
  }
</style>
