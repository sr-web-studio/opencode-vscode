<script lang="ts">
  import { gutterDigits, parsePatch, patchRows, segments } from "@occ/core/diff"

  /** The inline diff of one edit, in the look of VS Code's own diff editor: gutters, coloured rows, changed words marked. */
  let { patch, maxRows = 60 }: { patch: string; maxRows?: number } = $props()
  const all = $derived(patchRows(parsePatch(patch)))
  let showAll = $state(false)
  const rows = $derived(showAll ? all : all.slice(0, maxRows))
  const digits = $derived(gutterDigits(all))
</script>

{#if all.length === 0}
  <div class="empty muted">No changes recorded.</div>
{:else}
  <div class="diff" style:--digits="{digits}ch" role="table" aria-label="Changes">
    {#each rows as row, i (i)}
      {#if row.kind === "hunk"}
        <div class="sep muted" role="row">⋯ line {row.line}</div>
      {:else}
        <div class="row {row.kind}" role="row">
          <span class="gut" aria-hidden="true">{row.oldNo ?? ""}</span>
          <span class="gut" aria-hidden="true">{row.newNo ?? ""}</span>
          <span class="mark" aria-hidden="true">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}</span>
          <span class="code">{#each segments(row.text, row.marks) as s}{#if s.mark}<span class="word">{s.text}</span>{:else}{s.text}{/if}{/each}{row.text === "" ? " " : ""}</span>
        </div>
      {/if}
    {/each}
    {#if all.length > rows.length}
      <button class="link more" onclick={() => (showAll = true)}>Show {all.length - rows.length} more lines</button>
    {/if}
  </div>
{/if}

<style>
  .diff { margin: 0.25em 0; background: var(--oc-code-bg); border-radius: 4px; max-height: 20em; overflow: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 0.95em); line-height: 1.5; }
  .row { display: flex; min-width: max-content; }
  .gut { flex: none; width: var(--digits); padding: 0 0.6ch; box-sizing: content-box; text-align: right; color: var(--vscode-editorLineNumber-foreground, var(--oc-muted)); user-select: none; }
  .mark { flex: none; width: 2ch; text-align: center; color: var(--oc-muted); user-select: none; }
  .code { flex: 1; white-space: pre; padding-right: 1ch; }
  .add { background: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.2)); }
  .del { background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.2)); }
  .add .word { background: var(--vscode-diffEditor-insertedTextBackground, rgba(156, 204, 44, 0.25)); }
  .del .word { background: var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.3)); }
  .sep { padding: 1px 0.8ch; font-size: 0.85em; background: var(--oc-hover); border-top: 1px solid var(--oc-hairline); border-bottom: 1px solid var(--oc-hairline); }
  .sep:first-child { border-top: none; }
  .more { display: block; padding: 0.3em 0.8ch; }
  .empty { padding: 0.3em 0; }
</style>
