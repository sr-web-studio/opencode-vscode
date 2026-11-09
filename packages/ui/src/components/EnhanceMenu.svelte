<script lang="ts">
  import { onMount, tick } from "svelte"
  import type { EnhanceMode } from "@occ/core/enhance"
  import { findModel, groupModels, sameModel, type ModelSelection } from "@occ/core/models"
  import type { AppState } from "@occ/core/protocol"
  import { focusGuarded } from "../focus"
  import Codicon from "./Codicon.svelte"

  /**
   * The menu above the prompt box: pick Polish or Rewrite, or the model the enhancement uses. It is a small popup that
   * keeps its own keyboard (arrows, Enter, Esc); the caller returns focus to the prompt box when it closes.
   */
  let {
    app,
    onpick,
    onmodel,
    onclose,
  }: {
    app: AppState
    onpick: (mode: EnhanceMode) => void
    onmodel: (model: ModelSelection | undefined) => void
    /** `refocus`: give the keyboard back to the prompt box (Esc), not after a click somewhere else. */
    onclose: (refocus: boolean) => void
  } = $props()

  let view = $state<"menu" | "model">("menu")
  let index = $state(0)
  let query = $state("")
  let root: HTMLDivElement | undefined = $state()
  let search: HTMLInputElement | undefined = $state()

  const groups = $derived(groupModels({ models: app.models, providers: app.providers, query }))
  // Row 0 is "OpenCode default" (no model sent), then every listed model in display order.
  const rows = $derived<Array<{ m?: { id: string; providerID: string } }>>([{}, ...groups.flatMap((g) => g.models.map((m) => ({ m: { id: m.id, providerID: m.providerID } })))])
  const showSearch = $derived(app.models.length > 12)
  const nameOf = (m: { id: string; providerID: string } | undefined) => (m ? (findModel(app.models, m)?.name ?? m.id) : undefined)
  const current = $derived(nameOf(app.enhanceModel) ?? "OpenCode default")
  const defaultName = $derived(nameOf(app.enhanceDefault))

  const rowIndex = (m: { id: string; providerID: string }) => rows.findIndex((r) => r.m && r.m.id === m.id && r.m.providerID === m.providerID)

  function focusRoot() {
    void tick().then(() => focusGuarded(root))
  }
  function openModels() {
    view = "model"
    index = 0
    void tick().then(() => focusGuarded(showSearch ? search : root))
  }
  function back() {
    view = "menu"
    index = 0
    focusRoot()
  }
  function choose(mode: EnhanceMode) {
    onpick(mode)
  }
  function chooseRow(i: number) {
    if (i === 0) choose("polish")
    else if (i === 1) choose("rewrite")
    else openModels()
  }
  function chooseModel(i: number) {
    const m = rows[i]?.m
    onmodel(m ? { id: m.id, providerID: m.providerID } : undefined)
  }

  function onKey(e: KeyboardEvent) {
    const size = view === "menu" ? 3 : rows.length
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      if (view === "model") back()
      else onclose(true)
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      index = Math.min(size - 1, index + 1)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      index = Math.max(0, index - 1)
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (view === "menu") chooseRow(index)
      else chooseModel(index)
    }
  }

  // The menu takes the keyboard when it opens, so arrows, Enter and Esc work without touching the mouse.
  onMount(() => focusGuarded(root))

  // A new search starts at the top of the list.
  $effect(() => {
    void query
    index = 0
  })
  // A click anywhere else closes the menu, except on the button that opened it (that one toggles).
  $effect(() => {
    const off = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".enhance-menu, .enhance-btn")) onclose(false)
    }
    window.addEventListener("mousedown", off)
    return () => window.removeEventListener("mousedown", off)
  })
  // Keep the active row visible in a long model list.
  $effect(() => {
    void index
    void view
    void tick().then(() => root?.querySelector(".sel")?.scrollIntoView({ block: "nearest" }))
  })
</script>

