<script lang="ts">
  import { backgroundSummary, type Worker } from "../../core/workers"
  import { displayName } from "../../core/names"
  import { plural } from "../../core/format"
  import { useStore } from "../context"
  import Codicon from "./Codicon.svelte"

  let { workers, shells }: { workers: Worker[]; shells: number } = $props()
  const store = useStore()
  let open = $state(false)

  const summary = $derived(backgroundSummary(workers, shells))
  const parts = $derived(
    [summary.workers ? plural(summary.workers, "worker") : "", summary.shells ? plural(summary.shells, "shell") : ""].filter(Boolean).join(", "),
  )
  const label = (s: Worker["status"]) => (s === "running" ? "Running" : s === "done" ? "Done" : s === "failed" ? "Failed" : "Stopped")
</script>

<div class="bg">
  <button class="head muted" onclick={() => (open = !open)} aria-expanded={open}>
    <Codicon name={open ? "chevron-down" : "chevron-right"} />
    <span>Background · {parts}</span>
    {#if summary.running > 0}<span class="live"><Codicon name="loading" spin /> {summary.running} running</span>{/if}
  </button>
  {#if open}
    <ul>
      {#each workers as w, i (w.sessionID ?? w.toolID ?? i)}
        <li>
          <button class="w" disabled={!w.sessionID} title={w.sessionID ? "Open this worker in a tab" : "Waiting for the worker session"} onclick={() => w.sessionID && store.bridge.openSession(w.sessionID, { readOnly: true })}>
            <Codicon name="robot" />
            <span class="a">{displayName(w.agent)}</span>
            <span class="d muted">{w.description}</span>
            <span class="s" class:ok={w.status === "done"} class:bad={w.status === "failed"} class:muted={w.status === "running" || w.status === "stopped"}>{label(w.status)}</span>
          </button>
        </li>
      {/each}
      {#if workers.length === 0}<li class="muted small pad">{plural(shells, "shell")} running. Their output opens in a terminal.</li>{/if}
    </ul>
  {/if}
</div>

<style>
  .bg { border-bottom: 1px solid var(--oc-hairline); padding: 0 var(--oc-side); }
  .head { display: flex; align-items: center; gap: 0.4em; min-height: 28px; width: 100%; text-align: left; }
  .head:hover { color: var(--oc-fg); }
  .live { margin-left: auto; display: inline-flex; align-items: center; gap: 0.3em; color: var(--oc-accent); }
  ul { list-style: none; margin: 0 0 0.4em; padding: 0; max-height: 14em; overflow-y: auto; }
  .w { display: flex; align-items: center; gap: 0.5em; width: 100%; min-height: 28px; padding: 0 0.3em; border-radius: 4px; text-align: left; }
  .w:hover:not(:disabled) { background: var(--oc-hover); }
  .a { font-weight: 600; }
  .d { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s { font-size: 0.9em; white-space: nowrap; }
  .ok { color: var(--oc-ok); }
  .bad { color: var(--oc-error); }
  .pad { padding: 0.3em; }
</style>
