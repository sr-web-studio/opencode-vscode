<script lang="ts">
  import { tick } from "svelte"
  import { cycleVariant, flattenModels, footerLabel, groupModels, sameModel } from "../../core/models"
  import type { AppState } from "../../core/protocol"
  import { useStore } from "../context"
  import { focusGuarded } from "../focus"

  let { app }: { app: AppState } = $props()
  const store = useStore()

  let popover = $state<"agent" | "model" | undefined>(undefined)
  let query = $state("")
  let index = $state(0)
  let search: HTMLInputElement | undefined = $state()
  let list: HTMLDivElement | undefined = $state()

  const label = $derived(footerLabel({ agent: app.agent, model: app.model, models: app.models }))
  const groups = $derived(groupModels({ models: app.models, providers: app.providers, query }))
  const flat = $derived(flattenModels(groups))

  async function show(which: "agent" | "model") {
    if (popover === which) return close()
    popover = which
    query = ""
    index = which === "agent" ? Math.max(0, app.agents.findIndex((a) => a.id === app.agent)) : Math.max(0, flat.findIndex((m) => sameModel(app.model, m)))
    await tick()
    if (which === "model") focusGuarded(search)
    else focusGuarded(list)
  }
  function close() { popover = undefined }

  function chooseAgent(id: string) { close(); store.dispatch({ type: "pickAgent", id }) }
  function chooseModel(id: string, providerID: string, variant?: string) {
    close()
    store.dispatch({ type: "pickModel", model: { id, providerID, variant } })
  }

  function onkey(e: KeyboardEvent) {
    const size = popover === "agent" ? app.agents.length : flat.length
    if (e.key === "Escape") { close(); e.preventDefault(); e.stopPropagation() }
    else if (e.key === "ArrowDown") { index = Math.min(size - 1, index + 1); e.preventDefault() }
    else if (e.key === "ArrowUp") { index = Math.max(0, index - 1); e.preventDefault() }
    else if (e.key === "Enter") {
      e.preventDefault()
      if (popover === "agent") { const a = app.agents[index]; if (a) chooseAgent(a.id) }
      else { const m = flat[index]; if (m) chooseModel(m.id, m.providerID, sameModel(app.model, m) ? app.model?.variant : undefined) }
    } else if (popover === "model" && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !query) {
      const m = flat[index]
      if (m && m.variants.length) {
        e.preventDefault()
        const v = cycleVariant(m, sameModel(app.model, m) ? app.model?.variant : undefined, e.key === "ArrowRight" ? 1 : -1)
        chooseModel(m.id, m.providerID, v)
      }
    }
  }
  $effect(() => { void query; index = 0 })
  $effect(() => {
    if (!popover) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".picker")) close() }
    window.addEventListener("mousedown", off)
    return () => window.removeEventListener("mousedown", off)
  })
  $effect(() => { void index; void tick().then(() => list?.querySelector(".sel")?.scrollIntoView({ block: "nearest" })) })
</script>

<div class="picker">
  <div class="foot muted">
    <button onclick={() => show("agent")} aria-haspopup="listbox" aria-expanded={popover === "agent"} title="Agent (Tab cycles)">{label.agent} ⌄</button>
    <span>·</span>
    <button onclick={() => show("model")} aria-haspopup="listbox" aria-expanded={popover === "model"} title="Model and variant">{label.model}{label.variant ? ` · ${label.variant}` : ""} ⌄</button>
  </div>

  {#if popover === "agent"}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="pop scroll" role="listbox" tabindex="0" bind:this={list} onkeydown={onkey}>
      {#each app.agents as a, i (a.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="row" class:sel={i === index} role="option" tabindex="-1" aria-selected={a.id === app.agent} onclick={() => chooseAgent(a.id)} onmousemove={() => (index = i)}>
          <span class="check">{a.id === app.agent ? "✓" : ""}</span>
          <span class="n">{a.name}</span>{#if a.description}<span class="muted d"> — {a.description}</span>{/if}
        </div>
      {:else}
        <div class="muted pad">No agents available</div>
      {/each}
    </div>
  {:else if popover === "model"}
    <div class="pop" role="presentation">
      <input bind:this={search} bind:value={query} onkeydown={onkey} placeholder="Search models" aria-label="Search models" />
      <div class="scroll body" role="listbox" bind:this={list}>
        {#each groups as g (g.providerID)}
          <div class="group muted">{g.providerName}</div>
          {#each g.models as m (m.id)}
            {@const i = flat.indexOf(m)}
            {@const current = sameModel(app.model, m)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="row" class:sel={i === index} role="option" tabindex="-1" aria-selected={current} onclick={() => chooseModel(m.id, m.providerID, current ? app.model?.variant : undefined)} onmousemove={() => (index = i)}>
              <span class="check">{current ? "✓" : ""}</span>
              <span class="n">{m.name}</span>
              <span class="vars">
                {#each m.variants as v (v.id)}
                  <button class="var" class:on={current && app.model?.variant === v.id} onclick={(e) => { e.stopPropagation(); chooseModel(m.id, m.providerID, v.id) }}>{v.id}</button>
                {/each}
              </span>
            </div>
          {/each}
        {:else}
          <div class="muted pad">{app.models.length ? "No matching models" : "No models available"}</div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .picker { position: relative; }
  .foot { display: flex; gap: 0.45em; align-items: baseline; font-size: 0.92em; }
  .foot button:hover { color: var(--oc-fg); }
  .pop { position: absolute; bottom: 100%; left: 0; z-index: 30; min-width: 18em; max-width: calc(100vw - 1.5em); margin-bottom: 0.3em; background: var(--oc-popover); border: 1px solid var(--oc-hairline); border-radius: 6px; box-shadow: 0 4px 16px var(--vscode-widget-shadow); max-height: 50vh; display: flex; flex-direction: column; overflow: hidden; outline: none; }
  .body { overflow-y: auto; padding-bottom: 0.3em; }
  input { margin: 0.45em; padding: 0.3em 0.5em; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--oc-hairline)); border-radius: 3px; }
  .group { font-size: 0.85em; padding: 0.45em 0.8em 0.1em; }
  .row { display: flex; align-items: baseline; gap: 0.4em; padding: 0.2em 0.8em; cursor: pointer; }
  .row.sel { background: var(--oc-hover); }
  .check { width: 1em; color: var(--oc-accent); flex: none; }
  .d { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { white-space: nowrap; }
  .vars { margin-left: auto; display: flex; gap: 0.5em; padding-left: 1em; }
  .var { color: var(--oc-muted); font-size: 0.92em; }
  .var:hover { color: var(--oc-fg); text-decoration: underline; }
  .var.on { color: var(--oc-accent); }
  .pad { padding: 0.6em 0.8em; }
</style>
