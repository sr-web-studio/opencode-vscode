<script lang="ts">
  import type { PermissionRequest } from "../../core/api"
  import type { ViewSettings } from "../../core/protocol"
  import type { StepView } from "../../core/transcript/types"
  import Markdown from "./Markdown.svelte"
  import Reasoning from "./Reasoning.svelte"
  import ToolLine from "./ToolLine.svelte"

  let { steps, cwd, settings, permissions }: { steps: StepView[]; cwd: string; settings: ViewSettings; permissions: Map<string, PermissionRequest> } = $props()
</script>

<div class="steps">
  {#each steps as step (step.id)}
    {#each step.items as item, i (item.kind === "tool" ? `t:${item.id}` : `${step.id}:${item.key}`)}
      {#if item.kind === "tool"}
        <ToolLine tool={item} {cwd} permission={permissions.get(item.id)} defaultOpen={settings.expandToolDetails} />
      {:else if item.kind === "reasoning"}
        {#if settings.showReasoning !== "hidden" && (item.text.trim() || item.streaming)}
          <Reasoning text={item.text} mode={settings.showReasoning} streaming={item.streaming} />
        {/if}
      {:else if item.text.trim()}
        <div class="text"><Markdown text={item.text} /></div>
      {/if}
    {/each}
    {#if step.error}<div class="err">{step.error}</div>{/if}
  {/each}
</div>

<style>
  /* Thin left connector chaining the steps of a turn. */
  .steps { border-left: 1px solid var(--oc-hairline); margin-left: 0.55em; padding-left: 0.7em; display: flex; flex-direction: column; gap: 0.2em; }
  .text { margin: 0.3em 0; }
</style>
