<script lang="ts">
  import type { PermissionRequest } from "../../core/api"
  import type { ViewSettings } from "../../core/protocol"
  import { foldLabel, settledTurn, splitTurn } from "../../core/transcript/turn"
  import type { TurnView } from "../../core/transcript/types"
  import { moment, turnStamp, type TimeEnv } from "../../core/turn-time"
  import { keepAnchored } from "../anchor"
  import { useStore, useTranscript } from "../context"
  import Chip from "./Chip.svelte"
  import Codicon from "./Codicon.svelte"
  import Markdown from "./Markdown.svelte"
  import StepList from "./StepList.svelte"

  let { turn: raw, last, cwd, settings, permissions }: { turn: TurnView; last: boolean; cwd: string; settings: ViewSettings; permissions: Map<string, PermissionRequest> } = $props()
  const store = useStore()
  const view = useTranscript()

  // A turn that is over but never got an execution marker (history, a lost event) still folds and shows its time.
  const turn = $derived(settledTurn(raw, { last, running: view.running() }))
  const env = (): TimeEnv => ({ now: Date.now(), locale: typeof navigator === "undefined" ? undefined : navigator.language })

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
  const stamp = $derived(turn.compaction ? undefined : turnStamp(turn, env()))
  const compactedAt = $derived(turn.compaction?.created ? moment(turn.compaction.created, env()) : undefined)
  // The prompt's own time, in the card header.
  const promptTime = $derived(moment(turn.user?.created ?? turn.started, env()))

  const canRevert = $derived(view.features().revert && !view.readOnly() && !!turn.user)
  const running = $derived(view.running())
</script>

<section class="turn" class:compaction={!!turn.compaction}>
  {#if turn.compaction}
    <button class="compact muted" onclick={() => keepAnchored(compactButton ?? null, () => (compactOpen = !compactOpen))} bind:this={compactButton} aria-expanded={compactOpen} title={compactedAt?.title}>
      <Codicon name={compactOpen ? "chevron-down" : "chevron-right"} />
      <Codicon name="layers" />
      Context compacted{compactedAt ? ` · ${compactedAt.text}` : ""}
    </button>
    {#if compactOpen}
      <div class="summary"><Markdown text={turn.compaction.summary || "No summary was recorded."} /></div>
    {/if}
  {/if}

  {#if turn.user}
    <div class="user">
      <div class="uhead">
        <Codicon name="account" />
        <span class="you">You</span>
        <span class="grow"></span>
        {#if promptTime}<span class="utime muted" title={promptTime.title}>{promptTime.text}</span>{/if}
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
      {#if turn.user.text}<div class="text">{turn.user.text}</div>{/if}
      {#if turn.user.files?.length}
        <div class="chips">{#each turn.user.files as f, i (i)}<Chip name={f.name} mime={f.mime} />{/each}</div>
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
  /* Turns are ~40px apart with a hairline halfway: the divider sits in the gap, half above and half below. */
  .turn { position: relative; display: flex; flex-direction: column; gap: 0.5em; padding-bottom: calc(var(--oc-turn-gap) / 2); margin-bottom: calc(var(--oc-turn-gap) / 2); border-bottom: 1px solid var(--oc-hairline); }
  .turn:last-child { border-bottom-color: transparent; }
  .turn.compaction { gap: 0.2em; }
  /* The prompt is a card: a clear speaker change, visible in dark themes too. */
  .user { position: relative; align-self: stretch; padding: 10px 14px; border: 1px solid var(--oc-user-line); border-left: 3px solid var(--oc-user-accent); background: var(--oc-user-bg); border-radius: 6px; margin-bottom: 4px; }
  .uhead { display: flex; align-items: center; gap: 0.45em; margin-bottom: 0.35em; }
  .you { font-weight: 600; }
  .grow { flex: 1; }
  .utime { font-size: 0.9em; white-space: nowrap; }
  .text { white-space: pre-wrap; word-break: break-word; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.5em; }
  .revert { flex: none; display: inline-flex; align-items: center; padding: 0.1em 0.3em; border-radius: 4px; color: var(--oc-muted); opacity: 0; }
  .user:hover .revert, .revert:focus-visible { opacity: 1; }
  .revert:hover:not(:disabled) { color: var(--oc-fg); background: var(--oc-hover); }
  .fold, .compact { align-self: flex-start; display: inline-flex; align-items: center; gap: 0.35em; }
  .fold:hover, .compact:hover { color: var(--oc-fg); }
  .summary { margin-left: 1.4em; padding: 0.2em 0.8em; border-left: 2px solid var(--oc-hairline); }
  .answer { margin-top: 0.2em; }
  .stamp { margin-top: -0.1em; }
  /* About 12px between the card and the agent's part (the 4px margin plus the 0.5em gap). */
  .user + :global(*) { margin-top: 0.4em; }
</style>
