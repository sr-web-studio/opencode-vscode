<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { relativeTime } from "@occ/core/format"
  import Bar from "../components/Bar.svelte"
  import { classifyConnectError } from "../lib/connect-error"
  import { guessHome, projectRows, type ProjectLike } from "../lib/projects"
  import { model } from "../model.svelte"

  let projects = $state.raw<ProjectLike[] | undefined>()
  let error = $state<string | undefined>()
  let query = $state("")
  // The row title is the folder's authoritative project once `location.get` answers; until then `projectRows` uses the
  // newest named record of the folder.
  const rows = $derived(projects ? projectRows(projects, query, model.projectIDs) : [])
  const now = Date.now()

  async function load() {
    error = undefined
    try {
      const list = await model.client.project.list()
      model.home = guessHome(list.map((p) => p.canonical))
      projects = list
      // Names first, then each folder's authoritative id a few at a time; the rows settle as the answers arrive.
      void model.learnProjects(list)
    } catch (e) {
      error = classifyConnectError(e, model.profile?.url ?? "", location.origin).message
    }
  }

  // Every screen of the stack stays mounted, so "onMount" fires once. Reload when this screen comes back to the top:
  // there is no event stream while only the project list is open, so a rename elsewhere shows on the return.
  let wasTop = false
  $effect(() => {
    const top = model.top
    const isTop = top.screen.kind === "projects"
    if (isTop && !wasTop) void load()
    wasTop = isTop
  })

  async function rename(directory: string) {
    if (await model.renameProject(directory)) void load()
  }
</script>

<Bar title="Projects" sub={model.profile?.name} menu>
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
      <div class="row">
        <button class="open" onclick={() => model.push({ kind: "sessions", directory: r.directory })}>
          <Codicon name="folder" />
          <span class="main"><span class="t">{r.title}</span><span class="s">{r.path}</span></span>
          <span class="end">{relativeTime(r.last, now)}</span>
        </button>
        <button class="iconbtn" onclick={() => rename(r.directory)} aria-label="Rename {r.title}" title="Rename project">
          <Codicon name="edit" />
        </button>
      </div>
    {/each}
  {/if}
</div>

<style>
  /* The row is a wrapper now: the folder button opens the project, the pencil renames it. */
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
  .row .iconbtn {
    margin-right: 4px;
  }
</style>
