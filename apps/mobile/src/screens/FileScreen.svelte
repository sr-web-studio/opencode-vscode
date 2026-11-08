<script lang="ts">
  import { onMount, tick } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { dataUri } from "@occ/core/attachments"
  import Bar from "../components/Bar.svelte"
  import { classifyFile, humanSize, leaf, MAX_VIEW_LINES, type FileContent } from "../lib/files"
  import { model } from "../model.svelte"

  /** A read-only view of a file of the project (what "open file" does in the editor). */
  let { directory, path, line }: { directory: string; path: string; line?: number } = $props()

  let content = $state.raw<FileContent | undefined>()
  let image = $state<string | undefined>()
  let error = $state<string | undefined>()
  let box: HTMLElement | undefined = $state()

  const lines = $derived(content?.kind === "text" ? content.text.split("\n") : [])

  function base64(bytes: Uint8Array): string {
    let bin = ""
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }

  async function load() {
    error = undefined
    content = undefined
    try {
      const bytes = await model.client.file.read({ path, location: { directory } })
      const c = classifyFile(path, bytes)
      if (c.kind === "image") image = dataUri(c.mime, base64(bytes))
      content = c
      if (c.kind === "text" && line) {
        await tick()
        box?.querySelector(".hit")?.scrollIntoView({ block: "center" })
      }
    } catch (e) {
      const tag = (e as { _tag?: string } | undefined)?._tag
      error = tag === "FileNotFoundError" ? "This file no longer exists in the project." : `Could not open the file: ${e instanceof Error ? e.message : "unknown error"}`
    }
  }

  onMount(() => void load())
</script>

<Bar title={leaf(path)} sub={path} />

<div class="body" bind:this={box}>
  {#if error}
    <div class="center"><p class="err">{error}</p><button class="btn" onclick={load}>Try again</button></div>
  {:else if !content}
    <div class="center muted"><Codicon name="loading" spin /> Opening…</div>
  {:else if content.kind === "image"}
    <div class="img">{#if image}<img src={image} alt={leaf(path)} />{/if}</div>
  {:else if content.kind === "binary"}
    <div class="center"><Codicon name="file-binary" /><p class="muted">This file is not text ({humanSize(content.size)}), so it cannot be shown here.</p></div>
  {:else}
    {#if content.truncated}<div class="note pad">Only the first {MAX_VIEW_LINES} lines are shown.</div>{/if}
    <div class="source">
      {#each lines as text, i (i)}
        <div class="ln" class:hit={line === i + 1}><span class="no">{i + 1}</span><span class="tx">{text === "" ? " " : text}</span></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .img { display: flex; justify-content: center; padding: 12px; }
  .img img { max-width: 100%; height: auto; }
</style>
