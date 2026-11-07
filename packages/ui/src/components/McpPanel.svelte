<script lang="ts">
  import { onMount } from "svelte"
  import { mcpActions, STATUS_TEXT, TOGGLE_NOTE, type McpRow } from "@occ/core/mcp"
  import type { AppState } from "@occ/core/protocol"
  import { useStore } from "../context"
  import { focusOpened, restoreFocus } from "../focus"
  import Codicon from "./Codicon.svelte"

  /**
   * The `/mcps` panel: a floating list above the prompt box (max 60% of the view), closed by Esc or a click outside it.
   * The user asked for it, so focus moves into it, and goes back to where it was when it closes. Everything it does is
   * an action to the controller; the panel holds no state of its own except that focus bookkeeping.
   */
  let { app, returnTo }: { app: AppState; returnTo?: HTMLElement } = $props()
  const store = useStore()
  const mcp = $derived(app.mcp)

  let panel: HTMLElement | undefined = $state()
  let before: Element | null = null

  const act = (op: "toggle" | "signIn" | "signOut", server: string) => store.dispatch({ type: "mcp", op, server })
  const close = () => store.dispatch({ type: "mcp", op: "close" })
  const busy = (r: McpRow) => mcp.busy.includes(r.name)
  const signing = (r: McpRow) => mcp.signIn?.server === r.name

  onMount(() => {
    before = document.activeElement
    const stop = focusOpened(() => panel)
    return () => {
      stop()
      // The prompt box went away (a question took its place): the panel must not keep refreshing unseen.
      if (mcp.open) close()
      // Back to where the user was; with no usable place, to the prompt.
      const target = before instanceof HTMLElement && before.isConnected && before !== document.body ? before : returnTo
      restoreFocus(target, panel)
    }
  })

  function outside(e: PointerEvent) {
    const t = e.target as Element | null
    if (t && !panel?.contains(t) && !t.closest(".mcp-keep")) close()
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close() }
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<div class="panel" bind:this={panel} role="dialog" aria-label="MCP servers" tabindex="-1">
  <div class="head">
    <span class="title">MCP servers</span>
    <span class="grow"></span>
    <button class="icon muted" onclick={() => store.dispatch({ type: "mcp", op: "refresh" })} title="Refresh" aria-label="Refresh MCP servers"><Codicon name="refresh" /></button>
    <button class="icon muted" onclick={close} title="Close (Esc)" aria-label="Close"><Codicon name="close" /></button>
  </div>
  {#if mcp.error}<div class="msg err" role="alert">{mcp.error}</div>{/if}
  {#if mcp.notice}<div class="msg warn" role="status">{mcp.notice}</div>{/if}
  <ul class="scroll">
    {#each mcp.servers as r (r.name)}
      {@const a = mcpActions(r)}
      <li class="row">
        <div class="line">
          <span class="dot {r.status}" aria-hidden="true"></span>
          <span class="name" title={r.title && r.title !== r.name ? r.name : undefined}>{r.title || r.name}</span>
          <span class="st {r.status}">{STATUS_TEXT[r.status]}</span>
        </div>
        {#if r.error}<div class="detail muted small">{r.error}</div>{/if}
        {#if signing(r)}
          <div class="detail small">
            <Codicon name="loading" spin />
            {#if mcp.signIn?.phase === "starting"}Contacting the server…
            {:else if mcp.signIn?.phase === "code"}Waiting for the code you paste in the VS Code box…
            {:else}Waiting for sign-in in your browser…{/if}
            <button class="btn" onclick={() => store.dispatch({ type: "mcp", op: "cancelSignIn" })}>Cancel</button>
          </div>
          {#if mcp.signIn?.instructions}<div class="detail muted small">{mcp.signIn.instructions}</div>{/if}
        {:else}
          <div class="acts">
            {#if a.spinner}<span class="muted small"><Codicon name="loading" spin /> Starting…</span>{/if}
            {#if a.toggle}
              <button
                class="switch"
                role="switch"
                aria-checked={a.toggle === "disconnect"}
                aria-label="{r.title || r.name} {a.toggle === 'disconnect' ? 'on' : 'off'}"
                disabled={busy(r)}
                title="{a.toggle === 'disconnect' ? 'Turn off' : 'Turn on'}. {TOGGLE_NOTE}"
                onclick={() => act("toggle", r.name)}
              ><span class="knob"></span></button>
              {#if busy(r)}<Codicon name="loading" spin />{/if}
            {/if}
            {#if a.signIn}<button class="btn" disabled={!!mcp.signIn} onclick={() => act("signIn", r.name)}><Codicon name="sign-in" /> Sign in</button>{/if}
            {#if a.signOut}<button class="btn" disabled={busy(r)} onclick={() => act("signOut", r.name)}><Codicon name="sign-out" /> Sign out</button>{/if}
          </div>
        {/if}
      </li>
    {:else}
      <li class="empty muted">{mcp.loading || !mcp.loaded ? "Loading…" : "No MCP servers are set up for this project. OpenCode reads them from its own config."}</li>
    {/each}
  </ul>
  <div class="foot">
    <!-- mousedown is cancelled so the click never moves focus off the prompt box; the editor that opens takes it. -->
    <button class="link edit" onmousedown={(e) => e.preventDefault()} onclick={() => store.bridge.postToHost({ type: "host", request: { type: "openGlobalConfig" } })} title="Open your global OpenCode config file in the editor. This extension never edits it."><Codicon name="settings-gear" /> Edit config</button>
  </div>
</div>

<style>
  .panel { position: absolute; z-index: 25; left: 0; right: 0; bottom: calc(100% + 4px); max-height: 60vh; display: flex; flex-direction: column; outline: none; background: var(--oc-popover); border: 1px solid var(--oc-hairline); border-radius: 6px; box-shadow: 0 4px 16px var(--vscode-widget-shadow); }
  .head { display: flex; align-items: center; gap: 0.2em; padding: 0.3em 0.4em 0.2em 0.8em; }
  .title { font-weight: 600; }
  .grow { flex: 1; }
  .icon { display: inline-flex; padding: 0.25em; border-radius: 4px; }
  .icon:hover { color: var(--oc-fg); background: var(--oc-hover); }
  .msg { padding: 0.2em 0.8em 0.3em; font-size: 0.95em; overflow-wrap: anywhere; }
  .msg.warn { color: var(--oc-amber); }
  ul { list-style: none; margin: 0; padding: 0 0 0.3em; overflow-y: auto; min-height: 0; }
  .row { padding: 0.35em 0.8em; border-top: 1px solid var(--oc-hairline); display: flex; flex-direction: column; gap: 0.2em; }
  .line { display: flex; align-items: baseline; gap: 0.5em; min-width: 0; }
  .name { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st { font-size: 0.9em; white-space: nowrap; color: var(--oc-muted); }
  .st.connected { color: var(--oc-ok); }
  .st.failed { color: var(--oc-error); }
  .st.needs_auth { color: var(--oc-amber); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; background: var(--oc-muted); }
  .dot.connected { background: var(--oc-ok); }
  .dot.failed { background: var(--oc-error); }
  .dot.needs_auth { background: var(--oc-amber); }
  .dot.pending { background: transparent; border: 1.5px solid var(--oc-muted); border-top-color: transparent; animation: oc-spin 0.9s linear infinite; }
  .dot.disabled { background: transparent; border: 1.5px solid var(--oc-muted); }
  .detail { padding-left: calc(8px + 0.5em); overflow-wrap: anywhere; white-space: pre-wrap; }
  .acts { display: flex; align-items: center; gap: 0.6em; flex-wrap: wrap; padding-left: calc(8px + 0.5em); min-height: 22px; }
  .btn { display: inline-flex; align-items: center; gap: 0.3em; padding: 0.05em 0.6em; border: 1px solid var(--oc-hairline); border-radius: 4px; }
  .btn:hover:not(:disabled) { background: var(--oc-hover); }
  .switch { position: relative; width: 30px; height: 16px; border-radius: 8px; border: 1px solid var(--oc-hairline); background: var(--vscode-input-background); flex: none; }
  .switch[aria-checked="true"] { background: var(--vscode-button-background); border-color: transparent; }
  .knob { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--oc-muted); transition: transform 0.12s; }
  .switch[aria-checked="true"] .knob { transform: translateX(14px); background: var(--vscode-button-foreground); }
  @media (prefers-reduced-motion: reduce) { .knob { transition: none; } .dot.pending { animation-duration: 3s; } }
  .empty { padding: 0.5em 0.8em; }
  .foot { padding: 0.25em 0.8em 0.35em; border-top: 1px solid var(--oc-hairline); font-size: 0.95em; }
  .edit { display: inline-flex; align-items: center; gap: 0.35em; padding: 0; background: none; border: 0; font: inherit; }
</style>
