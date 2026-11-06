<script lang="ts">
  import { EMPTY_NOTE, SUGGESTIONS } from "../../core/draft"

  let { folderName, displayPath, onsuggest }: { folderName: string; displayPath: string; onsuggest: (text: string) => void } = $props()
</script>

<div class="empty">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7 3.5 12 8 17" /><path d="m16 7 4.5 5L16 17" /><path d="m13.5 5-3 14" /></svg>
  <div class="word">OpenCode</div>
  <div class="folder">{folderName}</div>
  <div class="path muted" title={displayPath}>{displayPath}</div>
  <div class="sugs">
    {#each SUGGESTIONS as s (s)}
      <button class="link" onclick={() => onsuggest(s)}>{s}</button>
    {/each}
  </div>
  <div class="note muted">{EMPTY_NOTE}</div>
</div>

<style>
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25em; padding: 1em; text-align: center; min-height: 0; overflow: auto; }
  .word { font-size: 1.3em; font-weight: 600; letter-spacing: 0.02em; margin-top: 0.2em; }
  .folder { margin-top: 0.8em; font-weight: 600; }
  .path { font-size: 0.9em; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sugs { display: flex; flex-direction: column; gap: 0.3em; margin: 1.4em 0 1.6em; }
  .note { font-size: 0.85em; max-width: 24em; }
</style>
