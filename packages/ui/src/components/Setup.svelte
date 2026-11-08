<script lang="ts">
  import type { ConnectionState } from "@occ/core/protocol"
  import { useStore } from "../context"

  let { connection }: { connection: ConnectionState } = $props()
  const store = useStore()
</script>

<div class="setup">
  {#if connection.status === "setup" && connection.reason === "folder"}
    <div class="h">Open a folder</div>
    <p class="muted">OpenCode works on a project. Open a folder in VS Code to start.</p>
  {:else if connection.status === "setup"}
    <div class="h">OpenCode is not installed</div>
    <p class="muted">{connection.message ?? "The opencode command was not found."}</p>
    <div class="links">
      <button class="link" onclick={() => store.bridge.openExternal("https://opencode.ai")}>Install instructions</button>
      <button class="link" onclick={() => store.bridge.postToHost({ type: "host", request: { type: "setCliPath" } })}>Set CLI path</button>
      <button class="link" onclick={() => store.bridge.postToHost({ type: "host", request: { type: "reconnect" } })}>Try again</button>
    </div>
  {:else if connection.status === "error" || connection.status === "disconnected"}
    <div class="h">{connection.status === "error" ? "Cannot reach OpenCode" : "Reconnecting…"}</div>
    {#if connection.message}<p class="muted">{connection.message}</p>{/if}
    <div class="links"><button class="link" onclick={() => store.bridge.postToHost({ type: "host", request: { type: "reconnect" } })}>Try again</button></div>
  {:else}
    <div class="muted"><span class="spinner"></span> Connecting to OpenCode…</div>
  {/if}
</div>

<style>
  .setup { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 0.4em; padding: 1.5em; }
  .h { font-weight: 600; font-size: 1.1em; }
  p { margin: 0; max-width: 26em; }
  .links { display: flex; gap: 1.2em; margin-top: 0.8em; flex-wrap: wrap; justify-content: center; }
  .muted { display: flex; align-items: center; gap: 0.5em; }
</style>
