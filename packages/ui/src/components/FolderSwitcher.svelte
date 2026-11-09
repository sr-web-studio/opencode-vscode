<script lang="ts">
  import { tick } from "svelte"
  import type { AppState } from "@occ/core/protocol"
  import { useStore } from "../context"
  import { focusGuarded } from "../focus"
  import Codicon from "./Codicon.svelte"

  /**
   * The workspace folder the chat view shows. Only rendered for a VS Code window with two or more folders: the host
   * sends `AppState.folders` only then, and the Android app never sends it.
   */
  let { app }: { app: AppState } = $props()
  const store = useStore()

  const folders = $derived(app.folders ?? [])
  const active = $derived(folders.find((f) => f.active) ?? folders[0])
  let open = $state(false)
  let index = $state(0)
  let list: HTMLDivElement | undefined = $state()

  async function toggle() {
    open = !open
    if (!open) return
    index = Math.max(
      0,
      folders.findIndex((f) => f.active),
    )
    await tick()
    focusGuarded(list)
  }

  function pick(directory: string) {
    open = false
    if (directory !== active?.directory) store.dispatch({ type: "switchFolder", directory })
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      open = false
      e.preventDefault()
    } else if (e.key === "ArrowDown") {
      index = Math.min(folders.length - 1, index + 1)
      e.preventDefault()
    } else if (e.key === "ArrowUp") {
      index = Math.max(0, index - 1)
      e.preventDefault()
    } else if (e.key === "Enter") {
      const folder = folders[index]
      if (folder) pick(folder.directory)
      e.preventDefault()
    }
  }

  $effect(() => {
    if (!open) return
    const off = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".folders")) open = false
    }
    window.addEventListener("mousedown", off)
    return () => window.removeEventListener("mousedown", off)
  })
</script>

{#if folders.length > 1}
  <header class="folders">
    <button class="current" onclick={toggle} onkeydown={onkey} aria-haspopup="listbox" aria-expanded={open} title="Switch workspace folder">
      <Codicon name="folder" />
      <span class="name">{active?.name ?? "Folder"}</span>
      <span class="muted"><Codicon name="chevron-down" /></span>
    </button>

    {#if open}
      <div class="drop" role="presentation">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="list" role="listbox" aria-label="Workspace folders" bind:this={list} tabindex="-1" onkeydown={onkey}>
          {#each folders as folder, i (folder.directory)}
            <div class="row" class:sel={i === index} role="option" aria-selected={folder.active} tabindex="-1" onclick={() => pick(folder.directory)} onmousemove={() => (index = i)}>
              <span class="dot" class:run={folder.busy} class:wait={folder.attention} title={folder.attention ? "Waiting for you" : folder.busy ? "Running" : ""}></span>
              <span class="t">{folder.name}</span>
              {#if folder.active}<span class="check"><Codicon name="check" /></span>{/if}
              <span class="path muted" title={folder.directory}>{folder.displayPath}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </header>
{/if}

<style>
  .folders {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0.2em var(--oc-side);
    border-bottom: 1px solid var(--oc-hairline);
  }
  .current {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.15em 0.3em;
    margin-left: -0.3em;
    border-radius: 4px;
    font-size: 0.9em;
    color: var(--oc-muted);
  }
  .current:hover,
  .current[aria-expanded="true"] {
    color: var(--oc-fg);
    background: var(--oc-hover);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drop {
    position: absolute;
    z-index: 20;
    left: 0.6em;
    right: 0.6em;
    top: 100%;
    background: var(--oc-popover);
    border: 1px solid var(--oc-hairline);
    border-radius: 6px;
    box-shadow: 0 4px 16px var(--vscode-widget-shadow);
    display: flex;
    flex-direction: column;
    max-height: 60vh;
  }
  .list {
    overflow-y: auto;
    padding-bottom: 0.3em;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    min-height: 28px;
    padding: 0.1em var(--oc-side);
    cursor: pointer;
  }
  .row.sel {
    background: var(--oc-hover);
  }
  .t {
    flex: none;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9em;
    text-align: right;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
  }
  .dot.run {
    background: var(--oc-accent);
  }
  .dot.wait {
    background: var(--oc-amber);
  }
  .check {
    color: var(--oc-accent);
    display: inline-flex;
    flex: none;
  }
</style>
