<script lang="ts">
  import { isImageMime } from "@occ/core/attachments"
  import Codicon from "./Codicon.svelte"

  /** A chip: a file (thumbnail for images, an icon otherwise) or, with `icon`, something else attached to the prompt, like a skill. `onremove` only in the prompt box (sent chips have none). */
  let { name, mime, thumb, warn, icon, onremove }: { name: string; mime?: string; thumb?: string; warn?: string; icon?: string; onremove?: () => void } = $props()
</script>

<span class="chip" class:card={!!thumb} class:warn={!!warn} title={warn ? `${name} — ${warn}` : name}>
  {#if thumb}
    <!-- An image attachment: the preview on top, larger than a row chip, the name in one line under it. -->
    <span class="preview"><img src={thumb} alt="" /></span>
    <span class="cap">
      <span class="n">{name}</span>
      {#if warn}<Codicon name="warning" label={warn} />{/if}
    </span>
  {:else}
    {#if icon}<Codicon name={icon} />{:else}<Codicon name={isImageMime(mime) ? "file-media" : "go-to-file"} />{/if}
    <span class="n">{name}</span>
    {#if warn}<Codicon name="warning" label={warn} />{/if}
  {/if}
  {#if onremove}<button class="x muted" onclick={onremove} title="Remove {name}" aria-label="Remove {name}"><Codicon name="close" /></button>{/if}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    max-width: 100%;
    padding: 0.15em 0.5em;
    border: 1px solid var(--oc-hairline);
    border-radius: 6px;
    background: var(--oc-popover);
    font-size: 0.9em;
  }
  .chip.warn {
    border-color: var(--oc-amber);
  }
  .chip.warn :global(.codicon-warning) {
    color: var(--oc-amber);
  }
  .n {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .x:hover {
    color: var(--oc-fg);
  }

  /* Image attachment: a small card. The preview takes the full width and ~72px of height, cropped to fill
     (`object-fit: cover` keeps its aspect ratio); the name sits below in one line and ends in an ellipsis. */
  .chip.card {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    width: 132px;
    max-width: 100%;
    padding: 0;
    overflow: visible;
    position: relative;
    font-size: 0.85em;
  }
  .preview {
    display: block;
    width: 100%;
    height: 72px;
    overflow: hidden;
    border-radius: 5px 5px 0 0;
    background: var(--oc-hover);
  }
  .preview img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cap {
    display: flex;
    align-items: center;
    gap: 0.3em;
    min-width: 0;
    padding: 0.2em 0.5em 0.3em;
  }
  .cap .n {
    flex: 1 1 auto;
  }
  .cap :global(.codicon) {
    flex: none;
  }
  /* The remove button floats over the top-right corner of the picture, so the name keeps the full width. */
  .chip.card .x {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid var(--oc-hairline);
    background: var(--vscode-editorWidget-background, rgba(0, 0, 0, 0.55));
  }
  .chip.card .x:hover {
    background: var(--oc-hover);
  }
  /* Touch: the corner button grows to a finger-sized target (the visual circle stays where it is). */
  @media (hover: none) {
    .chip.card .x {
      width: 40px;
      height: 40px;
      top: 0;
      right: 0;
      border-radius: 0 5px 0 5px;
    }
  }
</style>
