<script lang="ts">
  import type { ConnectionState } from "@occ/core/protocol"

  /** The server connection in the header: connected, or reconnecting. */
  let { connection }: { connection: ConnectionState | undefined } = $props()
  const on = $derived(connection?.status === "connected")
  const label = $derived(on ? "Connected" : connection?.status === "error" ? "Offline" : connection?.status === "connecting" || !connection ? "Connecting…" : "Reconnecting…")
</script>

<span class="pill" class:on class:off={!on} role="status" title={connection?.message}><i></i>{label}</span>
