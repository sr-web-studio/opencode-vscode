<script lang="ts">
  import type { PermissionRequest } from "../../core/api"
  import type { ViewSettings } from "../../core/protocol"
  import { headLines } from "../../core/format"
  import { toolIcon } from "../../core/transcript/icons"
  import { askedQuestions, editStats, summarizeTool } from "../../core/transcript/tools"
  import type { ToolItem } from "../../core/transcript/types"
  import { displayName } from "../../core/names"
  import { toolChildID } from "../../core/workers"
  import { keepAnchored } from "../anchor"
  import { useStore, useTranscript } from "../context"
  import Codicon from "./Codicon.svelte"
  import DiffView from "./DiffView.svelte"
  import PermissionPrompt from "./PermissionPrompt.svelte"
  import ShellBlock from "./ShellBlock.svelte"

  let { tool, cwd, permission, defaultOpen, settings }: { tool: ToolItem; cwd: string; permission?: PermissionRequest; defaultOpen: boolean; settings: ViewSettings } = $props()
  const store = useStore()
  const view = useTranscript()
  const fontFamily = $derived(settings.terminalFontFamily)

  let userOpen = $state<boolean | undefined>(undefined)
  let head: HTMLElement | undefined = $state()
  const open = $derived(userOpen ?? defaultOpen)
  const line = $derived(summarizeTool(tool, cwd))
  const active = $derived(tool.status === "running" || tool.status === "streaming")
  const edits = $derived(tool.name === "edit" || tool.name === "write" || tool.name === "patch" ? editStats(tool) : undefined)
  const shellID = $derived(typeof tool.metadata.shellID === "string" ? tool.metadata.shellID : undefined)
  const isShell = $derived(tool.name === "shell")
  const exit = $derived(typeof tool.metadata.exit === "number" ? tool.metadata.exit : tool.status === "completed" ? 0 : undefined)
  const command = $derived(typeof tool.input.command === "string" ? tool.input.command : "")
  const workdir = $derived(typeof tool.input.workdir === "string" ? tool.input.workdir : undefined)

  // A worker: the child session comes from the tool's metadata/result, else from the matched Background row.
  const isWorker = $derived(tool.name === "subagent")
  const worker = $derived(isWorker ? view.workers().find((w) => w.toolIDs.includes(tool.id)) : undefined)
  const childID = $derived(isWorker ? (toolChildID(tool) ?? worker?.sessionID) : undefined)
  const workerStatus = $derived(worker?.status ?? (active ? "running" : tool.status === "error" ? "failed" : "done"))
  const agentName = $derived(typeof tool.input.agent === "string" && tool.input.agent ? displayName(tool.input.agent) : "Agent")

  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const range = $derived.by(() => {
    if (tool.name !== "read") return ""
    const offset = typeof tool.input.offset === "number" ? tool.input.offset : undefined
    const limit = typeof tool.input.limit === "number" ? tool.input.limit : undefined
    if (offset === undefined && limit === undefined) return "Whole file"
    const from = offset ?? 1
    return limit === undefined ? `From line ${from}` : `Lines ${from}–${from + limit - 1}`
  })

  const patchOf = (f: object): string => ((f as { patch?: unknown }).patch && typeof (f as { patch?: unknown }).patch === "string" ? (f as { patch: string }).patch : "")
  /** This edit alone: the file on disk against the text before this patch. */
  const openDiff = (f: { file?: string }) => store.bridge.openDiff(f.file ?? "", [patchOf(f)])

  function toggle() {
    void keepAnchored(head ?? null, () => (userOpen = !open))
  }
  function activate() {
    if (isWorker && childID) store.bridge.openSession(childID, { readOnly: true })
    else toggle()
  }
</script>

