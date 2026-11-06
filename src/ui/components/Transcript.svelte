<script lang="ts">
  import { tick } from "svelte"
  import type { AppState } from "../../core/protocol"
  import type { PermissionRequest } from "../../core/api"
  import { isRunning } from "../../core/transcript/reducer"
  import { runningTool } from "../../core/transcript/turn"
  import { useStore } from "../context"
  import PermissionPrompt from "./PermissionPrompt.svelte"
  import Turn from "./Turn.svelte"

  let { app }: { app: AppState } = $props()
  const store = useStore()

  let box: HTMLDivElement | undefined = $state()
  let stick = true

  const byTool = $derived(new Map(app.permissions.flatMap((p) => (p.source?.id ? [[p.source.id, p] as const] : []))))
  const toolIDs = $derived(new Set(app.view.turns.flatMap((t) => t.steps.flatMap((s) => s.items.flatMap((i) => (i.kind === "tool" ? [i.id] : []))))))
  // Requests that do not map to a visible tool line still need an answer.
  const orphans = $derived<PermissionRequest[]>(app.permissions.filter((p) => !p.source?.id || !toolIDs.has(p.source.id)))
  const busy = $derived(isRunning(app.view))
  const idleSpinner = $derived(busy && !runningTool(app.view.turns) && !app.view.turns.at(-1)?.steps.at(-1)?.items.some((i) => i.kind !== "tool" && i.streaming))

  function onscroll() {
    if (!box) return
    stick = box.scrollHeight - box.scrollTop - box.clientHeight < 48
  }

  // Follow the bottom while the user has not scrolled away.
  $effect(() => {
    void app.view
    void app.permissions
    if (!stick) return
    void tick().then(() => box && (box.scrollTop = box.scrollHeight))
  })
  $effect(() => {
    void app.target
    stick = true
  })
</script>

<div class="transcript scroll" bind:this={box} {onscroll}>
  {#if app.loadingView}
    <div class="muted pad">Loading…</div>
  {:else}
    {#each app.view.turns as turn (turn.id)}
      <Turn {turn} cwd={app.directory} settings={app.settings} permissions={byTool} />
    {/each}
    {#each app.view.queued as q (q.id)}
      <div class="queued"><div class="user">{q.text}</div><div class="muted small">Queued</div></div>
    {/each}
    {#each orphans as p (p.id)}
      <div class="orphan">
        <span class="label">Permission</span>
        <span class="muted target">{p.action}{p.resources[0] ? `: ${p.resources[0]}` : ""}</span>
        <PermissionPrompt request={p} />
      </div>
    {/each}
    {#if idleSpinner}<div class="working muted"><span class="spinner"></span> Working…</div>{/if}
    {#if app.view.loaded && app.view.turns.length === 0 && app.view.queued.length === 0}
      <div class="muted pad">No messages yet.</div>
    {/if}
  {/if}
</div>

<style>
  .transcript { flex: 1; min-height: 0; overflow-y: auto; padding: 0.6em 0.9em 0.4em; }
  .pad { padding: 0.5em 0; }
  .queued { opacity: 0.7; margin-bottom: 0.8em; }
  .user { display: inline-block; background: var(--oc-bubble); border-radius: 8px; padding: 0.45em 0.8em; white-space: pre-wrap; }
  .small { font-size: 0.9em; }
  .orphan { display: flex; gap: 0.6em; align-items: baseline; flex-wrap: wrap; border-left: 2px solid var(--oc-amber); padding-left: 0.5em; margin: 0.4em 0; }
  .label { font-weight: 600; }
  .target { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .working { display: flex; align-items: center; gap: 0.5em; margin: 0.3em 0 0.8em; }
</style>
