<script lang="ts" generics="T extends InboxItem">
  import { onDestroy } from "svelte"
  import type { Snippet } from "svelte"
  import { clampInboxHeight, INBOX_SIZING, inboxDefaultHeight, inboxHeightRange, stepInboxHeight, type InboxItem, type InboxRow, type InboxSizing } from "@occ/core/sessions-inbox"
  import Codicon from "./Codicon.svelte"

  /**
   * The "Active" section at the bottom of a multi-project sessions list: the sessions that need the user and the
   * newest ones, from every project. The header collapses it, and the handle above it resizes it.
   *
   * The rows themselves are drawn by the caller's snippet, so an inbox row is exactly the row the project list draws:
   * same status icon, title, time, rename and delete. This component owns the section frame, collapsing and the
   * handle.
   *
   * The handle is a real ARIA separator: focus it and Up/Down resize (Shift for larger steps), a double-click goes back
   * to the default, and a pointer drag resizes it without selecting text.
   */
  let {
    rows,
    collapsed,
    height,
    viewHeight,
    sizing = INBOX_SIZING,
    ontoggle,
    onheight,
    oncommit,
    row,
  }: {
    rows: readonly InboxRow<T>[]
    collapsed: boolean
    /** The height the user chose, already clamped by the caller. */
    height: number
    /** The height the project list, the handle and this section share. */
    viewHeight: number
    sizing?: InboxSizing
    ontoggle: () => void
    /** Move the section while the pointer is down; the caller keeps this out of its saved state. */
    onheight: (height: number) => void
    /** Keep the height: a finished drag, an arrow key or a double-click. */
    oncommit: (height: number) => void
    row: Snippet<[InboxRow<T>]>
  } = $props()

  const range = $derived(inboxHeightRange(viewHeight, sizing))

  let sash: HTMLDivElement | undefined = $state()
  let drag: { pointer: number; startY: number; startHeight: number } | undefined
  let dragging = $state(false)
  /** The drag's latest height, applied once per animation frame so a fast pointer never relayouts twice in a frame. */
  let pending = 0
  let frame = 0

  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return
    // No text selection and no focus change: the pointer capture below keeps the drag on the handle.
    e.preventDefault()
    drag = { pointer: e.pointerId, startY: e.clientY, startHeight: height }
    pending = height
    dragging = true
    sash?.setPointerCapture(e.pointerId)
    document.body.style.userSelect = "none"
    document.body.style.cursor = "row-resize"
  }

  function moveDrag(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointer) return
    // The inbox sits below the list, so dragging towards the top makes it taller.
    pending = clampInboxHeight(drag.startHeight + drag.startY - e.clientY, viewHeight, sizing)
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      onheight(pending)
    })
  }

  function endDrag(): void {
    if (!drag) return
    drag = undefined
    dragging = false
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    // Persist once, on release: the frames in between only move the section.
    oncommit(pending)
    document.body.style.userSelect = ""
    document.body.style.cursor = ""
  }

  function sashKey(e: KeyboardEvent): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    e.preventDefault()
    // Arrows on the handle resize the section; they must not also walk the list behind it.
    e.stopPropagation()
    const next = stepInboxHeight(height, e.key === "ArrowUp" ? 1 : -1, viewHeight, e.shiftKey, sizing)
    onheight(next)
    oncommit(next)
  }

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame)
    if (!drag) return
    drag = undefined
    document.body.style.userSelect = ""
    document.body.style.cursor = ""
  })
</script>

{#if !collapsed}
  <!-- A resize sash is a real ARIA separator widget: focusable, with a value, and resized by the arrow keys. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="sash"
    class:dragging
    role="separator"
    tabindex="0"
    aria-orientation="horizontal"
    aria-label="Resize active sessions"
    aria-valuenow={height}
    aria-valuemin={range.min}
    aria-valuemax={range.max}
    aria-valuetext={`${height} pixels`}
    title="Drag to resize, double-click to reset"
    bind:this={sash}
    onpointerdown={startDrag}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onlostpointercapture={endDrag}
    onkeydown={sashKey}
    ondblclick={() => {
      const next = clampInboxHeight(inboxDefaultHeight(sizing), viewHeight, sizing)
      onheight(next)
      oncommit(next)
    }}
  ></div>
{/if}

<section class="inbox" class:collapsed style:--oc-inbox-height={`${height}px`} aria-label="Active sessions">
  <button class="ihead" onclick={ontoggle} aria-expanded={!collapsed} title={collapsed ? "Expand active sessions" : "Collapse active sessions"}>
    <span class="chev"><Codicon name={collapsed ? "chevron-right" : "chevron-down"} /></span>
    <span class="itext">Active ({rows.length})</span>
  </button>
  {#if !collapsed}
    <div class="ilist" role="listbox" aria-label="Active sessions">
      {#each rows as entry (entry.id)}
        {@render row(entry)}
      {/each}
    </div>
  {/if}
</section>

<style>
  /* The handle takes its own 6 px row above the section, like the pane's vertical sash takes a strip beside it. */
  .sash {
    flex: none;
    position: relative;
    z-index: 5;
    height: 6px;
    cursor: row-resize;
    touch-action: none;
    background: transparent;
  }
  /* Only the 1 px line shows, as VS Code's sashes do; the 6 px around it stay an invisible grab area. */
  .sash::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    transform: translateY(-50%);
    background: transparent;
  }
  .sash:hover::after,
  .sash.dragging::after,
  .sash:focus-visible::after {
    background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
  }
  /* The line is this handle's focus indicator; the browser's ring would draw a box around the invisible strip. */
  .sash:focus-visible {
    outline: none;
  }
  .sash:focus-visible::after {
    height: 2px;
  }
  .inbox {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* The section keeps the height the user dragged it to, empty room included, and scrolls inside past that. */
    height: var(--oc-inbox-height);
    border-top: 1px solid var(--oc-hairline);
  }
  /* Folded away, only the header remains, whatever height was chosen. */
  .inbox.collapsed {
    height: auto;
  }
  .ihead {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.3em;
    width: 100%;
    padding: 0.3em 0.3em 0.3em 0.55em;
    text-align: left;
    font-weight: 600;
    border-radius: 4px;
  }
  .ihead:hover {
    background: var(--oc-hover);
  }
  .chev {
    display: inline-flex;
    flex: none;
    color: var(--oc-muted);
  }
  .itext {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ilist {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 0.25em;
  }
  /*
   * An inbox row already carries a project name, so its rename and delete buttons wait for hover or keyboard focus:
   * the title keeps their width instead of being cut to "Ship the s…". The project list above keeps its own rows as
   * they are, because these rules only reach inside this section.
   */
  .inbox :global(.row .icon.ren),
  .inbox :global(.row .icon.del) {
    display: none;
  }
  .inbox :global(.row:hover .icon.ren),
  .inbox :global(.row:hover .icon.del),
  .inbox :global(.row:focus-within .icon.ren),
  .inbox :global(.row:focus-within .icon.del) {
    display: inline-flex;
  }
</style>
