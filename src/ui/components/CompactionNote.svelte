<script lang="ts">
  import { moment, type TimeEnv } from "../../core/turn-time"
  import type { CompactionView } from "../../core/transcript/types"
  import { keepAnchored } from "../anchor"
  import Codicon from "./Codicon.svelte"
  import Markdown from "./Markdown.svelte"

  /** The muted "Context compacted" line, collapsed by default; opening it shows the summary. */
  let { compaction }: { compaction: CompactionView } = $props()
  let open = $state(false)
  let button: HTMLElement | undefined = $state()
  const env = (): TimeEnv => ({ now: Date.now(), locale: typeof navigator === "undefined" ? undefined : navigator.language })
  const at = $derived(compaction.created ? moment(compaction.created, env()) : undefined)
</script>

<button class="compact muted" onclick={() => keepAnchored(button ?? null, () => (open = !open))} bind:this={button} aria-expanded={open} title={at?.title}>
  <Codicon name={open ? "chevron-down" : "chevron-right"} />
  <Codicon name="layers" />
  Context compacted{at ? ` · ${at.text}` : ""}
</button>
{#if open}
  <div class="summary"><Markdown text={compaction.summary || "No summary was recorded."} /></div>
{/if}

<style>
  .compact { align-self: flex-start; display: inline-flex; align-items: center; gap: 0.35em; }
  .compact:hover { color: var(--oc-fg); }
  .summary { margin-left: 1.4em; padding: 0.2em 0.8em; border-left: 2px solid var(--oc-hairline); }
</style>
