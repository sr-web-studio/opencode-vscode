<script lang="ts">
  let { text, mode, streaming }: { text: string; mode: "collapsed" | "expanded"; streaming: boolean } = $props()
  let userOpen = $state<boolean | undefined>(undefined)
  const open = $derived(userOpen ?? mode === "expanded")
</script>

<div class="reasoning muted">
  <button onclick={() => (userOpen = !open)} aria-expanded={open}>
    <span class="chev">{open ? "⌄" : "›"}</span> Thinking{#if streaming}…{/if}
  </button>
  {#if open && text.trim()}<div class="body">{text.trim()}</div>{/if}
</div>

<style>
  .reasoning { font-size: 0.95em; }
  .reasoning button:hover { color: var(--oc-fg); }
  .body { white-space: pre-wrap; margin: 0.2em 0 0.4em 1.2em; font-style: italic; }
</style>
