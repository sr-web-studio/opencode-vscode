<script lang="ts">
  import { onMount } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { relativeTime } from "@occ/core/format"
  import { groupSessions, toRows } from "@occ/core/sessions"
  import Bar from "../components/Bar.svelte"
  import ConnectionPill from "../components/ConnectionPill.svelte"
  import { liveState } from "../lib/live.svelte"
  import { model } from "../model.svelte"

  /** All sessions of one project. The project's controller starts here; it keeps the running dots live. */
  let { directory }: { directory: string } = $props()

  // svelte-ignore state_referenced_locally
  const ctl = model.controller(directory)
  const live = liveState(ctl)
  let query = $state("")
  const st = $derived(live.state)
  const now = Date.now()
  const groups = $derived(st ? groupSessions(toRows({ sessions: st.sessions, running: new Set(st.running), waiting: new Set(st.waiting) }), query, now) : [])
  const count = $derived(st?.sessions.length ?? 0)
  const failed = $derived(st?.connection.status === "error")
  const title = $derived(model.projectTitle(directory) ?? st?.folderName ?? directory)

  // Opening the project is the moment to learn its authoritative project: the header and the chat show its name.
  onMount(() => void model.resolveProject(directory))
</script>

<Bar {title} sub={st?.displayPath}>
  {#snippet actions()}
    <ConnectionPill connection={st?.connection} />
    <button class="iconbtn" onclick={() => void model.renameProject(directory)} aria-label="Rename project" title="Rename project"><Codicon name="edit" /></button>
    <button class="iconbtn" onclick={() => model.push({ kind: "chat", directory, draft: true })} aria-label="New session"><Codicon name="add" /></button>
  {/snippet}
</Bar>

{#if count > 0}
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
        <button class="row" onclick={() => model.push({ kind: "chat", directory, sessionID: r.id })}>
          <span class="dot {r.dot}" role="img" aria-label={r.dot === "running" ? "Running" : r.dot === "waiting" ? "Waiting for you" : ""}></span>
          <span class="main"
            ><span class="t">{r.title}</span>{#if r.dot !== "none"}<span class="s">{r.dot === "running" ? "Running" : "Waiting for your answer"}</span>{/if}</span
          >
          <span class="end">{relativeTime(r.updated, now)}</span>
        </button>
      {/each}
    {/each}
  {/if}
</div>

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
</style>
