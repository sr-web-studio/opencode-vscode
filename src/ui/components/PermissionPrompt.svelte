<script lang="ts">
  import type { PermissionRequest } from "../../core/api"
  import { useStore } from "../context"

  let { request }: { request: PermissionRequest } = $props()
  const store = useStore()
  let sent = $state(false)

  function reply(decision: "once" | "always" | "reject") {
    if (sent) return
    sent = true
    store.dispatch({ type: "permission", sessionID: request.sessionID, requestID: request.id, decision })
  }
</script>

<span class="perm" role="group" aria-label="Permission request">
  <button class="accent allow" disabled={sent} onclick={() => reply("once")} title="Allow once">Allow</button>
  <span class="muted">·</span>
  <button class="muted" disabled={sent} onclick={() => reply("always")} title="Always allow this">Always</button>
  <span class="muted">·</span>
  <button class="muted" disabled={sent} onclick={() => reply("reject")} title="Deny">Deny</button>
</span>

<style>
  .perm { display: inline-flex; gap: 0.4em; align-items: baseline; font-size: 0.92em; }
  .perm button:hover:not(:disabled) { text-decoration: underline; color: var(--oc-fg); }
  .perm .allow:hover:not(:disabled) { color: var(--oc-accent); }
</style>
