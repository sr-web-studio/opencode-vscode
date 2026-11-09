<script lang="ts">
  import App from "@occ/ui/App.svelte"
  import Bar from "../components/Bar.svelte"
  import ConnectionPill from "../components/ConnectionPill.svelte"
  import { createBridge } from "../lib/bridge"
  import { liveState } from "../lib/live.svelte"
  import { model } from "../model.svelte"

  /**
   * The chat of one project: the same `App.svelte` as the VS Code sidebar, with the controller running in this app and
   * an in-process bridge. The controller belongs to the project (not to this screen), and is disposed when the last screen
   * of the project closes.
   */
  let { directory, sessionID, draft, screenKey }: { directory: string; sessionID?: string; draft?: boolean; screenKey: number } = $props()

  // svelte-ignore state_referenced_locally
  const ctl = model.controller(directory)
  const live = liveState(ctl)
  const bridge = createBridge(
    {
      subscribe: (l) => ctl.subscribe(l),
      dispatch: (a) => ctl.dispatch(a),
      sessionID: () => ctl.currentSessionID,
      // A worker (child session) is read-only, whatever the caller asked for.
      isWorker: (id) => !!ctl.sessionMeta(id)?.parentID,
    },
    // svelte-ignore state_referenced_locally
    model.hostFor(directory),
    localStorage,
  )

  // The controller's first sync picks the newest session; ask for ours only after it, or the sync would undo it.
  let opened = false
  $effect(() => {
    if (opened || !model.isSynced(directory)) return
    opened = true
    if (sessionID) void model.openChatSession(ctl, directory, sessionID, screenKey)
    else if (draft) void ctl.dispatch({ type: "newDraft", hasText: false })
  })

  const title = $derived.by(() => {
    const st = live.state
    if (!st) return "Chat"
    if (st.target.kind === "draft") return "New session"
    const id = st.target.id
    return st.sessions.find((s) => s.id === id)?.title?.trim() || st.folderName || "Chat"
  })
  // The project's OpenCode name and the folder: the header says which project this conversation belongs to.
  const sub = $derived([model.projectTitle(directory), live.state?.displayPath].filter((s): s is string => !!s).join(" · "))
</script>

<Bar {title} {sub} menu>
  {#snippet actions()}
    <ConnectionPill connection={live.state?.connection} />
  {/snippet}
</Bar>

<div class="chat grow">
  <App {bridge} />
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
