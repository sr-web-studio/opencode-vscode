<script lang="ts">
  import { isImageMime } from "../../core/attachments"
  import Codicon from "./Codicon.svelte"

  /** A chip: a file (thumbnail for images, an icon otherwise) or, with `icon`, something else attached to the prompt, like a skill. `onremove` only in the prompt box (sent chips have none). */
  let { name, mime, thumb, warn, icon, onremove }: { name: string; mime?: string; thumb?: string; warn?: string; icon?: string; onremove?: () => void } = $props()
</script>

<span class="chip" class:warn={!!warn} title={warn ? `${name} — ${warn}` : name}>
  {#if thumb}<img src={thumb} alt="" />{:else if icon}<Codicon name={icon} />{:else}<Codicon name={isImageMime(mime) ? "file-media" : "go-to-file"} />{/if}
  <span class="n">{name}</span>
  {#if warn}<Codicon name="warning" label={warn} />{/if}
  {#if onremove}<button class="x muted" onclick={onremove} aria-label="Remove {name}"><Codicon name="close" /></button>{/if}
</span>

<style>
  .chip { display: inline-flex; align-items: center; gap: 0.4em; max-width: 100%; padding: 0.15em 0.5em; border: 1px solid var(--oc-hairline); border-radius: 6px; background: var(--oc-popover); font-size: 0.9em; }
  .chip.warn { border-color: var(--oc-amber); }
  .chip.warn :global(.codicon-warning) { color: var(--oc-amber); }
  img { width: 24px; height: 24px; object-fit: cover; border-radius: 3px; flex: none; }
  .n { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .x { display: inline-flex; align-items: center; }
  .x:hover { color: var(--oc-fg); }
</style>
