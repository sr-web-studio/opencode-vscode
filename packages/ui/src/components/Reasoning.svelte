<script lang="ts">
  import { keepAnchored } from "../anchor"
  import Codicon from "./Codicon.svelte"

  let { text, mode, streaming }: { text: string; mode: "collapsed" | "expanded"; streaming: boolean } = $props()
  let userOpen = $state<boolean | undefined>(undefined)
  let button: HTMLElement | undefined = $state()
  const open = $derived(userOpen ?? mode === "expanded")
</script>

<div class="reasoning muted">
  <button bind:this={button} onclick={() => keepAnchored(button ?? null, () => (userOpen = !open))} aria-expanded={open}>
    <Codicon name={open ? "chevron-down" : "chevron-right"} /> Thinking{#if streaming}…{/if}
  </button>
  {#if open && text.trim()}<div class="body">{text.trim()}</div>{/if}
</div>

<style>
  .reasoning {
    font-size: 0.95em;
  }
  .reasoning button {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    min-height: 28px;
  }
  .reasoning button:hover {
    color: var(--oc-fg);
  }
  .body {
    white-space: pre-wrap;
    /* Thinking text is plain text: an unbroken identifier must not widen the transcript. */
    overflow-wrap: anywhere;
    margin: 0.2em 0 0.4em 1.2em;
    font-style: italic;
  }
</style>
