<script lang="ts">
  import { onMount } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { relativeTime } from "@occ/core/format"
  import Bar from "../components/Bar.svelte"
  import { classifyConnectError } from "../lib/connect-error"
  import { guessHome, projectRows, type ProjectLike } from "../lib/projects"
  import { model } from "../model.svelte"

  let projects = $state.raw<ProjectLike[] | undefined>()
  let error = $state<string | undefined>()
  let query = $state("")
  const rows = $derived(projects ? projectRows(projects, query) : [])
  const now = Date.now()

  async function load() {
    error = undefined
    try {
      const list = await model.client.project.list()
      model.home = guessHome(list.map((p) => p.canonical))
      projects = list
    } catch (e) {
      error = classifyConnectError(e, model.profile?.url ?? "", location.origin).message
    }
  }

  onMount(() => void load())
</script>

<Bar title="Projects" sub={model.profile?.name}>
  {#snippet actions()}
    <button class="iconbtn" onclick={load} aria-label="Refresh"><Codicon name="refresh" /></button>
  {/snippet}
</Bar>

{#if projects && projects.length > 0}
  <div class="search"><input type="search" bind:value={query} placeholder="Search projects" aria-label="Search projects" autocomplete="off" /></div>
{/if}

<div class="body">
  {#if error}
    <div class="center">
      <p class="err">{error}</p>
      <button class="btn" onclick={load}>Try again</button>
    </div>
  {:else if !projects}
    <div class="center muted"><Codicon name="loading" spin /> Loading projects…</div>
  {:else if projects.length === 0}
    <div class="center">
      <strong>No projects yet</strong>
      <p class="muted">Projects appear here after you open a folder with OpenCode on your computer.</p>
    </div>
  {:else if rows.length === 0}
    <div class="center muted">No project matches “{query}”.</div>
  {:else}
    {#each rows as r (r.directory)}
      <button class="row" onclick={() => model.push({ kind: "sessions", directory: r.directory })}>
        <Codicon name="folder" />
        <span class="main"><span class="t">{r.title}</span><span class="s">{r.path}</span></span>
        <span class="end">{relativeTime(r.last, now)}</span>
      </button>
    {/each}
  {/if}
</div>
