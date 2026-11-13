<script lang="ts">
  import App from "@occ/ui/App.svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import type { AppState } from "@occ/core/protocol"
  import Bar from "../components/Bar.svelte"
  import ConnectionPill from "../components/ConnectionPill.svelte"
  import { createBridge } from "../lib/bridge"
  import { onPause } from "../lib/platform"
  import { liveState } from "../lib/live.svelte"
  import { chatVisible, CHAT_OPEN_TIMEOUT_MS } from "../lib/start"
  import { model } from "../model.svelte"

  /**
   * The chat of one project: the same `App.svelte` as the VS Code sidebar, with the controller running in this app and
   * an in-process bridge. The controller belongs to the project (not to this screen), and is disposed when the last screen
   * of the project closes.
   */
  let { directory, sessionID, draft, title: titleHint, screenKey }: { directory: string; sessionID?: string; draft?: boolean; title?: string; screenKey: number } = $props()

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
    undefined,
    // Android tells us when the app is paused; the draft is saved then, before the system may kill the view.
    (handler) => onPause(handler),
  )

  // The controller's first sync picks the newest session; ask for ours only after it, or the sync would undo it.
  let opened = false
  $effect(() => {
    if (opened || !model.isSynced(directory)) return
    opened = true
    if (sessionID) void model.openChatSession(ctl, directory, sessionID, screenKey)
    else if (draft) void ctl.dispatch({ type: "newDraft", hasText: false })
  })

  /** The controller is showing the session this screen was opened with. */
  const onSession = (s: AppState | undefined): boolean => !!sessionID && s?.target.kind === "session" && s.target.id === sessionID

  /**
   * The shared chat renders only once the controller is on the session this screen asked for. Before that its target is
   * the remembered or newest session, or a draft, and a draft would flash "New session" and the empty state first.
   *
   * That is a wait before the first arrival, not a permanent rule: `arrived` remembers that the controller got here, so
   * everything the owner does afterwards (the chat's own `+`, `/fork`, a session deleted elsewhere) moves the same chat
   * and stays visible. `expired` ends the wait when the session never arrives at all, so the screen cannot spin forever.
   */
  // svelte-ignore state_referenced_locally
  let arrived = $state(onSession(live.state))
  let expired = $state(false)
  $effect(() => {
    if (arrived || onSession(live.state)) arrived = true
  })
  $effect(() => {
    if (!sessionID || arrived || expired) return
    const timer = setTimeout(() => (expired = true), CHAT_OPEN_TIMEOUT_MS)
    return () => clearTimeout(timer)
  })
  const onTarget = $derived(chatVisible({ sessionID, arrived, expired }))

  const title = $derived.by(() => {
    const st = live.state
    // Until the controller is on the session, the name the caller knew (a link, the drawer, the last start) is right.
    if (!onTarget) return titleHint ?? "Chat"
    if (!st) return titleHint ?? "Chat"
    if (st.target.kind === "draft") return "New session"
    const id = st.target.id
    const name = st.sessions.find((s) => s.id === id)?.title?.trim()
    // The session this screen was opened with keeps the name the caller knew until its own title arrives.
    if (id === sessionID) return name || titleHint || st.folderName || "Chat"
    return name || st.folderName || "Chat"
  })
  // The project's OpenCode name and the folder: the header says which project this conversation belongs to.
  const sub = $derived([model.projectTitle(directory), live.state?.displayPath].filter((s): s is string => !!s).join(" · "))
</script>

<Bar {title} {sub} menu back={model.stack.length > 1}>
  {#snippet actions()}
    <ConnectionPill connection={live.state?.connection} />
  {/snippet}
</Bar>

{#if onTarget}
  <div class="chat grow">
    <App {bridge} />
  </div>
{:else}
  <div class="body">
    <div class="center muted"><Codicon name="loading" spin /> Loading…</div>
  </div>
{/if}

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
