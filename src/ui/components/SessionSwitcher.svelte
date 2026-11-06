<script lang="ts">
  import { tick, type Snippet } from "svelte"
  import { relativeTime } from "../../core/format"
  import type { AppState } from "../../core/protocol"
  import { DRAFT_TITLE, flattenGroups, groupSessions, toRows, UNTITLED } from "../../core/sessions"
  import { useStore } from "../context"
  import { focusGuarded } from "../focus"
  import Codicon from "./Codicon.svelte"

  /** `extra`: controls shown before the + button (the background workers chip). */
  let { app, hasDraftText, extra }: { app: AppState; hasDraftText: boolean; extra?: Snippet } = $props()
  const store = useStore()

  let open = $state(false)
  let query = $state("")
  let index = $state(0)
  let input: HTMLInputElement | undefined = $state()

  // Title edit: either the header title or a row of the dropdown.
  let editing = $state<{ id: string; where: "header" | "row"; value: string } | undefined>(undefined)
  let editInput: HTMLInputElement | undefined = $state()

  const now = $derived(Date.now())
  const list = $derived(app.showArchived ? [...app.sessions, ...app.archived] : app.sessions)
  const currentID = $derived(app.target.kind === "session" ? app.target.id : undefined)
  const rows = $derived(toRows({ sessions: list, running: new Set(app.running), waiting: new Set(app.waiting), currentID }))
  const groups = $derived(groupSessions(rows, query, now))
  const flat = $derived(flattenGroups(groups))
  const title = $derived(app.target.kind === "draft" ? DRAFT_TITLE : (list.find((s) => s.id === currentID)?.title?.trim() || UNTITLED))
  const canRename = $derived(app.features.rename && !app.readOnly)

  async function toggle() {
    open = !open
    if (open) {
      query = ""
      index = Math.max(0, flat.indexOf(currentID ?? ""))
      await tick()
      focusGuarded(input)
    }
  }
  function pick(id: string) {
    open = false
    store.dispatch({ type: "openSession", id })
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape") { open = false; e.preventDefault() }
    else if (e.key === "ArrowDown") { index = Math.min(flat.length - 1, index + 1); e.preventDefault() }
    else if (e.key === "ArrowUp") { index = Math.max(0, index - 1); e.preventDefault() }
    else if (e.key === "Enter") { const id = flat[index]; if (id) pick(id); e.preventDefault() }
    else if (e.key === "F2") { const id = flat[index]; if (id) startEdit(id, "row"); e.preventDefault() }
  }

  async function startEdit(id: string, where: "header" | "row") {
    if (!canRename) return
    const current = list.find((s) => s.id === id)?.title?.trim() ?? ""
    editing = { id, where, value: current }
    await tick()
    // The user asked for this (pencil, F2, double-click): the field may take focus.
    focusGuarded(editInput)
    editInput?.select()
  }
  function commit() {
    const e = editing
    editing = undefined
    if (e && e.value.trim() && e.value.trim() !== (list.find((s) => s.id === e.id)?.title ?? "").trim()) store.dispatch({ type: "rename", id: e.id, title: e.value.trim() })
  }
  function cancel() { editing = undefined }
  function editKey(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key === "Enter") { e.preventDefault(); commit() }
    else if (e.key === "Escape") { e.preventDefault(); cancel() }
  }
  function titleKey(e: KeyboardEvent) {
    if (e.key === "F2" && currentID) { e.preventDefault(); void startEdit(currentID, "header") }
  }

  $effect(() => { void query; index = 0 })
  $effect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".switcher")) open = false }
    window.addEventListener("mousedown", off)
    return () => window.removeEventListener("mousedown", off)
  })
</script>

