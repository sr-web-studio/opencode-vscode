<script lang="ts">
  import { isImageMime } from "../../core/attachments"
  import type { FileChip } from "../../core/transcript/types"
  import { useStore } from "../context"
  import Chip from "./Chip.svelte"
  import SentImage from "./SentImage.svelte"

  /** The attachments of a sent prompt: image thumbnails first, then file chips. A chip with a `file://` URI opens the file. */
  let { files }: { files: FileChip[] } = $props()
  const store = useStore()
  const images = $derived(files.flatMap((f, i) => (f.ref && isImageMime(f.mime) ? [{ f, i }] : [])))
  const others = $derived(files.flatMap((f, i) => (f.ref && isImageMime(f.mime) ? [] : [{ f, i }])))
</script>

{#if images.length > 0}
  <div class="row">{#each images as { f, i } (i)}<SentImage imageRef={f.ref!} name={f.name} />{/each}</div>
{/if}
{#if others.length > 0}
  <div class="row">
    {#each others as { f, i } (i)}
      {#if f.uri}
        <button class="open" onclick={() => store.bridge.openFile(f.uri!)} title={`Open ${f.name}`}><Chip name={f.name} mime={f.mime} /></button>
      {:else}
        <Chip name={f.name} mime={f.mime} />
      {/if}
    {/each}
  </div>
{/if}

<style>
  .row { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.5em; }
  .open { display: inline-flex; max-width: 100%; text-align: left; }
  .open:hover :global(.chip) { border-color: var(--oc-accent); }
</style>
