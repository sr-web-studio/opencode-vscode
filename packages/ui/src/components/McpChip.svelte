<script lang="ts">
  import { mcpSummary } from "@occ/core/mcp"
  import type { AppState } from "@occ/core/protocol"
  import { useStore } from "../context"
  import Codicon from "./Codicon.svelte"

  /** `plug 7 MCP` in the prompt footer, like the TUI's status line. Failed servers turn it red, sign-ins amber. */
  let { app }: { app: AppState } = $props()
  const store = useStore()

  const sum = $derived(mcpSummary(app.mcp.servers))
  const tip = $derived(
    `${sum.connected} of ${sum.total} MCP servers connected` + (sum.failed ? `, ${sum.failed} failed` : "") + (sum.needsAuth ? `, ${sum.needsAuth} need sign-in` : ""),
  )
</script>

{#if sum.total > 0}
  <button
    class="chip mcp-keep"
    class:bad={sum.failed > 0}
    class:warn={sum.failed === 0 && sum.needsAuth > 0}
    class:on={app.mcp.open}
    onclick={() => store.dispatch({ type: "mcp", op: app.mcp.open ? "close" : "open" })}
    aria-haspopup="dialog"
    aria-expanded={app.mcp.open}
    title={tip}
    aria-label="MCP servers: {tip}"
  >
    <Codicon name="plug" />
    <span>{sum.total} MCP{#if sum.failed}<span class="n">· {sum.failed} failed</span>{:else if sum.needsAuth}<span class="n">· {sum.needsAuth} to sign in</span>{/if}</span>
  </button>
{/if}

<style>
  .chip { display: inline-flex; align-items: center; gap: 0.3em; flex: none; color: var(--oc-muted); white-space: nowrap; }
  .chip:hover, .chip.on { color: var(--oc-fg); }
  .chip.bad { color: var(--oc-error); }
  .chip.warn { color: var(--oc-amber); }
  .n { margin-left: 0.35em; }
</style>
