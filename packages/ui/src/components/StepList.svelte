<script lang="ts">
  import type { PermissionRequest } from "@occ/core/api"
  import type { ViewSettings } from "@occ/core/protocol"
  import type { StepView } from "@occ/core/transcript/types"
  import Markdown from "./Markdown.svelte"
  import Reasoning from "./Reasoning.svelte"
  import ToolLine from "./ToolLine.svelte"

  let { steps, cwd, settings, permissions }: { steps: StepView[]; cwd: string; settings: ViewSettings; permissions: Map<string, PermissionRequest> } = $props()
</script>

<div class="steps">
  {#each steps as step (step.id)}
    {#each step.items as item, i (item.kind === "tool" ? `${step.id}:t:${item.id}` : `${step.id}:${item.key}`)}
      {#if item.kind === "tool"}
        <ToolLine tool={item} {cwd} {settings} permission={permissions.get(item.id)} defaultOpen={settings.expandToolDetails} />
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
  /* Left connector chaining the steps of a turn; each tool line puts a dot on it. */
  .steps { border-left: 1px solid var(--oc-hairline); margin-left: 0.55em; padding-left: 14px; display: flex; flex-direction: column; gap: 2px; }
  .text { margin: 0.3em 0; }
</style>
