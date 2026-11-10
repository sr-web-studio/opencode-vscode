<script lang="ts">
  import { tick, type Snippet } from "svelte"
  import type { AppState } from "@occ/core/protocol"
  import { DRAFT_TITLE, UNTITLED } from "@occ/core/sessions"
  import { useStore } from "../context"
  import { focusGuarded } from "../focus"
  import Codicon from "./Codicon.svelte"

  /**
   * The chat's one slim header row: the sessions-pane toggle, the project the chat is in, the current session's title
   * (click, F2 or double-click renames it), the background-workers chip and `+` for a new session.
   *
   * The folder and session dropdowns that used to live here are gone: the sessions pane lists every folder and
   * session, and the phone's drawer does the same. The file kept its old name because this is still the header the
   * session switcher used to be.
   */
  let {
    app,
    hasDraftText,
    extra,
    paneCapable = false,
    paneOpen = false,
    showProject = false,
    onTogglePane,
  }: {
    app: AppState
    hasDraftText: boolean
    extra?: Snippet
    paneCapable?: boolean
    paneOpen?: boolean
    showProject?: boolean
    onTogglePane?: () => void
  } = $props()
  const store = useStore()

  /** Only the title is editable here; renaming another session is the pane's job. */
  let editing = $state(false)
  let value = $state("")
  let editInput: HTMLInputElement | undefined = $state()

  const currentID = $derived(app.target.kind === "session" ? app.target.id : undefined)
  const sessions = $derived([...app.sessions, ...app.archived])
  const title = $derived(app.target.kind === "draft" ? DRAFT_TITLE : sessions.find((s) => s.id === currentID)?.title?.trim() || UNTITLED)
  const canRename = $derived(app.features.rename && !app.readOnly && !!currentID)
  const project = $derived(app.projectName?.trim() || app.folderName)
  const projectTitle = $derived(app.projectName ? `${app.projectName} — ${app.folderName} (${app.directory})` : app.displayPath)

  async function startEdit(): Promise<void> {
    if (!canRename || editing) return
    value = title
    editing = true
    await tick()
    // The user asked for this (click, pencil, F2, double-click): the field may take focus.
    focusGuarded(editInput)
    editInput?.select()
  }

  function commit(): void {
    if (!editing) return
    editing = false
    const next = value.trim()
    if (next && next !== title && currentID) store.dispatch({ type: "rename", id: currentID, title: next })
  }

  function cancel(): void {
    editing = false
  }

  function editKey(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === "Enter") {
      e.preventDefault()
      commit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      cancel()
    }
  }

  function headerKey(e: KeyboardEvent): void {
    if (e.key === "F2" && !editing) {
      e.preventDefault()
      void startEdit()
    }
  }
</script>

<header class="switcher">
  {#if paneCapable}
    <button
      class="pane-btn muted"
      class:on={paneOpen}
      onclick={() => onTogglePane?.()}
      title="Sessions (OpenCode: Toggle Sessions)"
      aria-label={paneOpen ? "Hide sessions" : "Show sessions"}
      aria-expanded={paneOpen}><Codicon name="layout-sidebar-left" /></button
    >
  {/if}
  {#if showProject && project}
    <span class="project muted" title={projectTitle}>{project}</span>
    <span class="sep muted" aria-hidden="true">/</span>
  {/if}
  <div class="titlewrap">
    {#if editing}
      <input class="edit" bind:this={editInput} bind:value onkeydown={editKey} onblur={commit} aria-label="Session title" />
    {:else}
      <button
        class="title"
        onclick={() => void startEdit()}
        ondblclick={() => void startEdit()}
        onkeydown={headerKey}
        title={canRename ? `${title} — rename (F2)` : title}
        aria-label={canRename ? `Session: ${title}. Rename with F2` : `Session: ${title}`}
      >
        <span class="name">{title}</span>
      </button>
      {#if canRename}
        <button class="pencil muted" onclick={() => void startEdit()} title="Rename session (F2)" aria-label="Rename session"><Codicon name="edit" /></button>
      {/if}
    {/if}
  </div>
  {@render extra?.()}
  <button class="plus muted" onclick={() => store.dispatch({ type: "newDraft", hasText: hasDraftText })} title="New session" aria-label="New session"><Codicon name="add" /></button>
</header>

<style>
  .switcher {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0.4em var(--oc-side);
    border-bottom: 1px solid var(--oc-hairline);
    gap: 0.4em;
  }
  .pane-btn,
  .pencil,
  .plus {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    padding: 0.2em 0.3em;
    border-radius: 4px;
  }
  .pane-btn.on,
  .pane-btn:hover,
  .plus:hover,
  .pencil:hover {
    color: var(--oc-fg);
    background: var(--oc-hover);
  }
  .pencil {
    opacity: 0;
  }
  .titlewrap:hover .pencil,
  .pencil:focus-visible {
    opacity: 1;
  }
  .project {
    flex: none;
    max-width: 38%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9em;
  }
  .sep {
    flex: none;
    font-size: 0.9em;
  }
  .titlewrap {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.3em;
  }
  .title {
    min-width: 0;
    display: flex;
    align-items: center;
    font-weight: 600;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input.edit {
    flex: 1;
    min-width: 0;
    padding: 0.1em 0.3em;
    font-weight: 600;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 3px;
  }
  @media (hover: none) {
    .pencil {
      opacity: 1;
    }
  }
</style>
