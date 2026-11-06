<script lang="ts">
  import type { PermissionRequest } from "../../core/api"
  import type { ViewSettings } from "../../core/protocol"
  import { foldLabel, splitTurn } from "../../core/transcript/turn"
  import type { TurnView } from "../../core/transcript/types"
  import { turnStamp } from "../../core/turn-time"
  import { keepAnchored } from "../anchor"
  import { useStore, useTranscript } from "../context"
  import Chip from "./Chip.svelte"
  import Codicon from "./Codicon.svelte"
  import Markdown from "./Markdown.svelte"
  import StepList from "./StepList.svelte"

  let { turn, cwd, settings, permissions }: { turn: TurnView; cwd: string; settings: ViewSettings; permissions: Map<string, PermissionRequest> } = $props()
  const store = useStore()
  const view = useTranscript()

  const finished = $derived(!!turn.outcome)
  const split = $derived(finished ? splitTurn(turn) : { work: turn.steps, answer: undefined })
  const label = $derived(finished ? foldLabel(turn, split.work) : "")
  const folded = $derived(finished && settings.collapseCompletedSteps && label !== "")
  let userOpen = $state<boolean | undefined>(undefined)
  let compactOpen = $state(false)
  let foldButton: HTMLElement | undefined = $state()
  let compactButton: HTMLElement | undefined = $state()
  const showWork = $derived(!folded || userOpen === true)
  // A pending permission must stay visible even inside a folded turn.
  const needsAttention = $derived(turn.steps.some((s) => s.items.some((i) => i.kind === "tool" && permissions.has(i.id))))
  const expanded = $derived(showWork || needsAttention)

  // `2:41 PM · 42s` after a finished turn. A running turn shows nothing.
  const stamp = $derived(turn.compaction ? undefined : turnStamp(turn, { now: Date.now(), locale: typeof navigator === "undefined" ? undefined : navigator.language }))
  const compactedAt = $derived(turn.compaction?.created ? turnStamp({ ended: turn.compaction.created, outcome: "succeeded" }, { now: Date.now(), locale: typeof navigator === "undefined" ? undefined : navigator.language }) : undefined)

  const canRevert = $derived(view.features().revert && !view.readOnly() && !!turn.user)
  const running = $derived(view.running())
</script>

<section class="turn" class:compaction={!!turn.compaction}>
  {#if turn.compaction}
    <button class="compact muted" onclick={() => keepAnchored(compactButton ?? null, () => (compactOpen = !compactOpen))} bind:this={compactButton} aria-expanded={compactOpen} title={compactedAt?.title}>
      <Codicon name={compactOpen ? "chevron-down" : "chevron-right"} />
      <Codicon name="layers" />
      Context compacted{compactedAt ? ` · ${compactedAt.text.split(" · ")[0]}` : ""}
    </button>
    {#if compactOpen}
      <div class="summary"><Markdown text={turn.compaction.summary || "No summary was recorded."} /></div>
    {/if}
  {/if}

  {#if turn.user}
    <div class="user">
      <div class="body">
        {#if turn.user.text}<div class="text">{turn.user.text}</div>{/if}
        {#if turn.user.files?.length}
          <div class="chips">{#each turn.user.files as f, i (i)}<Chip name={f.name} mime={f.mime} />{/each}</div>
        {/if}
      </div>
      {#if canRevert}
        <button
          class="revert"
          disabled={running}
          title={running ? "Stop the session first" : "Revert to here"}
          aria-label={running ? "Revert to here (stop the session first)" : "Revert to here"}
          onclick={() => store.bridge.confirmRevert(turn.user!.id)}
        ><Codicon name="discard" /></button>
      {/if}
    </div>
  {/if}

  {#if folded}
    <button class="fold muted" bind:this={foldButton} onclick={() => keepAnchored(foldButton ?? null, () => (userOpen = !(userOpen ?? needsAttention)))} aria-expanded={expanded}>
      <Codicon name={expanded ? "chevron-down" : "chevron-right"} /> {label}
    </button>
  {/if}
  {#if expanded && split.work.length > 0}
    <StepList steps={split.work} {cwd} {settings} {permissions} />
  {/if}

  {#if split.answer}
    <div class="answer"><Markdown text={split.answer.text} /></div>
  {/if}
  {#if turn.outcome === "failed" && turn.error}<div class="err">{turn.error}</div>{/if}
  {#if turn.outcome === "interrupted"}<div class="muted small">Stopped</div>{/if}
  {#if stamp}<div class="stamp muted small" title={stamp.title}>{stamp.text}</div>{/if}
</section>

<style>
  .turn { display: flex; flex-direction: column; gap: 0.5em; margin-bottom: var(--oc-turn-gap); }
  .turn.compaction { gap: 0.2em; }
  .user { position: relative; align-self: stretch; padding: 8px 12px; border-left: 2px solid var(--oc-user-border); background: var(--oc-user-bg); border-radius: 6px; display: flex; gap: 0.5em; align-items: flex-start; }
  .body { flex: 1; min-width: 0; }
  .text { white-space: pre-wrap; word-break: break-word; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.5em; }
  .revert { flex: none; display: inline-flex; align-items: center; padding: 0.15em 0.3em; border-radius: 4px; color: var(--oc-muted); opacity: 0; }
  .user:hover .revert, .revert:focus-visible { opacity: 1; }
  .revert:hover:not(:disabled) { color: var(--oc-fg); background: var(--oc-hover); }
  .fold, .compact { align-self: flex-start; display: inline-flex; align-items: center; gap: 0.35em; }
  .fold:hover, .compact:hover { color: var(--oc-fg); }
  .summary { margin-left: 1.4em; padding: 0.2em 0.8em; border-left: 2px solid var(--oc-hairline); }
  .answer { margin-top: 0.2em; }
  .stamp { margin-top: -0.1em; }
</style>
