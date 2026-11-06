<script lang="ts">
  import { tick } from "svelte"
  import type { PermissionRequest } from "../../core/api"
  import type { AppState } from "../../core/protocol"
  import { initialScroll, scrollTopAfterPrepend, showJump, stepScroll, type ScrollEvent, type ScrollState } from "../../core/scroll"
  import { isRunning } from "../../core/transcript/reducer"
  import { hiddenTurnCount, revertBarText, visibleTurns } from "../../core/transcript/revert"
  import { contentSignature } from "../../core/transcript/signature"
  import { runningTool } from "../../core/transcript/turn"
  import { plural } from "../../core/format"
  import { useStore } from "../context"
  import Chip from "./Chip.svelte"
  import Codicon from "./Codicon.svelte"
  import PermissionPrompt from "./PermissionPrompt.svelte"
  import Turn from "./Turn.svelte"

  let { app }: { app: AppState } = $props()
  const store = useStore()

  let box: HTMLDivElement | undefined = $state()
  let scroll = $state<ScrollState>(initialScroll)
  // Scroll events caused by our own smooth scroll must not be read as "the user scrolled away".
  let smoothing = false

  const turns = $derived(visibleTurns(app.view))
  const hidden = $derived(hiddenTurnCount(app.view))
  const byTool = $derived(new Map(app.permissions.flatMap((p) => (p.source?.id ? [[p.source.id, p] as const] : []))))
  const toolIDs = $derived(new Set(app.view.turns.flatMap((t) => t.steps.flatMap((s) => s.items.flatMap((i) => (i.kind === "tool" ? [i.id] : []))))))
  // Requests that do not map to a visible tool line still need an answer.
  const orphans = $derived<PermissionRequest[]>(app.permissions.filter((p) => !p.source?.id || !toolIDs.has(p.source.id)))
  const busy = $derived(isRunning(app.view))
  const idleSpinner = $derived(busy && !runningTool(app.view.turns) && !app.view.turns.at(-1)?.steps.at(-1)?.items.some((i) => i.kind !== "tool" && i.streaming))
  const revert = $derived(app.view.revert)

  const metrics = () => ({ scrollTop: box!.scrollTop, clientHeight: box!.clientHeight, scrollHeight: box!.scrollHeight })

  function apply(event: ScrollEvent) {
    if (!box) return
    const step = stepScroll(scroll, event)
    scroll = step.state
    if (step.scrollToEnd) void tick().then(() => box && (box.scrollTop = box.scrollHeight))
  }

  function onscroll() {
    if (smoothing || !box) return
    apply({ type: "scrolled", metrics: metrics() })
  }

  function jump() {
    if (!box) return
    scroll = initialScroll
    smoothing = true
    box.scrollTo({ top: box.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
    setTimeout(() => (smoothing = false), 700)
  }

  // New content: follow only when the user is at the end. The state object is a fresh copy on every message, so the
  // effect depends on a fingerprint of what is visible, not on object identity.
  const signature = $derived(contentSignature(app.view, app.permissions.length + (idleSpinner ? 1 : 0)))
  let lastSignature = ""
  $effect(() => {
    const next = signature
    if (next === lastSignature) return
    lastSignature = next
    if (box) apply({ type: "content", metrics: metrics() })
  })

  // Sending always jumps to the end.
  const sent = $derived(app.sentTick)
  let lastSent: number | undefined
  $effect(() => {
    const next = sent
    const prev = lastSent
    lastSent = next
    if (prev !== undefined && next !== prev) apply({ type: "sent" })
  })

  // A different session starts at the end.
  const targetKey = $derived(app.target.kind === "session" ? app.target.id : "draft")
  let lastTarget: string | undefined
  $effect(() => {
    const next = targetKey
    if (next === lastTarget) return
    lastTarget = next
    apply({ type: "reset" })
  })

  // Older messages were added above: keep what the user is looking at where it is.
  let heightBefore = 0
  let topBefore = 0
  function loadEarlier() {
    if (!box) return
    heightBefore = box.scrollHeight
    topBefore = box.scrollTop
    store.dispatch({ type: "loadEarlier" })
  }
  const earlier = $derived(app.earlierTick)
  let lastEarlier = 0
  $effect(() => {
    const next = earlier
    if (next === lastEarlier) return
    lastEarlier = next
    void tick().then(() => {
      if (box && heightBefore > 0) box.scrollTop = scrollTopAfterPrepend(topBefore, heightBefore, box.scrollHeight)
      heightBefore = 0
    })
  })
</script>

<div class="wrap">
  <div class="transcript scroll" data-scroll-box bind:this={box} {onscroll}>
    {#if app.loadingView}
      <div class="muted pad">Loading…</div>
    {:else}
      {#if app.hasEarlier || app.loadingEarlier}
        <div class="earlier">
          <button class="link" disabled={app.loadingEarlier} onclick={loadEarlier}>{app.loadingEarlier ? "Loading earlier messages…" : "Show earlier messages"}</button>
        </div>
      {/if}
      {#each turns as turn, i (turn.id)}
        <Turn {turn} last={i === turns.length - 1 && !revert} cwd={app.directory} settings={app.settings} permissions={byTool} />
      {/each}
      {#if revert}
        <div class="rbar" role="status">
          <Codicon name="discard" />
          <span class="rtext">{revertBarText(revert)}{hidden > 0 ? ` · ${plural(hidden, "message group")} hidden` : ""}</span>
          {#if !app.readOnly}<button class="link redo" onclick={() => store.dispatch({ type: "redo" })}>Redo</button>{/if}
        </div>
      {:else}
        {#each app.view.queued as q (q.id)}
          <div class="queued">
            <div class="user">
              <div class="uhead"><Codicon name="account" /> You</div>
              {#if q.text}<div>{q.text}</div>{/if}
              {#if q.files?.length}<div class="chips">{#each q.files as f, i (i)}<Chip name={f.name} mime={f.mime} />{/each}</div>{/if}
            </div>
            <div class="muted small">Queued</div>
          </div>
        {/each}
        {#each orphans as p (p.id)}
          <div class="orphan">
            <span class="label">Permission</span>
            <span class="muted target">{p.action}{p.resources[0] ? `: ${p.resources[0]}` : ""}</span>
            <PermissionPrompt request={p} />
          </div>
        {/each}
        {#if idleSpinner}<div class="working muted"><span class="spinner"></span> Working…</div>{/if}
        {#if app.view.loaded && turns.length === 0 && app.view.queued.length === 0}
          <div class="muted pad">No messages yet.</div>
        {/if}
      {/if}
    {/if}
  </div>

  {#if showJump(scroll) && !app.loadingView}
    <button class="jump" onclick={jump} title={scroll.unseen ? "New content below. Jump to the end" : "Jump to the end"} aria-label={scroll.unseen ? "Jump to the end (new content)" : "Jump to the end"}>
      <Codicon name="arrow-down" />
      {#if scroll.unseen}<span class="new" aria-hidden="true"></span>{/if}
    </button>
  {/if}
</div>

<style>
  .wrap { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .transcript { flex: 1; min-height: 0; overflow-y: auto; padding: 0.8em var(--oc-side) 0.6em; overflow-anchor: none; }
  .pad { padding: 0.5em 0; }
  .earlier { display: flex; justify-content: center; margin-bottom: 1em; }
  .queued { opacity: 0.75; margin-bottom: var(--oc-turn-gap); }
  .user { padding: 10px 14px; border: 1px solid var(--oc-user-line); border-left: 3px solid var(--oc-user-accent); background: var(--oc-user-bg); border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
  .uhead { display: flex; align-items: center; gap: 0.45em; margin-bottom: 0.35em; font-weight: 600; white-space: normal; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.5em; }
  .orphan { display: flex; gap: 0.6em; align-items: baseline; flex-wrap: wrap; border-left: 2px solid var(--oc-amber); padding-left: 0.5em; margin: 0.4em 0; }
  .label { font-weight: 600; }
  .target { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .working { display: flex; align-items: center; gap: 0.5em; margin: 0.3em 0 0.8em; }
  .rbar { display: flex; align-items: center; gap: 0.5em; padding: 6px 12px; margin: 0 0 var(--oc-turn-gap); border: 1px solid var(--oc-hairline); border-radius: 6px; background: var(--oc-popover); }
  .rtext { flex: 1; min-width: 0; }
  .redo { font-weight: 600; }
  .jump { position: absolute; right: calc(var(--oc-side) + 4px); bottom: 12px; width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--oc-popover); border: 1px solid var(--oc-hairline); box-shadow: 0 2px 8px var(--vscode-widget-shadow); color: var(--oc-fg); }
  .jump:hover { background: var(--oc-hover); }
  .new { position: absolute; top: 3px; right: 3px; width: 8px; height: 8px; border-radius: 50%; background: var(--oc-accent); border: 1px solid var(--oc-popover); }
</style>
