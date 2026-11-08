<script lang="ts">
  import { onMount } from "svelte"
  import { THUMB_HEIGHT, thumbSize, type ImageRef } from "@occ/core/images"
  import { useStore } from "../context"
  import Codicon from "./Codicon.svelte"
  import { thumbFor } from "../thumbs"

  /** A sent image: a ~64px thumbnail, loaded from the host only when it scrolls into view. Click opens it in full. */
  let { imageRef, name }: { imageRef: ImageRef; name: string } = $props()
  const store = useStore()

  let el: HTMLButtonElement | undefined = $state()
  let src = $state<string | undefined>(undefined)
  let phase = $state<"idle" | "loading" | "ready" | "missing">("idle")

  async function load() {
    if (phase !== "idle") return
    phase = "loading"
    const url = await thumbFor(imageRef, (r) => store.bridge.imageData(r), downscale)
    src = url
    phase = url ? "ready" : "missing"
  }

  onMount(() => {
    if (!el || typeof IntersectionObserver === "undefined") {
      void load()
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void load()
          io.disconnect()
        }
      },
      { rootMargin: "200px" },
    )
    io.observe(el)
    return () => io.disconnect()
  })

  /** Large images are redrawn once at thumbnail size, so the DOM never holds a full-size bitmap per chip. */
  function downscale(dataUri: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const size = thumbSize(img.naturalWidth, img.naturalHeight)
        if (!size.scaled) return resolve(dataUri)
        const canvas = document.createElement("canvas")
        canvas.width = size.width
        canvas.height = size.height
        const ctx = canvas.getContext("2d")
        if (!ctx) return resolve(dataUri)
        ctx.drawImage(img, 0, 0, size.width, size.height)
        resolve(canvas.toDataURL("image/jpeg", 0.85))
      }
      img.onerror = () => resolve(dataUri)
      img.src = dataUri
    })
  }
</script>

<button class="thumb" bind:this={el} onclick={() => store.bridge.openImage(imageRef, name)} title={`${name}: open the image`} aria-label={`Open image ${name}`} style:height="{THUMB_HEIGHT}px">
  {#if src}
    <img {src} alt={name} style:height="{THUMB_HEIGHT}px" />
  {:else if phase === "missing"}
    <span class="ph muted"><Codicon name="file-media" /><span class="n">{name}</span></span>
  {:else}
    <span class="ph skeleton" aria-hidden="true"></span>
  {/if}
</button>

<style>
  .thumb {
    display: inline-flex;
    align-items: stretch;
    max-width: 100%;
    border: 1px solid var(--oc-hairline);
    border-radius: 6px;
    overflow: hidden;
    background: var(--oc-popover);
  }
  .thumb:hover {
    border-color: var(--oc-accent);
  }
  img {
    display: block;
    width: auto;
    max-width: 220px;
    object-fit: cover;
  }
  .ph {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    padding: 0 0.8em;
    min-width: 64px;
    font-size: 0.9em;
  }
  .skeleton {
    width: 64px;
    background: var(--oc-hover);
  }
  .n {
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
