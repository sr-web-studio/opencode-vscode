<script lang="ts">
  import { onMount, tick } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { dataUri } from "@occ/core/attachments"
  import Bar from "../components/Bar.svelte"
  import { classifyFile, fileReadInput, humanSize, leaf, MAX_VIEW_LINES, type FileContent } from "../lib/files"
  import { model } from "../model.svelte"

  /** A read-only view of a file of the project (what "open file" does in the editor). */
  let { directory, path, candidates, line }: { directory: string; path: string; candidates?: string[]; line?: number } = $props()

  /** Where the file may be, best guess first (a link can be relative to the session folder, `~`, absolute…). */
  const places = $derived(candidates && candidates.length > 0 ? candidates : [path])
  let shownPath = $state("")
  let missing = $state<string[]>([])
  let copied = $state(false)
  $effect.pre(() => {
    if (!shownPath) shownPath = places[0] ?? path
  })

  let content = $state.raw<FileContent | undefined>()
  let image = $state<string | undefined>()
  let error = $state<string | undefined>()
  let box: HTMLElement | undefined = $state()
  /** Images: tap to switch between "fit the screen" and "actual size" (scroll to pan). */
  let zoomed = $state(false)

  const lines = $derived(content?.kind === "text" ? content.text.split("\n") : [])

  function base64(bytes: Uint8Array): string {
    let bin = ""
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }

  async function load() {
    error = undefined
    content = undefined
    const tried: string[] = []
    try {
      let bytes: Uint8Array | undefined
      let lastError: unknown
      for (const candidate of places) {
        try {
          bytes = await model.client.file.read(fileReadInput(candidate, directory))
          shownPath = candidate
          break
        } catch (e) {
          if ((e as { _tag?: string } | undefined)?._tag !== "FileNotFoundError") throw e
          tried.push(candidate)
          lastError = e
        }
      }
      if (!bytes) throw lastError
      const c = classifyFile(shownPath, bytes)
      if (c.kind === "image") image = dataUri(c.mime, base64(bytes))
      content = c
      if (c.kind === "text" && line) {
        await tick()
        box?.querySelector(".hit")?.scrollIntoView({ block: "center" })
      }
    } catch (e) {
      const tag = (e as { _tag?: string } | undefined)?._tag
      missing = tag === "FileNotFoundError" ? tried : []
      error =
        tag === "FileNotFoundError"
          ? tried.length === 1
            ? `File not found: ${tried[0]}`
            : `File not found. Looked in:\n${tried.join("\n")}`
          : `Could not open the file: ${e instanceof Error ? e.message : "unknown error"}`
    }
  }

  async function copyPaths() {
    try {
      await navigator.clipboard.writeText(missing.join("\n"))
      copied = true
    } catch {
      copied = false
    }
  }

  onMount(() => void load())
</script>

<Bar title={leaf(shownPath || path)} sub={shownPath || path} />

<div class="body" bind:this={box}>
  {#if error}
    <div class="center">
      <p class="err paths">{error}</p>
      {#if missing.length > 0}
        <button class="btn" onclick={copyPaths}>{copied ? "Copied" : missing.length === 1 ? "Copy path" : "Copy paths"}</button>
      {/if}
      <button class="btn" onclick={load}>Try again</button>
    </div>
  {:else if !content}
    <div class="center muted"><Codicon name="loading" spin /> Opening…</div>
  {:else if content.kind === "image"}
    <div class="img" class:zoomed>
      {#if image}
        <button class="pic" onclick={() => (zoomed = !zoomed)} aria-label={zoomed ? "Fit to screen" : "Actual size"}><img src={image} alt={leaf(path)} /></button>
      {/if}
    </div>
  {:else if content.kind === "binary"}
    <div class="center">
      <Codicon name="file-binary" />
      <p class="muted">This file is not text ({humanSize(content.size)}), so it cannot be shown here.</p>
    </div>
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
  .paths {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    text-align: left;
  }
  .img {
    display: flex;
    justify-content: center;
    padding: 12px;
  }
  .pic {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 0;
  }
  .pic img {
    max-width: 100%;
    height: auto;
  }
  .zoomed {
    display: block;
    overflow: auto;
  }
  .zoomed .pic {
    width: max-content;
    max-width: none;
  }
  .zoomed .pic img {
    max-width: none;
    max-height: none;
  }
</style>
