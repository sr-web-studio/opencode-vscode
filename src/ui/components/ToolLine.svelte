<script lang="ts">
  import type { PermissionRequest } from "../../core/api"
  import { headLines, tailLines } from "../../core/format"
  import { editStats, summarizeTool } from "../../core/transcript/tools"
  import type { ToolItem } from "../../core/transcript/types"
  import { useStore } from "../context"
  import PermissionPrompt from "./PermissionPrompt.svelte"

  let { tool, cwd, permission, defaultOpen }: { tool: ToolItem; cwd: string; permission?: PermissionRequest; defaultOpen: boolean } = $props()
  const store = useStore()

  let userOpen = $state<boolean | undefined>(undefined)
  const open = $derived(userOpen ?? defaultOpen)
  const line = $derived(summarizeTool(tool, cwd))
  const active = $derived(tool.status === "running" || tool.status === "streaming")
  const edits = $derived(tool.name === "edit" || tool.name === "write" || tool.name === "patch" ? editStats(tool) : undefined)
  const shellID = $derived(typeof tool.metadata.shellID === "string" ? tool.metadata.shellID : undefined)

  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const range = $derived.by(() => {
    if (tool.name !== "read") return ""
    const offset = typeof tool.input.offset === "number" ? tool.input.offset : undefined
    const limit = typeof tool.input.limit === "number" ? tool.input.limit : undefined
    if (offset === undefined && limit === undefined) return "Whole file"
    const from = offset ?? 1
    return limit === undefined ? `From line ${from}` : `Lines ${from}–${from + limit - 1}`
  })

  const diffClass = (l: string) => (l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : "")
</script>

<div class="tool" class:attn={!!permission}>
  <div class="row">
    <button class="lead" onclick={() => (userOpen = !open)} aria-expanded={open} aria-label={open ? "Collapse details" : "Expand details"}>
      {#if active}<span class="spinner"></span>{:else}<span class="chev muted">{open ? "⌄" : "›"}</span>{/if}
    </button>
    <button class="label" onclick={() => (userOpen = !open)}>{line.label}</button>
    {#if line.target}
      {#if line.path}
        <button class="target link" title={line.path} onclick={() => store.bridge.openFile(line.path!)}>{line.target}</button>
      {:else}
        <span class="target muted" title={line.target}>{line.target}</span>
      {/if}
    {/if}
    {#if line.result}<span class="result" class:ok={line.tone === "ok"} class:bad={line.tone === "error"} class:muted={line.tone === "muted"}>{line.result}</span>{/if}
    {#if permission}<PermissionPrompt request={permission} />{/if}
  </div>

  {#if open}
    <div class="details">
      {#if edits}
        {#each edits.files as f (f.file)}
          <div class="file">
            <button class="link" onclick={() => store.bridge.openFile(f.file ?? "")}>{f.file}</button>
            <span class="muted"> +{f.additions ?? 0} −{f.deletions ?? 0}</span>
            {#if (f as { patch?: string }).patch}
              <button class="link right" onclick={() => store.bridge.openDiff(f.file ?? "", (f as { patch?: string }).patch ?? "")}>Open diff</button>
              <pre class="diff mono">{#each headLines((f as { patch?: string }).patch ?? "", 40).split("\n") as l}<span class={diffClass(l)}>{l}
</span>{/each}</pre>
            {/if}
          </div>
        {/each}
      {:else if tool.name === "shell"}
        <pre class="mono cmd">$ {str(tool.input.command)}</pre>
        {#if tool.output}<pre class="out mono">{tailLines(tool.output, 12)}</pre>{/if}
        {#if shellID}<button class="link" onclick={() => store.bridge.showTerminal(shellID, line.target)}>Show terminal</button>{/if}
      {:else if tool.name === "read"}
        <div class="muted">{range}</div>
      {:else}
        {#if Object.keys(tool.input).length}<pre class="out mono muted">{headLines(JSON.stringify(tool.input, null, 1), 12)}</pre>{/if}
        {#if tool.output}<pre class="out mono">{tailLines(tool.output, 12)}</pre>{/if}
      {/if}
      {#if tool.error}<div class="err">{tool.error}</div>{/if}
    </div>
  {/if}
</div>

<style>
  .tool { border-left: 2px solid transparent; margin-left: -2px; padding-left: 0.4em; }
  .tool.attn { border-left-color: var(--oc-amber); }
  .row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 0.5em; min-height: 1.6em; }
  .lead { width: 1.1em; display: inline-flex; align-items: center; justify-content: center; align-self: center; }
  .label { font-weight: 600; }
  .target { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; text-align: left; }
  .result.ok { color: var(--oc-ok); }
  .result.bad { color: var(--oc-error); }
  .details { margin: 0.2em 0 0.4em 1.6em; font-size: 0.95em; }
  pre { margin: 0.25em 0; white-space: pre-wrap; word-break: break-word; }
  .out, .cmd, .diff { background: var(--oc-code-bg); padding: 0.4em 0.6em; border-radius: 4px; max-height: 16em; overflow: auto; }
  .diff .add { color: var(--vscode-gitDecoration-addedResourceForeground); }
  .diff .del { color: var(--vscode-gitDecoration-deletedResourceForeground); }
  .right { margin-left: 0.8em; }
</style>