{#snippet field()}
  <input class="edit" bind:this={editInput} bind:value={editing!.value} onkeydown={editKey} onblur={commit} aria-label="Session title" />
{/snippet}

<header class="switcher">
  {#if editing?.where === "header"}
    <div class="titlewrap">{@render field()}</div>
  {:else}
    <div class="titlewrap">
      <button class="title" onclick={toggle} ondblclick={() => currentID && startEdit(currentID, "header")} onkeydown={titleKey} aria-haspopup="listbox" aria-expanded={open} title={canRename && currentID ? "Switch session. Double-click or F2 renames" : "Switch session"}>
        <span class="name">{title}</span> <span class="muted"><Codicon name="chevron-down" /></span>
      </button>
      {#if canRename && currentID}
        <button class="pencil muted" onclick={() => currentID && startEdit(currentID, "header")} title="Rename session (F2)" aria-label="Rename session"><Codicon name="edit" /></button>
      {/if}
    </div>
  {/if}
  {@render extra?.()}
  <button class="plus muted" onclick={() => store.dispatch({ type: "newDraft", hasText: hasDraftText })} title="New session" aria-label="New session"><Codicon name="add" /></button>

  {#if open}
    <div class="drop" role="presentation">
      <input bind:this={input} bind:value={query} onkeydown={onkey} placeholder="Search sessions" aria-label="Search sessions" />
      <div class="list scroll" role="listbox">
        {#each groups as g (g.name)}
          <div class="group muted">{g.name}</div>
          {#each g.rows as r (r.id)}
            {@const i = flat.indexOf(r.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="row" class:sel={i === index} role="option" tabindex="-1" aria-selected={r.current} onclick={() => editing?.id === r.id || pick(r.id)} ondblclick={() => startEdit(r.id, "row")} onmousemove={() => (index = i)}>
              <span class="dot" class:run={r.dot === "running"} class:wait={r.dot === "waiting"} title={r.dot === "waiting" ? "Waiting for you" : r.dot === "running" ? "Running" : ""}></span>
              {#if editing?.where === "row" && editing.id === r.id}
                {@render field()}
              {:else}
                <span class="t" class:archived={r.archived}>{r.title}</span>
                {#if r.current}<span class="check"><Codicon name="check" /></span>{/if}
                {#if canRename}
                  <button class="ren muted" onclick={(e) => { e.stopPropagation(); void startEdit(r.id, "row") }} title="Rename (F2)" aria-label="Rename {r.title}"><Codicon name="edit" /></button>
                {/if}
                <span class="when muted">{relativeTime(r.updated, now)}</span>
              {/if}
            </div>
          {/each}
        {:else}
          <div class="muted empty">{app.sessionsLoaded ? "No matching sessions" : "Loading…"}</div>
        {/each}
      </div>
      <div class="foot">
        <button class="muted" onclick={() => store.dispatch({ type: "toggleArchived" })}>{#if app.showArchived}<Codicon name="check" /> {/if}Show archived</button>
      </div>
    </div>
  {/if}
</header>

<style>
  .switcher { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 0.4em var(--oc-side); border-bottom: 1px solid var(--oc-hairline); gap: 0.5em; }
  .titlewrap { min-width: 0; flex: 1; display: flex; align-items: center; gap: 0.3em; }
  .title { min-width: 0; display: flex; align-items: center; gap: 0.35em; font-weight: 600; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pencil, .ren { display: inline-flex; align-items: center; padding: 0.15em 0.25em; border-radius: 4px; opacity: 0; }
  .titlewrap:hover .pencil, .pencil:focus-visible, .row:hover .ren, .ren:focus-visible { opacity: 1; }
  .pencil:hover, .ren:hover { color: var(--oc-fg); background: var(--oc-hover); }
  .plus { display: inline-flex; align-items: center; padding: 0.2em 0.3em; border-radius: 4px; }
  .plus:hover { color: var(--oc-fg); background: var(--oc-hover); }
  .drop { position: absolute; z-index: 20; left: 0.6em; right: 0.6em; top: 100%; background: var(--oc-popover); border: 1px solid var(--oc-hairline); border-radius: 6px; box-shadow: 0 4px 16px var(--vscode-widget-shadow); display: flex; flex-direction: column; max-height: 70vh; }
  input { margin: 0.5em; padding: 0.3em 0.5em; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--oc-hairline)); border-radius: 3px; }
  input.edit { margin: 0; flex: 1; min-width: 0; font-weight: 600; border-color: var(--vscode-focusBorder); }
  .list { overflow-y: auto; padding-bottom: 0.3em; }
  .group { font-size: 0.9em; padding: 0.5em var(--oc-side) 0.15em; }
  .row { display: flex; align-items: center; gap: 0.5em; min-height: 28px; padding: 0.1em var(--oc-side); cursor: pointer; }
  .row.sel { background: var(--oc-hover); }
  .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t.archived { opacity: 0.6; }
  .when { font-size: 0.9em; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .dot.run { background: var(--oc-accent); }
  .dot.wait { background: var(--oc-amber); }
  .check { color: var(--oc-accent); display: inline-flex; }
  .empty { padding: 0.6em var(--oc-side); }
  .foot { border-top: 1px solid var(--oc-hairline); padding: 0.35em var(--oc-side); }
  .foot button { display: inline-flex; align-items: center; gap: 0.3em; }
  .foot button:hover { color: var(--oc-fg); }
</style>
