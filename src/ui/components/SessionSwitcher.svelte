<script lang="ts">
  import { tick } from "svelte"
  import { relativeTime } from "../../core/format"
  import type { AppState } from "../../core/protocol"
  import { DRAFT_TITLE, flattenGroups, groupSessions, toRows, UNTITLED } from "../../core/sessions"
  import { useStore } from "../context"
  import { focusGuarded } from "../focus"

  let { app, hasDraftText }: { app: AppState; hasDraftText: boolean } = $props()
  const store = useStore()

  let open = $state(false)
  let query = $state("")
  let index = $state(0)
  let input: HTMLInputElement | undefined = $state()

  const now = $derived(Date.now())
  const list = $derived(app.showArchived ? [...app.sessions, ...app.archived] : app.sessions)
  const currentID = $derived(app.target.kind === "session" ? app.target.id : undefined)
  const rows = $derived(toRows({ sessions: list, running: new Set(app.running), waiting: new Set(app.waiting), currentID }))
  const groups = $derived(groupSessions(rows, query, now))
  const flat = $derived(flattenGroups(groups))
  const title = $derived(app.target.kind === "draft" ? DRAFT_TITLE : (list.find((s) => s.id === currentID)?.title?.trim() || UNTITLED))

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
  }
  $effect(() => { void query; index = 0 })
  $effect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".switcher")) open = false }
    window.addEventListener("mousedown", off)
    return () => window.removeEventListener("mousedown", off)
  })
</script>

<header class="switcher">
  <button class="title" onclick={toggle} aria-haspopup="listbox" aria-expanded={open} title="Switch session">
    <span class="name">{title}</span> <span class="muted">⌄</span>
  </button>
  <button class="plus muted" onclick={() => store.dispatch({ type: "newDraft", hasText: hasDraftText })} title="New session" aria-label="New session">+</button>

  {#if open}
    <div class="drop" role="presentation">
      <input bind:this={input} bind:value={query} onkeydown={onkey} placeholder="Search sessions" aria-label="Search sessions" />
      <div class="list scroll" role="listbox">
        {#each groups as g (g.name)}
          <div class="group muted">{g.name}</div>
          {#each g.rows as r (r.id)}
            {@const i = flat.indexOf(r.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="row" class:sel={i === index} role="option" tabindex="-1" aria-selected={r.current} onclick={() => pick(r.id)} onmousemove={() => (index = i)}>
              <span class="dot" class:run={r.dot === "running"} class:wait={r.dot === "waiting"} title={r.dot === "waiting" ? "Waiting for you" : r.dot === "running" ? "Running" : ""}></span>
              <span class="t" class:archived={r.archived}>{r.title}</span>
              {#if r.current}<span class="check">✓</span>{/if}
              <span class="when muted">{relativeTime(r.updated, now)}</span>
            </div>
          {/each}
        {:else}
          <div class="muted empty">{app.sessionsLoaded ? "No matching sessions" : "Loading…"}</div>
        {/each}
      </div>
      <div class="foot">
        <button class="muted" onclick={() => store.dispatch({ type: "toggleArchived" })}>{app.showArchived ? "✓ " : ""}Show archived</button>
      </div>
    </div>
  {/if}
</header>

<style>
  .switcher { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 0.4em 0.9em; border-bottom: 1px solid var(--oc-hairline); }
  .title { min-width: 0; display: flex; gap: 0.35em; font-weight: 600; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .plus { font-size: 1.3em; line-height: 1; padding: 0 0.3em; }
  .plus:hover { color: var(--oc-fg); }
  .drop { position: absolute; z-index: 20; left: 0.6em; right: 0.6em; top: 100%; background: var(--oc-popover); border: 1px solid var(--oc-hairline); border-radius: 6px; box-shadow: 0 4px 16px var(--vscode-widget-shadow); display: flex; flex-direction: column; max-height: 70vh; }
  input { margin: 0.5em; padding: 0.3em 0.5em; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--oc-hairline)); border-radius: 3px; }
  .list { overflow-y: auto; padding-bottom: 0.3em; }
  .group { font-size: 0.85em; padding: 0.5em 0.9em 0.15em; }
  .row { display: flex; align-items: center; gap: 0.5em; padding: 0.2em 0.9em; cursor: pointer; }
  .row.sel { background: var(--oc-hover); }
  .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t.archived { opacity: 0.6; }
  .when { font-size: 0.9em; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .dot.run { background: var(--oc-accent); }
  .dot.wait { background: var(--oc-amber); }
  .check { color: var(--oc-accent); }
  .empty { padding: 0.6em 0.9em; }
  .foot { border-top: 1px solid var(--oc-hairline); padding: 0.35em 0.9em; }
  .foot button:hover { color: var(--oc-fg); }
</style>
