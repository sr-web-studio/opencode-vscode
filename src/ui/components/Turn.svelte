<script lang="ts">
  import type { PermissionRequest } from "../../core/api"
  import type { ViewSettings } from "../../core/protocol"
  import { foldLabel, splitTurn } from "../../core/transcript/turn"
  import type { TurnView } from "../../core/transcript/types"
  import Markdown from "./Markdown.svelte"
  import StepList from "./StepList.svelte"

  let { turn, cwd, settings, permissions }: { turn: TurnView; cwd: string; settings: ViewSettings; permissions: Map<string, PermissionRequest> } = $props()

  const finished = $derived(!!turn.outcome)
  const split = $derived(finished ? splitTurn(turn) : { work: turn.steps, answer: undefined })
  const label = $derived(finished ? foldLabel(turn, split.work) : "")
  const folded = $derived(finished && settings.collapseCompletedSteps && label !== "")
  let userOpen = $state<boolean | undefined>(undefined)
  const showWork = $derived(!folded || userOpen === true)
  // A pending permission must stay visible even inside a folded turn.
  const needsAttention = $derived(turn.steps.some((s) => s.items.some((i) => i.kind === "tool" && permissions.has(i.id))))
</script>

<section class="turn">
  {#if turn.user}
    <div class="user">{turn.user.text}</div>
  {/if}

  {#if folded}
    <button class="fold muted" onclick={() => (userOpen = !(userOpen ?? needsAttention))} aria-expanded={showWork || needsAttention}>
      <span class="chev">{showWork || needsAttention ? "⌄" : "›"}</span> {label}
    </button>
  {/if}
  {#if (showWork || needsAttention) && split.work.length > 0}
    <StepList steps={split.work} {cwd} {settings} {permissions} />
  {/if}

  {#if split.answer}
    <div class="answer"><Markdown text={split.answer.text} /></div>
  {/if}
  {#if turn.outcome === "failed" && turn.error}<div class="err">{turn.error}</div>{/if}
  {#if turn.outcome === "interrupted"}<div class="muted small">Stopped</div>{/if}
</section>

<style>
  .turn { display: flex; flex-direction: column; gap: 0.5em; margin-bottom: 1.1em; }
  .user { align-self: flex-start; max-width: 100%; background: var(--oc-bubble); border-radius: 8px; padding: 0.45em 0.8em; white-space: pre-wrap; word-break: break-word; }
  .fold { align-self: flex-start; }
  .fold:hover { color: var(--oc-fg); }
  .answer { margin-top: 0.2em; }
  .small { font-size: 0.9em; }
</style>
