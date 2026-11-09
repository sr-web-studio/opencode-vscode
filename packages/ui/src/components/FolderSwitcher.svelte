<script lang="ts">
  import { tick } from "svelte"
  import type { AppState, FolderInfo } from "@occ/core/protocol"
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
  /** The row the keyboard is on; clamped when a folder disappears while the list is open. */
  const highlighted = $derived(Math.min(index, Math.max(0, folders.length - 1)))
  let list: HTMLDivElement | undefined = $state()
  let trigger: HTMLButtonElement | undefined = $state()
  const LIST_ID = "oc-folders"
  const optionID = (i: number) => `${LIST_ID}-${i}`

  async function openList() {
    if (open) return
    open = true
    index = Math.max(
      0,
      folders.findIndex((f) => f.active),
    )
    await tick()
    focusGuarded(list)
  }

  async function closeList(refocus = true) {
    if (!open) return
    open = false
    if (refocus) {
      await tick()
      focusGuarded(trigger)
    }
  }

  async function pick(directory: string) {
    await closeList()
    if (directory !== active?.directory) store.dispatch({ type: "switchFolder", directory })
  }

  /** The name OpenCode knows for the project, else the workspace folder's own name. */
  const label = (folder: FolderInfo | undefined) => folder?.projectName ?? folder?.name ?? "Folder"

  /** The pencil: the host asks for the new name and saves it on the server. */
  function rename(folder: FolderInfo) {
    void closeList(false)
    store.bridge.renameProject?.(folder.directory)
  }

  // The trigger opens on Enter/Space (its native click) and ArrowDown; Escape closes it.
  function triggerKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      void openList()
    } else if (e.key === "Escape" && open) {
      e.preventDefault()
      void closeList()
    }
  }

  // Choosing and moving only work while the list is open and focused.
  function listKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      void closeList()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      index = Math.min(folders.length - 1, index + 1)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      index = Math.max(0, index - 1)
    } else if (e.key === "Home") {
      e.preventDefault()
      index = 0
    } else if (e.key === "End") {
      e.preventDefault()
      index = Math.max(0, folders.length - 1)
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      const folder = folders[highlighted]
      if (folder) void pick(folder.directory)
    }
  }

  $effect(() => {
    if (!open) return
    const off = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".folders")) void closeList(false)
    }
    window.addEventListener("mousedown", off)
    return () => window.removeEventListener("mousedown", off)
  })
</script>

{#if folders.length > 1}
  <header class="folders">
    <button
      bind:this={trigger}
      class="current"
      onclick={() => (open ? void closeList() : void openList())}
      onkeydown={triggerKey}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? LIST_ID : undefined}
      title={active ? (active.projectName ? `${active.projectName} — ${active.name} (${active.directory})` : active.directory) : "Switch workspace folder"}
    >
      <Codicon name="folder" />
      <span class="name">{label(active)}</span>
      <span class="muted"><Codicon name="chevron-down" /></span>
    </button>

    {#if open}
      <div class="drop" role="presentation">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="list"
          id={LIST_ID}
          role="listbox"
          aria-label="Workspace folders"
          bind:this={list}
          tabindex="-1"
          aria-activedescendant={folders.length > 0 ? optionID(highlighted) : undefined}
          onkeydown={listKey}
        >
          {#each folders as folder, i (folder.directory)}
            <div
              id={optionID(i)}
              class="row"
              class:sel={i === highlighted}
              role="option"
              aria-selected={i === highlighted}
              aria-current={folder.active ? "true" : undefined}
              tabindex="-1"
              onclick={() => pick(folder.directory)}
              onmousemove={() => (index = i)}
            >
              <span class="dot" class:run={folder.busy} class:wait={folder.attention} title={folder.attention ? "Waiting for you" : folder.busy ? "Running" : ""}></span>
              <span class="t" title={folder.projectName ? `${folder.projectName} (${folder.name})` : folder.name}>{label(folder)}</span>
              {#if folder.active}<span class="check"><Codicon name="check" /></span>{/if}
              <span class="path muted" title={folder.projectName ? `${folder.name} — ${folder.directory}` : folder.directory}>{folder.displayPath}</span>
              {#if store.bridge.renameProject}
                <button
                  class="rename"
                  title="Rename project…"
                  aria-label={`Rename the OpenCode project of ${label(folder)}`}
                  onclick={(e) => {
                    e.stopPropagation()
                    rename(folder)
                  }}
                  onkeydown={(e) => e.stopPropagation()}
                >
                  <Codicon name="edit" />
                </button>
              {/if}
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
    padding: 0.4em var(--oc-side);
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
    font-weight: 600;
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
  .rename {
    display: inline-flex;
    flex: none;
    padding: 0.15em;
    border-radius: 4px;
    color: var(--oc-muted);
  }
  .rename:hover {
    color: var(--oc-fg);
    background: var(--oc-hover);
  }
</style>
