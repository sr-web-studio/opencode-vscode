<script lang="ts">
  import "./app.css"
  import { onDestroy } from "svelte"
  import { todoBar } from "../core/todo"
  import { isRunning } from "../core/transcript/reducer"
  import { showEmptyState } from "../core/draft"
  import type { HostBridge } from "./bridge"
  import { provideStore, provideTranscript } from "./context"
  import { Store } from "./store.svelte"
  import Codicon from "./components/Codicon.svelte"
  import EmptyState from "./components/EmptyState.svelte"
  import PromptBox from "./components/PromptBox.svelte"
  import QuestionPrompt from "./components/QuestionPrompt.svelte"
  import SessionSwitcher from "./components/SessionSwitcher.svelte"
  import Setup from "./components/Setup.svelte"
  import TodoBar from "./components/TodoBar.svelte"
  import Transcript from "./components/Transcript.svelte"
  import WorkersRow from "./components/WorkersRow.svelte"

  let { bridge }: { bridge: HostBridge } = $props()
  // The bridge is fixed for the lifetime of the webview.
  // svelte-ignore state_referenced_locally
  const store = new Store(bridge)
  provideStore(store)
  onDestroy(() => store.dispose())

  const app = $derived(store.state)
  let draft = $state("")
  let prompt: PromptBox | undefined = $state()
  let lastEpoch = -1
  let lastTick = 0

  // `+` from the title bar: the host asks, we know whether the draft has text.
  $effect(() => {
    const t = store.newSessionTick
    if (t === lastTick) return
    lastTick = t
    store.dispatch({ type: "newDraft", hasText: draft.trim().length > 0 })
  })
  // A fresh draft clears the prompt text.
  $effect(() => {
    const epoch = app?.draftEpoch ?? 0
    if (epoch !== lastEpoch) {
      if (lastEpoch !== -1) draft = ""
      lastEpoch = epoch
    }
  })

  const connected = $derived(app?.connection.status === "connected")
  const empty = $derived(!!app && showEmptyState(app.target, app.sessions.length) && app.sessionsLoaded)
  const running = $derived(!!app && isRunning(app.view))
  provideTranscript({
    workers: () => app?.workers ?? [],
    features: () => app?.features ?? { revert: false, rename: false },
    readOnly: () => app?.readOnly ?? false,
    running: () => running || (!!app && app.target.kind === "session" && app.running.includes(app.target.id)),
  })
  const todos = $derived(app ? todoBar(app.view, running || (app.target.kind === "session" && app.running.includes(app.target.id))) : undefined)

  function suggest(text: string) {
    draft = text
    prompt?.focusPrompt()
  }
</script>

<div class="app" style:--oc-font-size="{app?.settings.fontSize ?? 13}px">
  {#if !app}
    <div class="boot muted">Loading…</div>
  {:else if !connected && app.connection.status !== "disconnected"}
    <Setup connection={app.connection} />
  {:else}
    {#if app.readOnly}
      <header class="wtitle"><Codicon name="robot" /> <span class="wname">{app.workerTitle ?? "Worker"}</span> <span class="muted small">Read-only</span></header>
    {:else}
      <SessionSwitcher {app} hasDraftText={draft.trim().length > 0} />
    {/if}
    {#if app.connection.status === "disconnected"}
      <div class="banner muted">Connection lost. Reconnecting…</div>
    {/if}
    {#if !app.readOnly && (app.workers.length > 0 || app.runningShells > 0)}
      <WorkersRow workers={app.workers} shells={app.runningShells} />
    {/if}
    {#if empty}
      <EmptyState folderName={app.folderName} displayPath={app.displayPath} onsuggest={suggest} />
    {:else}
      <Transcript {app} />
    {/if}
    {#if app.error}
      <div class="error err" role="alert">
        <span>{app.error}</span>
        <button class="muted" onclick={() => store.dispatch({ type: "dismissError" })} aria-label="Dismiss"><Codicon name="close" /></button>
      </div>
    {/if}
    {#if todos && !app.form && !app.readOnly}
      <TodoBar summary={todos} defaultExpanded={app.settings.todoDefaultExpanded} />
    {/if}
    {#if app.readOnly}
      <!-- Worker tab: nothing to type into. -->
    {:else if app.form}
      <div class="qwrap"><QuestionPrompt form={app.form} /></div>
    {:else}
      <PromptBox bind:this={prompt} {app} bind:text={draft} />
    {/if}
  {/if}
</div>

<style>
  .app { height: 100%; display: flex; flex-direction: column; min-height: 0; position: relative; }
  .boot { padding: 1em; }
  .banner { font-size: 0.9em; padding: 0.25em var(--oc-side); border-bottom: 1px solid var(--oc-hairline); }
  .error { display: flex; justify-content: space-between; gap: 0.6em; padding: 0.3em var(--oc-side); font-size: 0.95em; }
  .qwrap { padding: 0.3em var(--oc-side) 0.7em; }
  .wtitle { display: flex; align-items: center; gap: 0.5em; padding: 0.5em var(--oc-side); border-bottom: 1px solid var(--oc-hairline); font-weight: 600; }
  .wname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
