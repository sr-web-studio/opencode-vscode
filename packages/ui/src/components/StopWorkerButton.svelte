<script lang="ts">
  import { onDestroy } from "svelte"
  import { useStore } from "../context"
  import Codicon from "./Codicon.svelte"

  /**
   * Stops one worker (child session). The lead keeps running and gets the worker's result as "cancelled". There is no
   * confirmation: the lead can call the worker again. A second click is ignored while the request is in flight: the
   * button stays disabled until the worker is no longer running, an error shows up, or `GIVE_UP_MS` passed.
   * `icon`: a small square button for a list row (shown on hover or focus of the row when `reveal`);
   * `label`: a text button for a header.
   */
  let { sessionID, running, variant = "icon", reveal = false }: { sessionID: string; running: boolean; variant?: "icon" | "label"; reveal?: boolean } = $props()
  const GIVE_UP_MS = 10_000
  const store = useStore()
  let pending = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function stop() {
    if (pending || !running) return
    pending = true
    store.dispatch({ type: "stopWorker", sessionID })
    clearTimeout(timer)
    timer = setTimeout(() => (pending = false), GIVE_UP_MS)
  }
  // The status changed (the worker is "Stopped"), or the request failed and the error line shows: the button is free again.
  $effect(() => {
    if (!running || store.state?.error) {
      pending = false
      clearTimeout(timer)
    }
  })
  onDestroy(() => clearTimeout(timer))
</script>

{#if variant === "label"}
  <button class="lbl" disabled={pending} onclick={stop} aria-label="Stop worker" title="Stop this worker (the lead keeps running)">
    <Codicon name={pending ? "loading" : "debug-stop"} spin={pending} /><span>{pending ? "Stopping…" : "Stop"}</span>
  </button>
{:else}
  <button class="ico muted" class:reveal class:pending disabled={pending} onclick={stop} aria-label="Stop worker" title="Stop this worker (the lead keeps running)">
    <Codicon name={pending ? "loading" : "debug-stop"} spin={pending} />
  </button>
{/if}

<style>
  .ico {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    min-height: 24px;
    border-radius: 4px;
  }
  .ico.reveal {
    opacity: 0;
  }
  .ico.reveal.pending {
    opacity: 1;
  }
  :global(.row:hover) .ico.reveal,
  :global(.row:focus-within) .ico.reveal {
    opacity: 1;
  }
  .ico:hover:not(:disabled) {
    color: var(--oc-error);
    background: var(--oc-hover);
  }
  .ico:disabled {
    cursor: default;
  }
  @media (hover: none) {
    .ico.reveal {
      opacity: 1;
    }
  }
  .lbl {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    margin-left: 0.4em;
    padding: 0.1em 0.55em;
    border-radius: 4px;
    border: 1px solid var(--oc-hairline);
    font-weight: 400;
    font-size: 0.95em;
  }
  .lbl:hover:not(:disabled) {
    color: var(--oc-error);
    background: var(--oc-hover);
  }
  .lbl:disabled {
    cursor: default;
    opacity: 0.7;
  }
</style>
