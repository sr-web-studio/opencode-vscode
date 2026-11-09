<script lang="ts">
  import { onDestroy, onMount } from "svelte"
  import App from "@occ/ui/App.svelte"
  import { WorkerTab } from "@occ/core/worker-tab"
  import Bar from "../components/Bar.svelte"
  import { createBridge } from "../lib/bridge"
  import { liveState } from "../lib/live.svelte"
  import { model } from "../model.svelte"

  /** A worker (child session) of the chat: its transcript streams live and there is no prompt box (read-only). */
  let { directory, sessionID }: { directory: string; sessionID: string } = $props()

  // svelte-ignore state_referenced_locally
  const ctl = model.controller(directory)
  // svelte-ignore state_referenced_locally
  const tab = new WorkerTab(ctl, sessionID)
  const live = liveState(tab)
  const bridge = createBridge(
    { subscribe: (l) => tab.subscribe(l), dispatch: (a) => tab.dispatch(a), sessionID: () => sessionID, isWorker: () => true },
    // svelte-ignore state_referenced_locally
    model.hostFor(directory),
    localStorage,
  )

  onMount(() => void tab.start())
  onDestroy(() => tab.dispose())
</script>

<Bar title={tab.title} sub="Worker · read-only">
  {#snippet actions()}
    <span></span>
  {/snippet}
</Bar>

<div class="chat grow">
  <App {bridge} workerForm />
</div>

<style>
  .grow {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grow > :global(*) {
    flex: 1;
    min-height: 0;
  }
</style>
