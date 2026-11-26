<script lang="ts">
  import Codicon from "./Codicon.svelte"

  let { text, label, class: extra = "" }: { text: () => string; label: string; class?: string } = $props()
  let state = $state<"idle" | "done" | "failed">("idle")
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy() {
    try {
      await navigator.clipboard.writeText(text())
      state = "done"
    } catch {
      state = "failed"
    }
    clearTimeout(timer)
    timer = setTimeout(() => (state = "idle"), 1600)
  }

  const title = $derived(state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label)
</script>

<button class="copy {extra}" type="button" {title} aria-label={title} onclick={copy}><Codicon name={state === "done" ? "check" : state === "failed" ? "error" : "copy"} /></button>

<style>
  .copy {
    display: inline-flex;
    align-items: center;
    padding: 0.15em 0.3em;
    border-radius: 4px;
    color: var(--oc-muted);
  }
  .copy:hover {
    color: var(--oc-fg);
    background: var(--oc-hover);
  }
</style>
