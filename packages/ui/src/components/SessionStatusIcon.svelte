<script lang="ts">
  import type { SessionStatus } from "@occ/core/session-status"
  import Codicon from "./Codicon.svelte"

  /**
   * A session's status with the sessions pane's icons and colours: a spinner while it runs, a bell when it needs the
   * user, a red mark for a failed turn, a dot for an unread reply and a check once read. `quiet` leaves the read check
   * out, for places where every idle row would otherwise carry one (the tab strip).
   */
  let { status, quiet = false }: { status: SessionStatus; quiet?: boolean } = $props()
</script>

{#if !(quiet && status === "read")}
  <span class="state {status}">
    {#if status === "running"}<Codicon name="loading" spin />
    {:else if status === "waiting"}<Codicon name="bell-dot" />
    {:else if status === "failed"}<Codicon name="error" />
    {:else if status === "unread"}<Codicon name="circle-filled" />
    {:else}<Codicon name="check" />{/if}
  </span>
{/if}

<style>
  .state {
    display: inline-flex;
    flex: none;
    color: var(--oc-muted);
  }
  .state.waiting {
    color: var(--oc-amber);
  }
  .state.running,
  .state.unread {
    color: var(--oc-accent);
  }
  .state.failed {
    color: var(--oc-error);
  }
</style>
