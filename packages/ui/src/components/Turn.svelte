<script lang="ts">
  import type { PermissionRequest } from "@occ/core/api"
  import type { ViewSettings } from "@occ/core/protocol"
  import { changedFiles, changesLabel } from "@occ/core/diff"
  import { relativeTo } from "@occ/core/paths"
  import { allTools, foldLabel, settledTurn, splitTurn, withoutTurnError } from "@occ/core/transcript/turn"
  import type { TurnView } from "@occ/core/transcript/types"
  import { moment, turnStamp, type TimeEnv } from "@occ/core/turn-time"
  import { keepAnchored } from "../anchor"
  import CompactionNote from "./CompactionNote.svelte"
  import { useStore, useTranscript } from "../context"
  import SentFiles from "./SentFiles.svelte"
  import Codicon from "./Codicon.svelte"
  import Markdown from "./Markdown.svelte"
  import StepList from "./StepList.svelte"

  let { turn: raw, last, firstOfDay, cwd, settings, permissions }: { turn: TurnView; last: boolean; firstOfDay: boolean; cwd: string; settings: ViewSettings; permissions: Map<string, PermissionRequest> } = $props()
  const store = useStore()
  const view = useTranscript()

  // A turn that is over but never got an execution marker (history, a lost event) still folds and shows its time.
  const turn = $derived(settledTurn(raw, { last, running: view.running() }))
  const env = (): TimeEnv => ({ now: Date.now(), locale: typeof navigator === "undefined" ? undefined : navigator.language })

  const finished = $derived(!!turn.outcome)
  const split = $derived(finished ? splitTurn(turn) : { work: turn.steps, answer: undefined })
  const label = $derived(finished ? foldLabel(turn, split.work) : "")
  // The turn's error line already says it; a step that failed with the same text does not repeat it.
  const workSteps = $derived(turn.outcome === "failed" ? withoutTurnError(split.work, turn.error) : split.work)
  const folded = $derived(finished && settings.collapseCompletedSteps && label !== "")
  let userOpen = $state<boolean | undefined>(undefined)
  let foldButton: HTMLElement | undefined = $state()
  // Files the turn changed (finished turns only), for the `Changes (N files)` link next to the fold line.
  const changes = $derived(finished ? changedFiles(allTools(turn), (f) => relativeTo(f, cwd)) : [])
  const showWork = $derived(!folded || userOpen === true)
  // A pending permission must stay visible even inside a folded turn.
  const needsAttention = $derived(turn.steps.some((s) => s.items.some((i) => i.kind === "tool" && permissions.has(i.id))))
  const expanded = $derived(showWork || needsAttention)

  // `2:41 PM · 42s` after a finished turn. A running turn shows nothing.
  const stamp = $derived(turn.compaction ? undefined : turnStamp(turn, env()))
  // The prompt's own time: above the bubble, on hover (always for the first prompt of a day).
  const promptTime = $derived(moment(turn.user?.created ?? turn.started, env()))

  const canRevert = $derived(view.features().revert && !view.readOnly() && !!turn.user)
  const running = $derived(view.running())
</script>

<section class="turn" class:compaction={!!turn.compaction}>
  {#if turn.compaction}<CompactionNote compaction={turn.compaction} />{/if}

  {#if turn.user}
    <div class="uwrap">
      {#if promptTime}<div class="utime muted" class:always={firstOfDay} title={promptTime.title}>{promptTime.text}</div>{/if}
      <div class="user" data-prompt={turn.user.id}>
        {#if canRevert}
          <button
            class="revert"
            disabled={running}
            title={running ? "Stop the session first" : "Revert to here"}
            aria-label={running ? "Revert to here (stop the session first)" : "Revert to here"}
            onclick={() => store.bridge.confirmRevert(turn.user!.id)}
          ><Codicon name="discard" /></button>
        {/if}
        {#if turn.user.text}<div class="text">{turn.user.text}</div>{/if}
        {#if turn.user.files?.length}<SentFiles files={turn.user.files} />{/if}
      </div>
    </div>
  {/if}

  {#if turn.compacted}<CompactionNote compaction={turn.compacted} />{/if}

  {#if folded || changes.length > 0}
    <div class="foldrow">
      {#if folded}
        <button class="fold muted" bind:this={foldButton} onclick={() => keepAnchored(foldButton ?? null, () => (userOpen = !(userOpen ?? needsAttention)))} aria-expanded={expanded}>
          <Codicon name={expanded ? "chevron-down" : "chevron-right"} /> {label}
        </button>
      {/if}
      {#if changes.length > 0}
        <button class="link changes" onclick={() => store.bridge.openChanges(changes.map((c) => ({ file: c.file, patches: c.patches })), `OpenCode changes (${changes.length} ${changes.length === 1 ? "file" : "files"})`)} title="Open every file this turn changed in one diff view">
          <Codicon name="diff-multiple" /> {changesLabel(changes.length)}
        </button>
      {/if}
    </div>
  {/if}
  {#if expanded && split.work.length > 0}
    <StepList steps={workSteps} {cwd} {settings} {permissions} />
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
  /* The prompt is a bubble that leans right: indented by 15% (at least 32px) while the agent uses the full width. */
  .uwrap { margin-left: max(32px, 15%); margin-bottom: 4px; }
  .utime { text-align: right; font-size: 0.85em; line-height: 1.4; margin: 0 2px 2px; opacity: 0; transition: opacity 0.12s; }
  .uwrap:hover .utime, .uwrap:focus-within .utime, .utime.always { opacity: 1; }
  .user { position: relative; padding: 10px 14px; border: 1px solid var(--oc-user-line); background: var(--oc-user-bg); border-radius: 8px; }
  .text { white-space: pre-wrap; word-break: break-word; }
  /* On the bubble's top-left corner, only on hover. */
  .revert { position: absolute; top: -10px; left: -10px; display: inline-flex; align-items: center; padding: 0.15em 0.3em; border-radius: 50%; color: var(--oc-muted); background: var(--oc-popover); border: 1px solid var(--oc-hairline); opacity: 0; }
  .user:hover .revert, .revert:focus-visible { opacity: 1; }
  .revert:hover:not(:disabled) { color: var(--oc-fg); background: var(--oc-hover); }
  .foldrow { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2em 1.2em; }
  .changes { display: inline-flex; align-items: center; gap: 0.35em; }
  .fold { align-self: flex-start; display: inline-flex; align-items: center; gap: 0.35em; }
  .fold:hover { color: var(--oc-fg); }
  .answer { margin-top: 0.2em; }
  .stamp { margin-top: -0.1em; }
  /* About 12px between the bubble and the agent's part (the 4px margin plus the 0.5em gap). */
  .uwrap + :global(*) { margin-top: 0.4em; }
</style>
