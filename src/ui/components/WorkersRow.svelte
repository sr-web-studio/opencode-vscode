<script lang="ts">
  import { tick } from "svelte"
  import type { SlimModel } from "../../core/api"
  import { backgroundSummary, modelLabel, modelTitle, quietLabel, type Worker } from "../../core/workers"
  import { clearable, visibleWorkers } from "../../core/worker-hidden"
  import { displayName } from "../../core/names"
  import { plural } from "../../core/format"
  import { focusOpened } from "../focus"
  import { useStore } from "../context"
  import Codicon from "./Codicon.svelte"
  import StopWorkerButton from "./StopWorkerButton.svelte"

  /**
   * Background work as a small chip in the header. The list opens as a floating panel over the transcript, so any
   * number of workers never takes space from the conversation. The panel is positioned against the header
   * (`.switcher` is `position: relative`), full width under it. Finished workers can be removed from the list: that
   * only hides the row here, the session stays on the OpenCode server.
   */
  let { workers: all, hidden, models, shells }: { workers: Worker[]; hidden: string[]; models: SlimModel[]; shells: number } = $props()
  const store = useStore()
  let open = $state(false)
  let root: HTMLElement | undefined = $state()
  let panel: HTMLElement | undefined = $state()
  let head: HTMLElement | undefined = $state()
  /** After a removal: which keys must be gone, and where focus goes once they are. `next` undefined: the panel head. */
  let pending: { removed: string[]; next?: string } | undefined

  const workers = $derived(visibleWorkers(all, hidden))
  const finished = $derived(clearable(workers))
  const summary = $derived(backgroundSummary(workers, shells))
  const parts = $derived(
    [summary.workers ? plural(summary.workers, "worker") : "", summary.shells ? plural(summary.shells, "shell") : ""].filter(Boolean).join(", "),
  )
  const tip = $derived(`Background: ${parts}${summary.running ? `, ${summary.running} running` : ""}`)
  const label = (s: Worker["status"]) => (s === "running" ? "Running" : s === "done" ? "Done" : s === "failed" ? "Failed" : "Stopped")

  /** The clock for "quiet 3m": it only ticks while the panel is open. */
  let now = $state(Date.now())
  $effect(() => {
    if (!open) return
    now = Date.now()
    const t = setInterval(() => (now = Date.now()), 15_000)
    return () => clearInterval(t)
  })

  function outside(e: PointerEvent) {
    const t = e.target as Node | null
    if (open && t && !root?.contains(t) && !panel?.contains(t)) open = false
  }
  function key(e: KeyboardEvent) {
    if (open && e.key === "Escape") { open = false; e.preventDefault() }
  }

  /** Remove rows. Focus moves to the next row (else the previous one, else the panel head) when the new list arrives. */
  function remove(keys: string[], at: number) {
    const after = workers.filter((w) => !keys.includes(w.key))
    const rest = workers.slice(at + 1).find((w) => !keys.includes(w.key)) ?? [...workers.slice(0, at)].reverse().find((w) => !keys.includes(w.key))
    pending = { removed: keys, next: keys.length > 1 || !after.length ? undefined : rest?.key }
    store.dispatch({ type: "hideWorkers", keys })
  }

  $effect(() => {
    const present = new Set(workers.map((w) => w.key))
    const p = pending
    if (!p || p.removed.some((k) => present.has(k))) return
    pending = undefined
    void tick().then(() =>
      focusOpened(() => {
        const row = p.next ? [...(panel?.querySelectorAll<HTMLElement>("li[data-key]") ?? [])].find((li) => li.dataset.key === p.next) : undefined
        return row?.querySelector<HTMLElement>("button:not(:disabled)") ?? head
      }),
    )
  })
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
    <div class="headrow">
      <div class="head muted small" bind:this={head} tabindex="-1">Background · {parts}{#if summary.running > 0}<span class="run">&nbsp;· {summary.running} running</span>{/if}</div>
      {#if finished.length > 0}
        <button class="clear muted small" onclick={() => remove(finished.map((w) => w.key), 0)} title="Remove finished workers from this list. The sessions stay in OpenCode.">Clear done</button>
      {/if}
    </div>
    <ul class="scroll">
      {#each workers as w, i (w.key)}
        {@const model = modelLabel(w.model, models, { short: true })}
        {@const quiet = quietLabel(w, now)}
        <li class="row" data-key={w.key}>
          <button class="w" disabled={!w.sessionID} title={w.sessionID ? `Open this worker in a tab${w.model ? ` · ${modelTitle(w.model)}` : ""}` : "Waiting for the worker session"} onclick={() => { if (w.sessionID) { open = false; store.bridge.openSession(w.sessionID, { readOnly: true }) } }}>
            <Codicon name="robot" />
            <span class="a">{displayName(w.agent)}</span>
            {#if model}<span class="m muted">· {model}</span>{/if}
            <span class="d muted">{w.description}</span>
            {#if w.calls > 1}<span class="n muted" title="{w.calls} calls to this worker">×{w.calls}</span>{/if}
            <span class="s" class:ok={w.status === "done"} class:bad={w.status === "failed"} class:muted={w.status === "running" || w.status === "stopped"}>{label(w.status)}</span>
            {#if quiet}<span class="q muted" title="No activity from this worker for {quiet.slice(6)}">· {quiet}</span>{/if}
          </button>
          {#if w.status !== "running"}
            <button class="x muted" onclick={() => remove([w.key], i)} aria-label="Remove from list" title="Remove from list (the session stays in OpenCode)"><Codicon name="close" /></button>
          {:else if w.sessionID}
            <StopWorkerButton sessionID={w.sessionID} running reveal />
          {:else}
            <span class="x spacer" aria-hidden="true"></span>
          {/if}
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
  .headrow { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; padding-right: 0.4em; }
  .head { padding: 0.45em var(--oc-side) 0.2em; min-width: 0; }
  .head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .clear { flex: none; padding: 0.15em 0.5em; margin-top: 0.25em; border-radius: 4px; }
  .clear:hover { color: var(--oc-fg); background: var(--oc-hover); }
  .run { color: var(--oc-accent); }
  ul { list-style: none; margin: 0; padding: 0 0.3em 0.35em; overflow-y: auto; min-height: 0; }
  .row { display: flex; align-items: center; border-radius: 4px; }
  .row:hover:has(.w:not(:disabled)) { background: var(--oc-hover); }
  .w { display: flex; align-items: center; gap: 0.5em; flex: 1 1 0; min-width: 0; min-height: 28px; padding: 0 0.4em; border-radius: 4px; text-align: left; }
  .a { font-weight: 600; white-space: nowrap; }
  .m { flex: 0 1 auto; min-width: 0; max-width: 11em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em; margin-left: -0.2em; }
  .d { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { font-size: 0.9em; white-space: nowrap; }
  .s, .q { font-size: 0.9em; white-space: nowrap; }
  .q { margin-left: -0.25em; }
  .x { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; min-height: 24px; border-radius: 4px; opacity: 0; }
  .x.spacer { pointer-events: none; }
  .row:hover .x, .row:focus-within .x { opacity: 1; }
  .x:hover:not(.spacer) { color: var(--oc-fg); background: var(--oc-hover); }
  @media (hover: none) { .x { opacity: 1; } .x.spacer { opacity: 0; } }
  .ok { color: var(--oc-ok); }
  .bad { color: var(--oc-error); }
  .pad { padding: 0.3em 0.4em; }
</style>
