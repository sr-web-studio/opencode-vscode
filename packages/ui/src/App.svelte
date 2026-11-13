<script lang="ts">
  import "./app.css"
  import { onDestroy } from "svelte"
  import { emptyPromptDraft, draftFolderKey as folderDraftKey, draftTargetKey, loadDraft, type PromptDraft } from "@occ/core/prompt-draft"
  import { todoBar } from "@occ/core/todo"
  import { isRunning } from "@occ/core/transcript/reducer"
  import { showEmptyState } from "@occ/core/draft"
  import { modelLabel, modelTitle } from "@occ/core/workers"
  import { visibleWorkers } from "@occ/core/worker-hidden"
  import { paneMode } from "@occ/core/sessions-pane"
  import type { HostBridge } from "./bridge"
  import { provideStore, provideTranscript } from "./context"
  import { DraftWriter } from "./draft-persist"
  import { Store } from "./store.svelte"
  import Codicon from "./components/Codicon.svelte"
  import EmptyState from "./components/EmptyState.svelte"
  import PromptBox from "./components/PromptBox.svelte"
  import QuestionPrompt from "./components/QuestionPrompt.svelte"
  import SessionSwitcher from "./components/SessionSwitcher.svelte"
  import SessionsPane from "./components/SessionsPane.svelte"
  import StopWorkerButton from "./components/StopWorkerButton.svelte"
  import Setup from "./components/Setup.svelte"
  import TodoBar from "./components/TodoBar.svelte"
  import Transcript from "./components/Transcript.svelte"
  import WorkersRow from "./components/WorkersRow.svelte"

  /**
   * `workerForm`: the phone's worker screen shows the worker's own pending question and answers it. The VS Code worker
   * tab passes nothing and stays transcript-only, as before.
   */
  let { bridge, workerForm = false }: { bridge: HostBridge; workerForm?: boolean } = $props()
  // The bridge is fixed for the lifetime of the webview.
  // svelte-ignore state_referenced_locally
  const store = new Store(bridge)
  provideStore(store)
  // Drafts outlive the webview: VS Code destroys a hidden view's DOM, and the phone can be sent to the background.
  // svelte-ignore state_referenced_locally
  const draftWriter = new DraftWriter(bridge.storage)
  const stopDraftFlush = draftWriter.listen()
  // A phone host knows exactly when the app goes away; the DOM events above are only a guess there.
  // svelte-ignore state_referenced_locally
  const stopHiddenFlush = bridge.onHidden?.(() => draftWriter.flush()) ?? (() => {})
  onDestroy(() => {
    stopHiddenFlush()
    stopDraftFlush()
    draftWriter.dispose()
    store.dispose()
  })

  const app = $derived(store.state)
  /** Shown once, when a saved draft was too large to keep its attached pictures. */
  const DRAFT_IMAGES_DROPPED = "Some attached images were too large to keep in the saved prompt, so they were not restored. Attach them again."
  /** One prompt per folder: text, attachments and skills travel together and come back when the folder does. */
  type FolderDraft = PromptDraft
  const emptyDraft = emptyPromptDraft
  const drafts = new Map<string, FolderDraft>()
  let draft = $state<FolderDraft>(emptyDraft())
  let draftKey = $state("")
  let prompt: PromptBox | undefined = $state()
  let lastEpoch = -1
  let lastEpochFolder: string | undefined
  let lastTick = 0

  /* ------------------------------------------------------- sessions pane */

  /** The in-chat sessions list is a VS Code feature; the phone's own drawer replaces it. */
  const paneCapable = $derived(store.bridge.capabilities?.sessionsPane !== false)
  const paneAvailable = $derived(paneCapable && !!app && !app.readOnly)
  let shellWidth = $state(typeof window === "undefined" ? 900 : window.innerWidth)
  /**
   * The pane is the only session list now, so a wide view opens it on its own until the user says otherwise: a view
   * that has never been toggled (`sessionsPane` unset) starts open when it has room for the column, and closed when it
   * would cover the chat (the header button then opens the overlay). A remembered answer always wins.
   */
  const rememberedPane = store.bridge.storage.get<boolean>("sessionsPane")
  // svelte-ignore state_referenced_locally
  let paneOpen = $state(rememberedPane ?? paneMode(shellWidth) === "wide")
  let lastSessionsTick = 0
  const paneVisible = $derived(paneAvailable && paneOpen)
  const overlay = $derived(paneMode(shellWidth) === "overlay")

  function setPane(open: boolean): void {
    paneOpen = open
    store.bridge.storage.set("sessionsPane", open)
  }
  // The title-bar button is a host command; the webview owns the open/closed state and remembers it per window.
  $effect(() => {
    const tick = store.sessionsTick
    if (tick === lastSessionsTick) return
    lastSessionsTick = tick
    setPane(!paneOpen)
  })
  // Escape closes the pane; in overlay mode that is also the only way to dismiss it from the keyboard.
  $effect(() => {
    if (!paneVisible || !overlay) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPane(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  /**
   * The draft key: the workspace folder when the host sends the list, otherwise the controller's directory. Both are
   * normalised, because the server may respell a single folder (`d:` vs `D:`) without the folder changing.
   */
  function draftFolderKey(state: typeof app): string {
    return folderDraftKey(state?.folders?.find((f) => f.active)?.directory ?? state?.directory ?? "")
  }

  // `+` from the title bar: the host asks, we know whether the draft has text.
  $effect(() => {
    const t = store.newSessionTick
    if (t === lastTick) return
    lastTick = t
    store.dispatch({ type: "newDraft", hasText: draft.text.trim().length > 0 })
  })
  // Switching workspace folder shows another controller: keep this folder's draft and restore the other folder's.
  $effect(() => {
    const key = draftFolderKey(app)
    if (key === draftKey) return
    if (draftKey) drafts.set(draftKey, { text: draft.text, files: [...draft.files], skills: [...draft.skills] })
    const saved = drafts.get(key)
    if (saved) {
      draft = { text: saved.text, files: [...saved.files], skills: [...saved.skills] }
    } else {
      // Not seen in this webview yet: the host store may still have it from before the view was destroyed.
      const restored = loadDraft(store.bridge.storage, key, draftTargetKey(app?.target))
      draft = restored ? restored.draft : emptyDraft()
      if (restored?.dropped) store.bridge.notify("warning", DRAFT_IMAGES_DROPPED)
    }
    draftKey = key
  })
  // A fresh draft clears the prompt of the folder on screen. A folder switch is not a fresh draft.
  $effect(() => {
    const epoch = app?.draftEpoch ?? 0
    const key = draftKey
    if (key !== lastEpochFolder) {
      lastEpochFolder = key
      lastEpoch = epoch
      return
    }
    if (epoch !== lastEpoch) {
      if (lastEpoch !== -1) draft = emptyDraft()
      lastEpoch = epoch
    }
  })
  // Keep the host's copy in step with the box: debounced while typing, at once when the folder or target changes.
  $effect(() => {
    const key = draftKey
    const target = draftTargetKey(app?.target)
    if (!key || !target) return
    draftWriter.save(key, target, draft)
  })

  const connected = $derived(app?.connection.status === "connected")
  const empty = $derived(!!app && showEmptyState(app.target, app.sessions.length) && app.sessionsLoaded)
  const running = $derived(!!app && isRunning(app.view))
  provideTranscript({
    workers: () => app?.workers ?? [],
    models: () => app?.models ?? [],
    features: () => app?.features ?? { revert: false, rename: false },
    readOnly: () => app?.readOnly ?? false,
    displayPath: () => app?.displayPath ?? "",
    running: () => running || (!!app && app.target.kind === "session" && app.running.includes(app.target.id)),
  })
  const shownWorkers = $derived(app ? visibleWorkers(app.workers, app.hiddenWorkers).length : 0)
  /** A worker tab whose session is executing: the header offers Stop. */
  const workerRunning = $derived(!!app?.readOnly && (running || (app.target.kind === "session" && app.running.includes(app.target.id))))
  const workerModel = $derived(app?.readOnly ? modelLabel(app.model, app.models) : "")
  const todos = $derived(app ? todoBar(app.view, running || (app.target.kind === "session" && app.running.includes(app.target.id))) : undefined)

  function suggest(text: string) {
    draft.text = text
    prompt?.focusPrompt()
  }
</script>

<div class="app" style:--oc-font-size="{app?.settings.fontSize ?? 13}px">
  {#if !app}
    <div class="boot muted">Loading…</div>
  {:else if !connected && app.connection.status !== "disconnected"}
    <Setup connection={app.connection} />
  {:else}
    <div class="shell" bind:clientWidth={shellWidth}>
      {#if paneVisible}
        <SessionsPane {app} {overlay} viewWidth={shellWidth} onclose={() => setPane(false)} />
      {/if}
      <div class="chat">
        {#if app.readOnly}
          <header class="wtitle">
            <Codicon name="robot" />
            <span class="wname">{app.workerTitle ?? "Worker"}</span>
            {#if workerModel}<span class="wmodel muted small" title={modelTitle(app.model)}>{workerModel}</span>{/if}
            <span class="muted small wro">Read-only</span>
            {#if workerRunning && app.target.kind === "session"}<StopWorkerButton sessionID={app.target.id} running variant="label" />{/if}
          </header>
        {:else}
          <SessionSwitcher {app} hasDraftText={draft.text.trim().length > 0} {paneCapable} {paneOpen} showProject={paneCapable} onTogglePane={() => setPane(!paneOpen)}>
            {#snippet extra()}
              {#if shownWorkers > 0 || app.runningShells > 0}
                <WorkersRow workers={app.workers} hidden={app.hiddenWorkers} models={app.models} shells={app.runningShells} />
              {/if}
            {/snippet}
          </SessionSwitcher>
        {/if}
        {#if app.connection.status === "disconnected"}
          <div class="banner muted">Connection lost. Reconnecting…</div>
        {/if}
        {#if empty}
          <EmptyState folderName={app.projectName ?? app.folderName} displayPath={app.displayPath} onsuggest={suggest} />
        {:else}
          <Transcript {app}>
            {#if todos && !app.form && !app.readOnly}
              <TodoBar summary={todos} defaultExpanded={app.settings.todoDefaultExpanded} />
            {/if}
          </Transcript>
        {/if}
        {#if app.error}
          <div class="error err" role="alert">
            <span>{app.error}</span>
            <button class="muted" onclick={() => store.dispatch({ type: "dismissError" })} aria-label="Dismiss"><Codicon name="close" /></button>
          </div>
        {/if}
        {#if app.readOnly}
          {#if workerForm && app.form}
            <div class="qwrap"><QuestionPrompt form={app.form} /></div>
          {/if}
        {:else if app.form}
          <div class="qwrap"><QuestionPrompt form={app.form} /></div>
        {:else}
          <PromptBox bind:this={prompt} {app} folder={draftKey} bind:text={draft.text} bind:files={draft.files} bind:skills={draft.skills} />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }
  .boot {
    padding: 1em;
  }
  /* The chat and, when open, the sessions pane side by side. In a narrow view the pane overlays instead. */
  .shell {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: row;
    position: relative;
  }
  .chat {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .banner {
    font-size: 0.9em;
    padding: 0.25em var(--oc-side);
    border-bottom: 1px solid var(--oc-hairline);
  }
  .error {
    display: flex;
    justify-content: space-between;
    gap: 0.6em;
    padding: 0.3em var(--oc-side);
    font-size: 0.95em;
  }
  .qwrap {
    padding: 0.3em var(--oc-side) 0.7em;
    max-height: 65vh;
    overflow-y: auto;
  }
  .wtitle {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.5em var(--oc-side);
    border-bottom: 1px solid var(--oc-hairline);
    font-weight: 600;
  }
  .wname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wmodel {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 400;
  }
  .wro {
    flex: none;
    margin-left: auto;
    font-weight: 400;
  }
  .wtitle :global(.lbl) {
    margin-left: 0;
  }
</style>
