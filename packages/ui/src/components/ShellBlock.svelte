<script lang="ts">
  import { ansiToSpans, cssColor, type AnsiSpan } from "@occ/core/ansi"
  import { copyText, shellView } from "@occ/core/shell-view"
  import { plural } from "@occ/core/format"
  import { useStore, useTranscript } from "../context"
  import Codicon from "./Codicon.svelte"

  type Props = {
    command: string
    output: string
    workdir?: string
    directory: string
    exit?: number
    active: boolean
    created?: number
    completed?: number
    /** Only live events carry it; old history lines have none, so "Open in terminal" is off for them. */
    shellID?: string
    title?: string
    fontFamily: string
  }
  let { command, output, workdir, directory, exit, active, created, completed, shellID, title, fontFamily }: Props = $props()

  const store = useStore()
  const view = useTranscript()
  const outputView = store.bridge.capabilities?.shellView === "output"
  const LIMIT = 60

  let showAll = $state(false)
  let copied = $state<"idle" | "done" | "failed">("idle")

  const model = $derived(shellView({ command, output, workdir, directory, displayPath: view.displayPath() || directory, created, completed, limit: LIMIT, showAll }))
  const spans = $derived(ansiToSpans(model.shown))
  const termFont = $derived(fontFamily ? `${fontFamily}, var(--vscode-editor-font-family, monospace)` : "var(--vscode-editor-font-family, monospace)")

  function style(s: AnsiSpan): string {
    const parts: string[] = []
    if (s.fg) parts.push(`color:${cssColor(s.fg)}`)
    if (s.bg) parts.push(`background:${cssColor(s.bg)}`)
    if (s.bold) parts.push("font-weight:700")
    if (s.dim) parts.push("opacity:0.7")
    if (s.italic) parts.push("font-style:italic")
    if (s.underline) parts.push("text-decoration:underline")
    return parts.join(";")
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText(command, output))
      copied = "done"
    } catch {
      copied = "failed"
    }
    setTimeout(() => (copied = "idle"), 1600)
  }
</script>

<div class="term">
  <div class="bar">
    <Codicon name="terminal" />
    <span class="cwd" title={model.cwd}>{model.cwd}</span>
    <span class="grow"></span>
    {#if active}
      <span class="muted">Running</span>
    {:else if exit !== undefined}
      <span class="badge" class:ok={exit === 0} class:bad={exit !== 0}>{exit === 0 ? "✓" : "✗"} {exit}</span>
    {/if}
    {#if model.duration}<span class="muted dur">{model.duration}</span>{/if}
    <button class="act" onclick={copy} title="Copy the command and its output" aria-label="Copy command and output">
      <Codicon name={copied === "done" ? "check" : "copy"} /><span>{copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}</span>
    </button>
    <button
      class="act"
      disabled={!shellID}
      onclick={() => shellID && store.bridge.showTerminal(shellID, title)}
      title={shellID ? (outputView ? "Show the live output of this command" : "Show this command in a VS Code terminal") : "This command's terminal is no longer available"}
      aria-label={outputView ? "Open output" : "Open in terminal"}
    ><Codicon name="terminal" /><span>{outputView ? "Open output" : "Open in terminal"}</span></button>
  </div>

  <pre class="cmd"><span class="sign" aria-hidden="true">$ </span>{command}</pre>

  {#if model.total > 0}
    <pre class="out" style:font-family={termFont} aria-label="Command output">{#each spans as s, i (i)}<span style={style(s)}>{s.text}</span>{/each}</pre>
  {:else if !active}
    <div class="empty muted">No output</div>
  {/if}

  {#if model.hidden > 0}
    <button class="more" onclick={() => (showAll = true)}>Show all {model.total} {plural(model.total, "line")} ({model.hidden} more)</button>
  {:else if showAll && model.total > LIMIT}
    <button class="more" onclick={() => (showAll = false)}>Show last {LIMIT} lines</button>
  {/if}
</div>

<style>
  .term {
    margin: 0.35em 0;
    border: 1px solid var(--oc-hairline);
    border-radius: 6px;
    overflow: hidden;
    background: var(--vscode-terminal-background, var(--vscode-editor-background));
    color: var(--vscode-terminal-foreground, var(--oc-fg));
  }
  .bar { display: flex; align-items: center; gap: 0.5em; padding: 4px 8px; background: var(--vscode-editorWidget-background, var(--oc-code-bg)); border-bottom: 1px solid var(--oc-hairline); font-size: 0.9em; min-width: 0; }
  .cwd { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grow { flex: 1; }
  .badge { border: 1px solid currentColor; border-radius: 999px; padding: 0 0.5em; line-height: 1.5; white-space: nowrap; }
  .ok { color: var(--oc-ok); }
  .bad { color: var(--oc-error); }
  .dur { white-space: nowrap; }
  .act { display: inline-flex; align-items: center; gap: 0.3em; padding: 0.1em 0.45em; border-radius: 4px; color: var(--oc-muted); white-space: nowrap; }
  .act:hover:not(:disabled) { color: var(--oc-fg); background: var(--oc-hover); }
  .act:disabled { opacity: 0.45; cursor: default; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
  .cmd { padding: 8px 10px 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.95em; color: var(--oc-fg); line-height: 1.45; }
  .sign { color: var(--oc-muted); user-select: none; }
  .out { padding: 4px 10px 8px; max-height: 18em; overflow: auto; line-height: 1.45; font-size: 0.95em; background: var(--vscode-terminal-background, var(--vscode-editor-background)); }
  .empty { padding: 4px 10px 8px; font-size: 0.9em; }
  .more { display: block; width: 100%; padding: 4px 10px; text-align: left; font-size: 0.9em; color: var(--vscode-textLink-foreground); border-top: 1px solid var(--oc-hairline); }
  .more:hover { text-decoration: underline; }
</style>
