<script lang="ts">
  import { ansiToSpans, cssColor, type AnsiSpan } from "../../core/ansi"
  import { tailLines } from "../../core/format"

  let { output }: { output: string } = $props()
  const spans = $derived(ansiToSpans(tailLines(output, 60)))

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
</script>

<pre class="block mono scroll" aria-label="Command output">{#each spans as s, i (i)}<span style={style(s)}>{s.text}</span>{/each}</pre>

<style>
  .block {
    margin: 0.35em 0;
    padding: 0.6em 0.8em;
    border-radius: 6px;
    max-height: 18em;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--vscode-terminal-background, #1e1e1e);
    color: var(--vscode-terminal-foreground, #cccccc);
    border: 1px solid var(--oc-hairline);
    line-height: 1.45;
  }
</style>
