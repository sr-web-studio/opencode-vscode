<script lang="ts">
  import DiffView from "@occ/ui/components/DiffView.svelte"
  import { parsePatch, patchKind } from "@occ/core/diff"
  import Bar from "../components/Bar.svelte"
  import { leaf } from "../lib/files"

  /** The changes one file got, from the edit tool's patches, in the look of the inline diff. */
  let { file, patches }: { file: string; patches: string[] } = $props()

  const kind = $derived(patchKind(patches.flatMap((p) => parsePatch(p))))
  const label = $derived(kind === "added" ? "New file" : kind === "deleted" ? "Deleted" : "Changed")
</script>

<Bar title={leaf(file)} sub="{label} · {file}" />

<div class="body">
  {#each patches as patch, i (i)}
    <div class="one"><DiffView {patch} maxRows={5000} /></div>
  {:else}
    <div class="center muted">No changes were recorded for this file.</div>
  {/each}
</div>

<style>
  .one { padding: 8px; }
  .one :global(.diff) { max-height: none; }
</style>
