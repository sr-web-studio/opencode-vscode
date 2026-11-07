<script lang="ts">
  import { onMount } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import type { ImageRef } from "@occ/core/images"
  import Bar from "../components/Bar.svelte"
  import { model } from "../model.svelte"

  /** A sent image, full screen. Tap to switch between "fit the screen" and "actual size" (scroll to pan). */
  let { directory, sessionID, imageRef, name }: { directory: string; sessionID: string; imageRef: ImageRef; name?: string } = $props()

  let src = $state<string | undefined>()
  let failed = $state(false)
  let zoomed = $state(false)

  onMount(async () => {
    src = await model.imageUri(directory, sessionID, imageRef).catch(() => undefined)
    failed = !src
  })
</script>

<Bar title={name || "Image"} />

<div class="body view" class:zoomed>
  {#if failed}
    <div class="center muted"><Codicon name="warning" /><p>This image is no longer available.</p></div>
  {:else if !src}
    <div class="center muted"><Codicon name="loading" spin /> Loading…</div>
  {:else}
    <button class="pic" onclick={() => (zoomed = !zoomed)} aria-label={zoomed ? "Fit to screen" : "Actual size"}><img {src} alt={name || "Sent image"} /></button>
  {/if}
</div>

<style>
  .view { background: var(--vscode-editor-background); }
  .pic { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 100%; padding: 8px; }
  .pic img { max-width: 100%; max-height: calc(100vh - 120px); object-fit: contain; }
  .zoomed .pic { display: block; width: max-content; }
  .zoomed .pic img { max-width: none; max-height: none; }
</style>
