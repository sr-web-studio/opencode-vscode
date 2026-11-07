<script lang="ts">
  import type { Suggestion } from "@occ/core/slash"
  import Codicon from "./Codicon.svelte"

  /**
   * The suggestion list above the prompt box. It is only a view: the textarea keeps focus and the keyboard, and points
   * at the active row with `aria-activedescendant`. Rows take the mouse without moving focus (`mousedown` is cancelled).
   */
  let {
    id,
    items,
    index,
    label,
    empty,
    onpick,
    onhover,
  }: {
    id: string
    items: Suggestion[]
    index: number
    label: string
    /** Shown instead of rows when the list is empty (skills only; an empty command list hides the popup). */
    empty?: string
    onpick: (s: Suggestion) => void
    onhover: (i: number) => void
  } = $props()

  let list: HTMLDivElement | undefined = $state()
  $effect(() => {
    void index
    list?.querySelector(".sel")?.scrollIntoView({ block: "nearest" })
  })
</script>

<div class="sr" aria-live="polite">{items.length === 0 ? (empty ?? "") : `${items.length} ${items.length === 1 ? "suggestion" : "suggestions"}`}</div>
<div class="pop scroll" role="listbox" {id} aria-label={label} bind:this={list}>
  {#each items as s, i (`${s.source}:${s.id ?? s.name}`)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      id="{id}-{i}"
      class="row"
      class:sel={i === index}
      role="option"
      tabindex="-1"
      aria-selected={i === index}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => onpick(s)}
      onmousemove={() => i !== index && onhover(i)}
    >
      {#if s.source === "skill"}<span class="n">{s.name}</span>{:else}<span class="n">/{s.name}</span>{/if}
      {#if s.description}<span class="d muted">{s.description}</span>{/if}
      {#if s.source === "client"}<span class="mark muted" title="Built into this extension"><Codicon name="extensions" label="Built into this extension" /></span>{/if}
    </div>
  {:else}
    <div class="empty muted">{empty ?? ""}</div>
  {/each}
</div>

<style>
  .pop {
    position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 25;
    max-height: min(40vh, 15em); overflow-y: auto; padding: 3px 0;
    font-size: inherit; line-height: 1.5;
    color: var(--vscode-editorSuggestWidget-foreground, var(--oc-fg));
    background: var(--vscode-editorSuggestWidget-background, var(--oc-popover));
    border: 1px solid var(--vscode-editorSuggestWidget-border, var(--oc-hairline));
    border-radius: 6px; box-shadow: 0 4px 16px var(--vscode-widget-shadow);
  }
  .row { display: flex; align-items: baseline; gap: 0.7em; min-height: 24px; padding: 1px 10px; cursor: pointer; }
  .row.sel { background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-quickInputList-focusBackground, var(--oc-selected))); color: var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-quickInputList-focusForeground, var(--oc-selected-fg, inherit))); }
  .row.sel .muted { color: inherit; opacity: 0.8; }
  .n { font-weight: 600; white-space: nowrap; flex: none; max-width: 70%; overflow: hidden; text-overflow: ellipsis; }
  .d { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mark { flex: none; margin-left: auto; opacity: 0.7; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .empty { padding: 4px 10px; }
</style>
