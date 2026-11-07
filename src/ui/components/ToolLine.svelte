<script lang="ts">
  import type { PermissionRequest } from "../../core/api"
  import type { ViewSettings } from "../../core/protocol"
  import { headLines } from "../../core/format"
  import { toolIcon } from "../../core/transcript/icons"
  import { executeOutput } from "../../core/transcript/execute"
  import { firstChangedLine } from "../../core/transcript/patch"
  import { askedQuestions, editStats, rowAction, rowTitle, summarizeTool } from "../../core/transcript/tools"
  import type { ToolItem } from "../../core/transcript/types"
  import { displayName } from "../../core/names"
  import { modelLabel, modelTitle, toolChildID } from "../../core/workers"
  import { keepAnchored } from "../anchor"
  import { useStore, useTranscript } from "../context"
  import Codicon from "./Codicon.svelte"
  import DiffView from "./DiffView.svelte"
  import PermissionPrompt from "./PermissionPrompt.svelte"
  import ShellBlock from "./ShellBlock.svelte"
  import StopWorkerButton from "./StopWorkerButton.svelte"

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
  const workerModel = $derived(modelLabel(worker?.model, view.models(), { short: true }))
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

  const action = $derived(rowAction(tool, cwd))
  // A worker row opens its tab only once the child session is known; before that a click shows the details.
  const opensWorker = $derived(action.kind === "worker" && !!childID)
  const hasTarget = $derived(action.kind === "file" || action.kind === "url")
  const title = $derived(opensWorker ? rowTitle(action, line) : action.kind === "worker" ? undefined : rowTitle(action, line))
  const codeText = $derived(typeof tool.input.code === "string" ? tool.input.code : "")
  const isCode = $derived(tool.name === "execute")

  function toggle() {
    void keepAnchored(head ?? null, () => (userOpen = !open))
  }
  /** One primary action per row. Alt-click on a file or link row shows the details instead. */
  function activate(e: MouseEvent) {
    if (hasTarget && e.altKey) return toggle()
    if (action.kind === "file") store.bridge.openFile(action.path, action.line)
    else if (action.kind === "url") store.bridge.openExternal(action.url)
    else if (opensWorker && childID) store.bridge.openSession(childID, { readOnly: true })
    else toggle()
  }
  const lineOf = (f: object) => firstChangedLine(patchOf(f))
</script>

<div class="tool" class:attn={!!permission} class:open>
  <div class="row" class:acts={hasTarget} bind:this={head}>
    <button class="main" onclick={activate} aria-expanded={hasTarget || opensWorker ? undefined : open} {title}>
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
        {#if line.target}
          <span class="target" class:muted={!hasTarget} class:goes={hasTarget} class:mono={isCode}>{line.target}</span>
          {#if tool.name === "read" && line.at}<span class="muted at">:{line.at}</span>{/if}
        {/if}
      {/if}
      <span class="tail">
        {#if isWorker}
          {#if workerModel}<span class="wmodel muted" title={modelTitle(worker?.model)}>{workerModel}</span>{/if}
          <span class="status" class:ok={workerStatus === "done"} class:bad={workerStatus === "failed"} class:muted={workerStatus === "running" || workerStatus === "stopped"}>
            {workerStatus === "running" ? "Running" : workerStatus === "done" ? "Done" : workerStatus === "failed" ? "Failed" : "Stopped"}
          </span>
          {#if childID}<Codicon name="link-external" />{/if}
        {:else if isShell && exit !== undefined && !active}
          <span class="badge" class:ok={exit === 0} class:bad={exit !== 0}>{exit === 0 ? "✓" : "✗"} {exit}</span>
        {:else if line.result && !isShell}
          <span class="result" class:ok={line.tone === "ok"} class:bad={line.tone === "error"} class:muted={line.tone === "muted"}>{line.result}</span>
        {/if}
      </span>
    </button>
    {#if !opensWorker}
      <button class="chev muted" onclick={toggle} aria-expanded={open} aria-label={open ? "Collapse details" : "Expand details"} title={open ? "Hide details" : "Show details"}><Codicon name={open ? "chevron-down" : "chevron-right"} /></button>
    {/if}
    {#if isWorker && childID && workerStatus === "running" && !view.readOnly()}<StopWorkerButton sessionID={childID} running />{/if}
    {#if permission}<PermissionPrompt request={permission} />{/if}
  </div>

  {#if open}
    <div class="details">
      {#if edits}
        {#each edits.files as f, fi (fi)}
          <div class="file">
            <button class="link" title={patchOf(f) ? "Open the file at the first change. Alt-click opens the diff." : "Open the file"} onclick={(e) => (e.altKey && patchOf(f) ? openDiff(f) : store.bridge.openFile(f.file ?? "", lineOf(f)))}>{f.file}</button>
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
      {:else if isCode}
        {#if codeText}<pre class="out mono">{headLines(codeText, 24)}</pre>{/if}
        {#if tool.output}<pre class="out mono"><span class="muted">Output</span>{"\n"}{headLines(executeOutput(tool), 14)}</pre>{/if}
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
  .row { display: flex; align-items: center; gap: 0 0.3em; min-height: 28px; padding: 0 0 0 0.2em; border-radius: 4px; }
  .row:hover { background: var(--oc-hover); }
  /* The whole row is one button: label, target and result all belong to it. The chevron and a permission prompt are siblings. */
  .main { display: flex; align-items: center; gap: 0.5em; min-width: 0; text-align: left; flex: 1 1 0; min-height: 28px; }
  .name { font-weight: 600; color: var(--oc-fg); flex: none; }
  .target { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .at { flex: none; margin-left: -0.35em; }
  .tail { margin-left: auto; display: inline-flex; align-items: center; gap: 0.4em; flex: none; padding-left: 0.5em; }
  .goes { color: var(--oc-muted); }
  /* What a click will open: the path or URL turns into a link while the row is hovered or focused. */
  .row.acts:hover .goes, .row.acts:has(.main:focus-visible) .goes { color: var(--oc-accent); text-decoration: underline; }
  .prompt-sign { color: var(--oc-muted); font-weight: 700; font-family: var(--vscode-editor-font-family, monospace); }
  .cmd-chip { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em; background: var(--oc-code-bg); padding: 0.05em 0.45em; border-radius: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 36em; }
  .wmodel { font-size: 0.9em; max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge, .status, .result { font-size: 0.9em; white-space: nowrap; }
  .badge { border: 1px solid currentColor; border-radius: 999px; padding: 0 0.5em; line-height: 1.5; }
  .ok { color: var(--oc-ok); }
  .bad { color: var(--oc-error); }
  .chev { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 28px; min-height: 28px; border-radius: 4px; }
  .chev:hover { background: var(--oc-hover); color: var(--oc-fg); }
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