<div class="tool" class:attn={!!permission} class:open>
  <div class="row" bind:this={head}>
    <button class="main" onclick={activate} aria-expanded={isWorker && childID ? undefined : open} title={isWorker && childID ? "Open this worker in a tab" : undefined}>
      <span class="dot" class:run={active} aria-hidden="true"></span>
      {#if active}<Codicon name="loading" spin />{:else}<Codicon name={toolIcon(tool.name)} />{/if}
      {#if isShell}
        <span class="prompt-sign" aria-hidden="true">$</span>
        <code class="cmd-chip" title={command}>{line.target}</code>
      {:else if isWorker}
        <span class="name">{agentName}</span>
        <span class="target muted" title={line.target}>{line.target}</span>
      {:else}
        <span class="name">{line.label}</span>
        {#if line.target && !line.path}<span class="target muted" title={line.target}>{line.target}</span>{/if}
      {/if}
    </button>
    {#if line.path}
      <button class="target link path" title={line.path} onclick={() => store.bridge.openFile(line.path!)}>{line.target}</button>
    {/if}
    {#if isWorker}
      <span class="status" class:ok={workerStatus === "done"} class:bad={workerStatus === "failed"} class:muted={workerStatus === "running" || workerStatus === "stopped"}>
        {workerStatus === "running" ? "Running" : workerStatus === "done" ? "Done" : workerStatus === "failed" ? "Failed" : "Stopped"}
      </span>
      {#if childID}<Codicon name="link-external" />{/if}
    {:else if isShell && exit !== undefined && !active}
      <span class="badge" class:ok={exit === 0} class:bad={exit !== 0}>{exit === 0 ? "✓" : "✗"} {exit}</span>
    {:else if line.result && !isShell}
      <span class="result" class:ok={line.tone === "ok"} class:bad={line.tone === "error"} class:muted={line.tone === "muted"}>{line.result}</span>
    {/if}
    {#if !isWorker || !childID}
      <button class="chev muted" onclick={toggle} aria-label={open ? "Collapse details" : "Expand details"} tabindex="-1"><Codicon name={open ? "chevron-down" : "chevron-right"} /></button>
    {/if}
    {#if permission}<PermissionPrompt request={permission} />{/if}
  </div>

  {#if open}
    <div class="details">
      {#if edits}
        {#each edits.files as f, fi (fi)}
          <div class="file">
            <button class="link" title={patchOf(f) ? "Open the file. Alt-click opens the diff." : "Open the file"} onclick={(e) => (e.altKey && patchOf(f) ? openDiff(f) : store.bridge.openFile(f.file ?? ""))}>{f.file}</button>
            <span class="muted"> +{f.additions ?? 0} −{f.deletions ?? 0}</span>
            {#if patchOf(f)}
              <button class="link right" onclick={() => openDiff(f)}>Open diff</button>
              <DiffView patch={patchOf(f)} />
            {/if}
          </div>
        {/each}
      {:else if isShell}
        <ShellBlock {command} output={tool.output ?? ""} {workdir} directory={cwd} {exit} {active} created={tool.created} completed={tool.completed} {shellID} title={line.target} fontFamily={fontFamily} />
      {:else if isWorker}
        {#if tool.output}<pre class="out mono">{headLines(tool.output, 14)}</pre>{/if}
      {:else if tool.name === "question"}
        {#each askedQuestions(tool) as q, qi (qi)}
          <div class="ask">
            <div class="askq">{q.question}</div>
            {#each q.options as o, oi (oi)}
              <div class="askopt" class:chosen={q.answer === o.label}>
                <span class="askl">{o.label}{#if q.answer === o.label} ✓{/if}</span>{#if o.description}<span class="muted"> — {o.description}</span>{/if}
              </div>
            {/each}
            {#if q.answer}<div class="askans"><span class="muted">Answer:</span> {q.answer}</div>{/if}
          </div>
        {/each}
      {:else if tool.name === "read"}
        <div class="muted">{range}</div>
      {:else}
        {#if Object.keys(tool.input).length}<pre class="out mono muted">{headLines(JSON.stringify(tool.input, null, 1), 12)}</pre>{/if}
        {#if tool.output}<pre class="out mono">{headLines(tool.output, 12)}</pre>{/if}
      {/if}
      {#if tool.error}<div class="err">{tool.error}</div>{/if}
    </div>
  {/if}
</div>

<style>
  .tool { position: relative; margin-left: -2px; border-left: 2px solid transparent; }
  .tool.attn { border-left-color: var(--oc-amber); }
  .row { display: flex; align-items: center; gap: 0 0.5em; min-height: 28px; padding: 0 0.4em 0 0.2em; border-radius: 4px; }
  .row:hover { background: var(--oc-hover); }
  .main { display: inline-flex; align-items: center; gap: 0.5em; min-width: 0; text-align: left; flex: 0 1 auto; min-height: 28px; }
  .name { font-weight: 600; color: var(--oc-fg); }
  .target { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .path { text-align: left; }
  .prompt-sign { color: var(--oc-muted); font-weight: 700; font-family: var(--vscode-editor-font-family, monospace); }
  .cmd-chip { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em; background: var(--oc-code-bg); padding: 0.05em 0.45em; border-radius: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 36em; }
  .badge, .status, .result { font-size: 0.9em; white-space: nowrap; }
  .badge { border: 1px solid currentColor; border-radius: 999px; padding: 0 0.5em; line-height: 1.5; }
  .ok { color: var(--oc-ok); }
  .bad { color: var(--oc-error); }
  .chev { margin-left: auto; display: inline-flex; align-items: center; min-height: 28px; padding: 0 0.2em; }
  .row:hover .chev { color: var(--oc-fg); }
  /* A dot on the connector line of the step list (the line itself is drawn by StepList). */
  .dot { position: absolute; left: -18px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%; background: var(--oc-hairline); box-shadow: 0 0 0 3px var(--vscode-sideBar-background, var(--vscode-editor-background)); }
  .dot.run { background: var(--oc-accent); }
  .details { margin: 0.1em 0 0.5em 1.6em; font-size: 0.95em; }
  pre { margin: 0.25em 0; white-space: pre-wrap; word-break: break-word; }
  .ask { margin: 0.2em 0 0.6em; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
  .askq { font-weight: 600; margin-bottom: 0.2em; }
  .askopt { padding-left: 0.8em; }
  .askopt.chosen .askl { color: var(--oc-accent); }
  .askl { font-weight: 500; }
  .askans { margin-top: 0.25em; }
  .out { background: var(--oc-code-bg); padding: 0.4em 0.6em; border-radius: 4px; max-height: 16em; overflow: auto; }
  .right { margin-left: 0.8em; }
</style>
