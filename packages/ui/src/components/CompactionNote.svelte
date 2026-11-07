<script lang="ts">
  import { formatDuration } from "@occ/core/format"
  import { moment, type TimeEnv } from "@occ/core/turn-time"
  import type { CompactionView } from "@occ/core/transcript/types"
  import { keepAnchored } from "../anchor"
  import Codicon from "./Codicon.svelte"
  import Markdown from "./Markdown.svelte"

  /**
   * The muted compaction line. Done: "Context compacted", collapsed, opening it shows the summary. In progress:
   * a spinner and "Compacting conversation…" with the time so far; the summary being written folds open like "Thinking".
   * Failed or stopped: one short line.
   */
  let { compaction }: { compaction: CompactionView } = $props()
  let open = $state(false)
  let button: HTMLElement | undefined = $state()
  const env = (): TimeEnv => ({ now: Date.now(), locale: typeof navigator === "undefined" ? undefined : navigator.language })
  const at = $derived(compaction.created ? moment(compaction.created, env()) : undefined)

  const running = $derived(compaction.status === "running")
  const failed = $derived(compaction.status === "failed")
  const cancelled = $derived(compaction.status === "cancelled")

  // Elapsed time of a pending compaction, ticking once a second (the clock of a remote server may differ a little: never negative).
  let now = $state(Date.now())
  $effect(() => {
    if (!running) return
    now = Date.now()
    const timer = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(timer)
  })
  const elapsed = $derived(running && compaction.created ? formatDuration(Math.max(0, now - compaction.created)) : undefined)
  const written = $derived(compaction.summary.trim())
</script>

{#if running}
  <div class="compact-run muted" role="status">
    <button class="compact muted" bind:this={button} onclick={() => keepAnchored(button ?? null, () => (open = !open))} aria-expanded={written ? open : undefined} disabled={!written} title={written ? "Show the summary as it is written" : undefined}>
      {#if written}<Codicon name={open ? "chevron-down" : "chevron-right"} />{/if}
      <Codicon name="loading" spin />
      <span>Compacting conversation…{elapsed ? ` · ${elapsed}` : ""}</span>
    </button>
    {#if open && written}<div class="body">{written}</div>{/if}
  </div>
{:else if failed || cancelled}
  <div class="compact-end" class:err={failed} class:muted={cancelled} role="status">
    <Codicon name={failed ? "warning" : "layers"} />
    <span>{failed ? `Compaction failed${compaction.error ? `: ${compaction.error}` : ""}` : "Compaction cancelled"}</span>
  </div>
{:else}
  <button class="compact muted" onclick={() => keepAnchored(button ?? null, () => (open = !open))} bind:this={button} aria-expanded={open} title={at?.title}>
    <Codicon name={open ? "chevron-down" : "chevron-right"} />
    <Codicon name="layers" />
    Context compacted{at ? ` · ${at.text}` : ""}
  </button>
  {#if open}
    <div class="summary"><Markdown text={compaction.summary || "No summary was recorded."} /></div>
  {/if}
{/if}

<style>
  .compact { align-self: flex-start; display: inline-flex; align-items: center; gap: 0.35em; max-width: 100%; min-width: 0; }
  .compact:hover:not(:disabled) { color: var(--oc-fg); }
  .compact:disabled { cursor: default; opacity: 1; }
  .compact span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .compact-run { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
  .compact-end { align-self: flex-start; display: flex; align-items: flex-start; gap: 0.35em; min-width: 0; overflow-wrap: anywhere; }
  .summary { margin-left: 1.4em; padding: 0.2em 0.8em; border-left: 2px solid var(--oc-hairline); }
  /* The summary as it streams in: plain text like the reasoning, capped so a long one does not push the page down. */
  .body { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 16em; overflow-y: auto; margin: 0.2em 0 0.2em 1.4em; padding: 0.2em 0.8em; border-left: 2px solid var(--oc-hairline); font-style: italic; width: calc(100% - 1.4em); box-sizing: border-box; }
</style>