<div class="pop enhance-menu" bind:this={root} tabindex="-1" role="menu" aria-label="Enhance prompt" onkeydown={onKey}>
  {#if view === "menu"}
    <div class="title muted">Enhance prompt</div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="row"
      class:sel={index === 0}
      role="menuitem"
      tabindex="-1"
      title="Fix grammar, spelling, sentence structure and dictation errors"
      onclick={() => choose("polish")}
      onmousemove={() => (index = 0)}
    >
      <span class="n">Polish</span>
      <span class="d muted wrap">Fix grammar, spelling, sentence structure and dictation errors</span>
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="row" class:sel={index === 1} role="menuitem" tabindex="-1" title="A detailed, clear prompt for the agent" onclick={() => choose("rewrite")} onmousemove={() => (index = 1)}>
      <span class="n">Rewrite</span>
      <span class="d muted wrap">A detailed, clear prompt for the agent</span>
    </div>
    <div class="sep"></div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="row" class:sel={index === 2} role="menuitem" tabindex="-1" onclick={openModels} onmousemove={() => (index = 2)}>
      <span class="n">Model</span>
      <span class="d muted">{current}</span>
      <span class="mark muted"><Codicon name="chevron-right" /></span>
    </div>
  {:else}
    <div class="title muted">Enhance with</div>
    {#if showSearch}
      <input bind:this={search} bind:value={query} onkeydown={onKey} placeholder="Search models" aria-label="Search models" />
    {/if}
    <div class="list scroll">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="row" class:sel={index === 0} role="menuitemradio" tabindex="-1" aria-checked={!app.enhanceModel} onclick={() => onmodel(undefined)} onmousemove={() => (index = 0)}>
        <span class="check"
          >{#if !app.enhanceModel}<Codicon name="check" />{/if}</span
        >
        <span class="n">OpenCode default</span>
        {#if defaultName}<span class="d muted">{defaultName}</span>{/if}
      </div>
      {#each groups as g (g.providerID)}
        <div class="group muted">{g.providerName}</div>
        {#each g.models as m (`${m.providerID}/${m.id}`)}
          {@const i = rowIndex(m)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="row"
            class:sel={i === index}
            role="menuitemradio"
            tabindex="-1"
            aria-checked={sameModel(app.enhanceModel, m)}
            onclick={() => onmodel({ id: m.id, providerID: m.providerID })}
            onmousemove={() => (index = i)}
          >
            <span class="check"
              >{#if sameModel(app.enhanceModel, m)}<Codicon name="check" />{/if}</span
            >
            <span class="n">{m.name}</span>
          </div>
        {/each}
      {:else}
        <div class="empty muted">No models available</div>
      {/each}
    </div>
    {#if app.enhanceModelStale}<div class="stale muted">The saved enhancement model is not on this server any more. Using the default.</div>{/if}
    <button class="back muted" onclick={back}><Codicon name="arrow-left" /> Back</button>
  {/if}
</div>

<style>
  /* A menu, not a dialog: it takes the width of the prompt box (never more than a compact panel) and the density of the
     other popups (model picker, slash list): single-line rows, secondary text at the `.small` size. */
  .pop {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 30;
    width: min(21em, 100%);
    min-width: min(13em, 100%);
    max-width: 100%;
    background: var(--oc-popover);
    border: 1px solid var(--oc-hairline);
    border-radius: 6px;
    box-shadow: 0 4px 16px var(--vscode-widget-shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
    line-height: 1.5;
  }
  .title {
    font-size: 0.9em;
    padding: 0.35em 0.8em 0.1em;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    min-height: 26px;
    padding: 0.1em 0.8em;
    cursor: pointer;
  }
  .row.sel {
    background: var(--oc-hover);
  }
  .n {
    font-weight: 600;
    white-space: nowrap;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .d {
    flex: 1;
    min-width: 0;
    font-size: 0.9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Polish and Rewrite must say what they do in full, so their description wraps onto a second line instead of
     ending in an ellipsis; the row only grows when the text really needs it. */
  .d.wrap {
    white-space: normal;
    text-overflow: clip;
    overflow: visible;
    line-height: 1.35;
  }
  .mark {
    flex: none;
    margin-left: auto;
  }
  .check {
    width: 1em;
    flex: none;
    color: var(--oc-accent);
  }
  .sep {
    height: 1px;
    margin: 0.2em 0;
    background: var(--oc-hairline);
  }
  .list {
    overflow-y: auto;
    max-height: min(45vh, 18em);
    padding-bottom: 0.2em;
  }
  .group {
    font-size: 0.9em;
    padding: 0.35em 0.8em 0.1em;
  }
  .empty {
    padding: 0.4em 0.8em;
  }
  input {
    margin: 0.4em;
    padding: 0.25em 0.5em;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--oc-hairline));
    border-radius: 3px;
  }
  .back {
    display: flex;
    align-items: center;
    gap: 0.35em;
    min-height: 26px;
    padding: 0.15em 0.8em;
    border-top: 1px solid var(--oc-hairline);
    font-size: 0.9em;
  }
  .back:hover {
    color: var(--oc-fg);
    background: var(--oc-hover);
  }
  .stale {
    font-size: 0.9em;
    padding: 0 0.8em 0.4em;
  }
  /* Touch: the rows and the Back button grow back to a comfortable target (they come after the sizes above, so they win).
     The extra height is shared above and below the text instead of staying under it. */
  @media (hover: none) {
    .row {
      align-items: center;
      min-height: 44px;
    }
    .back {
      min-height: 44px;
    }
  }
</style>
