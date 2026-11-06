<script lang="ts">
  import { backgroundSummary, type Worker } from "../../core/workers"
  import { displayName } from "../../core/names"
  import { plural } from "../../core/format"
  import { useStore } from "../context"
  import Codicon from "./Codicon.svelte"

  /**
   * Background work as a small chip in the header. The list opens as a floating panel over the transcript, so any
   * number of workers never takes space from the conversation. The panel is positioned against the header
   * (`.switcher` is `position: relative`), full width under it.
   */
  let { workers, shells }: { workers: Worker[]; shells: number } = $props()
  const store = useStore()
  let open = $state(false)
  let root: HTMLElement | undefined = $state()
  let panel: HTMLElement | undefined = $state()

  const summary = $derived(backgroundSummary(workers, shells))
  const parts = $derived(
    [summary.workers ? plural(summary.workers, "worker") : "", summary.shells ? plural(summary.shells, "shell") : ""].filter(Boolean).join(", "),
  )
  const tip = $derived(`Background: ${parts}${summary.running ? `, ${summary.running} running` : ""}`)
  const label = (s: Worker["status"]) => (s === "running" ? "Running" : s === "done" ? "Done" : s === "failed" ? "Failed" : "Stopped")

  function outside(e: PointerEvent) {
    const t = e.target as Node | null
    if (open && t && !root?.contains(t) && !panel?.contains(t)) open = false
  }
  function key(e: KeyboardEvent) {
    if (open && e.key === "Escape") { open = false; e.preventDefault() }
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<span class="chipwrap" bind:this={root}>
  <button class="chip muted" class:on={open} class:live={summary.running > 0} onclick={() => (open = !open)} aria-expanded={open} aria-haspopup="true" title={tip} aria-label={tip}>
    {#if summary.running > 0}<Codicon name="loading" spin />{:else if summary.workers}<Codicon name="robot" />{:else}<Codicon name="terminal" />{/if}
    <span>{summary.running > 0 ? `${summary.running}/${summary.workers || summary.shells}` : summary.workers || summary.shells}</span>
  </button>
</span>
{#if open}
  <div class="panel" bind:this={panel} role="dialog" aria-label="Background work">
    <div class="head muted small">Background · {parts}{#if summary.running > 0}<span class="run">&nbsp;· {summary.running} running</span>{/if}</div>
    <ul class="scroll">
      {#each workers as w (w.key)}
        <li>
          <button class="w" disabled={!w.sessionID} title={w.sessionID ? "Open this worker in a tab" : "Waiting for the worker session"} onclick={() => { if (w.sessionID) { open = false; store.bridge.openSession(w.sessionID, { readOnly: true }) } }}>
            <Codicon name="robot" />
            <span class="a">{displayName(w.agent)}</span>
            <span class="d muted">{w.description}</span>
            {#if w.calls > 1}<span class="n muted" title="{w.calls} calls to this worker">×{w.calls}</span>{/if}
            <span class="s" class:ok={w.status === "done"} class:bad={w.status === "failed"} class:muted={w.status === "running" || w.status === "stopped"}>{label(w.status)}</span>
          </button>
        </li>
      {/each}
      {#if shells > 0}<li class="muted small pad">{plural(shells, "shell")} running. Their output opens in a terminal.</li>{/if}
    </ul>
  </div>
{/if}

<style>
  .chipwrap { display: inline-flex; flex: none; }
  .chip { display: inline-flex; align-items: center; gap: 0.3em; padding: 0.15em 0.4em; border-radius: 10px; border: 1px solid var(--oc-hairline); font-size: 0.9em; font-variant-numeric: tabular-nums; }
  .chip:hover, .chip.on { color: var(--oc-fg); background: var(--oc-hover); }
  .chip.live { color: var(--oc-accent); border-color: color-mix(in srgb, var(--oc-accent) 45%, transparent); }
  .panel { position: absolute; z-index: 20; left: 0.6em; right: 0.6em; top: 100%; background: var(--oc-popover); border: 1px solid var(--oc-hairline); border-radius: 6px; box-shadow: 0 4px 16px var(--vscode-widget-shadow); display: flex; flex-direction: column; max-height: 50vh; }
  .head { padding: 0.45em var(--oc-side) 0.2em; }
  .run { color: var(--oc-accent); }
  ul { list-style: none; margin: 0; padding: 0 0.3em 0.35em; overflow-y: auto; min-height: 0; }
  .w { display: flex; align-items: center; gap: 0.5em; width: 100%; min-height: 28px; padding: 0 0.4em; border-radius: 4px; text-align: left; }
  .w:hover:not(:disabled) { background: var(--oc-hover); }
  .a { font-weight: 600; white-space: nowrap; }
  .d { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { font-size: 0.9em; white-space: nowrap; }
  .s { font-size: 0.9em; white-space: nowrap; }
  .ok { color: var(--oc-ok); }
  .bad { color: var(--oc-error); }
  .pad { padding: 0.3em 0.4em; }
</style>
