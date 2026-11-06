<script lang="ts">
  import { tick } from "svelte"
  import { cycleAgent } from "../../core/models"
  import type { AppState } from "../../core/protocol"
  import { isRunning } from "../../core/transcript/reducer"
  import { useStore } from "../context"
  import AgentModelPicker from "./AgentModelPicker.svelte"

  let { app, text = $bindable() }: { app: AppState; text: string } = $props()
  const store = useStore()

  let area: HTMLTextAreaElement | undefined = $state()
  const running = $derived(isRunning(app.view) || (app.target.kind === "session" && app.running.includes(app.target.id)))
  const canSend = $derived(text.trim().length > 0 && app.connection.status === "connected" && !app.sending)

  function resize() {
    if (!area) return
    area.style.height = "auto"
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`
  }
  export function focus() { area?.focus() }

  function send() {
    if (!canSend) return
    store.dispatch({ type: "send", text })
    text = ""
    void tick().then(resize)
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
    else if (e.key === "Tab" && !e.shiftKey && text === "" && app.agents.length > 1) {
      e.preventDefault()
      const next = cycleAgent(app.agents.map((a) => a.id), app.agent)
      if (next && next !== app.agent) store.dispatch({ type: "pickAgent", id: next })
    } else if (e.key === "Escape" && running) { store.dispatch({ type: "stop" }) }
  }

  $effect(() => { void text; void tick().then(resize) })
  // `+` inside an empty draft only focuses the input; a fresh draft focuses it as well.
  $effect(() => { void app.focusTick; void app.draftEpoch; void tick().then(() => area?.focus()) })
</script>

<div class="box">
  <div class="input">
    <textarea bind:this={area} bind:value={text} {onkeydown} rows="1" placeholder={running ? "Send a message (queued while OpenCode works)" : "Ask OpenCode"} aria-label="Message"></textarea>
    {#if running}
      <button class="stop" onclick={() => store.dispatch({ type: "stop" })} title="Stop (Esc)" aria-label="Stop"><span class="sq"></span></button>
    {/if}
    <button class="send" onclick={send} disabled={!canSend} title="Send (Enter)" aria-label="Send">↑</button>
  </div>
  <AgentModelPicker {app} />
</div>

<style>
  .box { padding: 0.3em 0.9em 0.7em; display: flex; flex-direction: column; gap: 0.35em; }
  .input { display: flex; align-items: flex-end; gap: 0.4em; border: 1px solid var(--vscode-input-border, var(--oc-hairline)); background: var(--vscode-input-background); border-radius: 6px; padding: 0.35em 0.5em; }
  .input:focus-within { border-color: var(--vscode-focusBorder); }
  textarea { flex: 1; resize: none; border: none; outline: none; background: transparent; line-height: 1.45; max-height: 200px; padding: 0; min-width: 0; }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  .send { width: 1.6em; height: 1.6em; border-radius: 50%; background: var(--vscode-button-background); color: var(--vscode-button-foreground); display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .send:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .stop { width: 1.6em; height: 1.6em; border-radius: 50%; border: 1px solid var(--oc-muted); display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .stop:hover { border-color: var(--oc-fg); }
  .sq { width: 0.55em; height: 0.55em; background: var(--oc-fg); border-radius: 1px; }
</style>
