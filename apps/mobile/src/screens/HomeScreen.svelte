<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import Bar from "../components/Bar.svelte"
  import { model } from "../model.svelte"
</script>

<!--
  The connected-but-no-project state: the server has no folder yet, or its project list could not be read. There is no
  project list screen any more, so the drawer (or the server list, when this phone has more than one server) is where
  the owner picks one.
-->
<Bar title="OpenCode" sub={model.profile?.name} menu back={model.stack.length > 1}>
  {#snippet actions()}
    <button class="iconbtn" onclick={() => model.refreshOverview()} aria-label="Refresh"><Codicon name={model.overview.loading ? "loading" : "refresh"} spin={model.overview.loading} /></button>
  {/snippet}
</Bar>

<div class="body">
  {#if model.overview.error && !model.overview.data}
    <div class="center">
      <p class="err">{model.overview.error}</p>
      <button class="btn" onclick={() => model.overview.retry()}>Try again</button>
    </div>
  {:else if !model.overview.data}
    <div class="center muted"><Codicon name="loading" spin /> Loading projects…</div>
  {:else}
    <div class="center">
      <Codicon name="folder" />
      <strong>No projects yet</strong>
      <p class="muted">Open the menu to pick a project. Projects appear after you open a folder with OpenCode on your computer.</p>
      <button class="btn" onclick={() => model.openDrawer()}><Codicon name="menu" /> Open menu</button>
    </div>
  {/if}
</div>
