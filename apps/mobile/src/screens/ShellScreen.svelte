<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { ansiToSpans, cssColor, type AnsiSpan } from "@occ/core/ansi"
  import { formatDuration } from "@occ/core/format"
  import { ShellPager, type ShellState } from "@occ/core/shell-pager"
  import Bar from "../components/Bar.svelte"
  import { model } from "../model.svelte"

  /**
   * The output of a command the agent ran, read-only. It follows the command while it runs (the same pager the VS Code
   * terminal uses) and offers Stop, which removes the shell on the server.
   */
  let { directory, shellID, title, sessionID }: { directory: string; shellID: string; title?: string; sessionID?: string } = $props()

  // svelte-ignore state_referenced_locally
  const ctl = model.controller(directory)
  // svelte-ignore state_referenced_locally
  const location = ctl.locationOf(sessionID ?? "")
  let text = $state("")
  // svelte-ignore state_referenced_locally
  let command = $state(title ?? "")
  let cwd = $state("")
  let status = $state<ShellState | undefined>()
  let duration = $state<number | undefined>()
  let problem = $state<string | undefined>()
  let loading = $state(true)
  let stopping = $state(false)
  let pager: ShellPager | undefined
  let box: HTMLElement | undefined = $state()
  let follow = true

  const spans = $derived(ansiToSpans(text))
  const css = (s: AnsiSpan) =>
    [s.fg ? `color:${cssColor(s.fg)}` : "", s.bg ? `background:${cssColor(s.bg)}` : "", s.bold ? "font-weight:700" : "", s.dim ? "opacity:.7" : "", s.italic ? "font-style:italic" : "", s.underline ? "text-decoration:underline" : ""]
      .filter(Boolean)
      .join(";")
  const running = $derived(!status && !problem)
  const verdict = $derived(
    stopping || status?.status === "killed" ? "Stopped" : status?.status === "timeout" ? "Timed out" : status ? (status.exit === 0 ? "Finished" : `Exited with code ${status.exit ?? "?"}`) : "Running",
  )

  async function scroll() {
    await tick()
    if (follow && box) box.scrollTop = box.scrollHeight
  }

  onMount(async () => {
    const client = ctl.api
    if (!client) {
      problem = "Not connected."
      loading = false
      return
    }
    let started = 0
    try {
      const info = (await client.shell.get({ id: shellID, location })).data
      command = info.command
      cwd = info.cwd
      started = info.time.started
    } catch {
      problem = "The command output is no longer available."
      loading = false
      return
    }
    loading = false
    pager = new ShellPager(
      {
        output: async ({ cursor, limit }) => {
          const r = (await client.shell.output({ id: shellID, location, cursor, limit })).data
          return { output: r.output, cursor: r.cursor, size: r.size, truncated: r.truncated }
        },
        state: async () => {
          const r = (await client.shell.get({ id: shellID, location })).data
          duration = (r.time.completed ?? Date.now()) - started
          return { status: r.status, exit: r.exit }
        },
      },
      {
        text: (chunk) => {
          text += chunk
          void scroll()
        },
        exit: (s) => {
          status = s
        },
        unavailable: (reason) => {
          problem = reason
        },
      },
    )
    await pager.run()
  })

  onDestroy(() => pager?.stop())

  async function stop() {
    const client = ctl.api
    if (!client || stopping) return
    stopping = true
    try {
      await client.shell.remove({ id: shellID, location })
    } catch (e) {
      stopping = false
      model.notify("error", `Could not stop the command: ${e instanceof Error ? e.message : "unknown error"}`)
    }
  }

  function onScroll() {
    if (box) follow = box.scrollHeight - box.scrollTop - box.clientHeight < 48
  }
</script>

<Bar title={command || "Command"} sub={cwd || undefined}>
  {#snippet actions()}
    {#if running && !loading}
      <button class="btn danger stopbtn" onclick={stop} disabled={stopping}>
        {#if stopping}<Codicon name="loading" spin />{:else}<Codicon name="debug-stop" />{/if} Stop
      </button>
    {/if}
  {/snippet}
</Bar>

<div class="status muted" role="status">
  {#if loading}Loading…{:else if problem}{problem}{:else}{verdict}{#if duration !== undefined}{" · " + formatDuration(duration)}{/if}{/if}
</div>

<div class="body term" bind:this={box} onscroll={onScroll}>
  <pre>{#each spans as s, i (i)}{#if css(s)}<span style={css(s)}>{s.text}</span>{:else}{s.text}{/if}{/each}{#if running && !loading}<span class="cursor"> </span>{/if}</pre>
  {#if !loading && !problem && text === "" && !running}<div class="center muted">The command printed nothing.</div>{/if}
</div>

<style>
  .stopbtn { min-height: 40px; padding: 0 12px; }
  .status { flex: none; padding: 6px 16px; font-size: 0.85em; border-bottom: 1px solid var(--oc-hairline); }
  .term { background: var(--vscode-terminal-background); color: var(--vscode-terminal-foreground); padding: 10px 12px; }
  pre { margin: 0; font-family: var(--vscode-editor-font-family); font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-all; }
  .cursor { display: inline-block; width: 0.6em; background: var(--vscode-terminal-foreground); opacity: 0.6; animation: blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .cursor { animation: none; } }
</style>
