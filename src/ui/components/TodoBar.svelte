<script lang="ts">
  import type { TodoSummary } from "../../core/todo"
  import Codicon from "./Codicon.svelte"

  let { summary, defaultExpanded }: { summary: TodoSummary; defaultExpanded: boolean } = $props()
  let userOpen = $state<boolean | undefined>(undefined)
  const open = $derived(userOpen ?? defaultExpanded)

  const R = 6
  const C = 2 * Math.PI * R
</script>

<div class="todo">
  {#if open}
    <div class="panel" role="region" aria-label="Tasks">
      <div class="head"><span>Tasks {summary.done} / {summary.total}</span></div>
      <div class="bar"><div class="fill" style:width="{summary.progress * 100}%"></div></div>
      <ul>
        {#each summary.items as t, i (i)}
          <li class:done={t.status === "completed" || t.status === "cancelled"} class:cur={t.status === "in_progress"}>
            <span class="ico" aria-hidden="true">{t.status === "completed" ? "✓" : t.status === "in_progress" ? "◐" : t.status === "cancelled" ? "–" : "○"}</span>
            <span class="txt">{t.content}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <button class="line" onclick={() => (userOpen = !open)} aria-expanded={open}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={R} fill="none" stroke="var(--oc-hairline)" stroke-width="2" />
      <circle cx="8" cy="8" r={R} fill="none" stroke="var(--oc-accent)" stroke-width="2" stroke-dasharray="{C * summary.progress} {C}" transform="rotate(-90 8 8)" />
    </svg>
    <span class="muted">{summary.done} of {summary.total}{summary.current ? " · " : ""}</span>
    <span class="cur-text">{summary.current ?? ""}</span>
    <span class="chev muted"><Codicon name={open ? "chevron-down" : "chevron-up"} /></span>
  </button>
</div>

<style>
  .todo { padding: 0 var(--oc-side) 0.3em; }
  .line { display: flex; align-items: center; gap: 0.5em; width: 100%; text-align: left; min-width: 0; }
  .cur-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel { border: 1px solid var(--oc-hairline); border-radius: 6px; padding: 0.5em 0.7em; margin-bottom: 0.35em; background: var(--oc-popover); }
  .head { font-weight: 600; margin-bottom: 0.35em; }
  .bar { height: 2px; background: var(--oc-hairline); border-radius: 1px; margin-bottom: 0.45em; }
  .fill { height: 100%; background: var(--oc-accent); border-radius: 1px; }
  ul { list-style: none; margin: 0; padding: 0; max-height: 14em; overflow-y: auto; }
  li { display: flex; gap: 0.55em; padding: 0.1em 0; }
  li.done { color: var(--oc-muted); }
  li.done .txt { text-decoration: line-through; }
  li.cur { color: var(--oc-accent); }
  .ico { width: 1em; text-align: center; flex: none; }
</style>
