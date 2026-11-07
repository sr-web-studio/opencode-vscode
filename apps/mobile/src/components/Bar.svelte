<script lang="ts">
  import type { Snippet } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { model } from "../model.svelte"

  /** The top bar of a screen: a back button (the same as Android's), the title, and room for actions. */
  let { title, sub, back = true, actions }: { title: string; sub?: string; back?: boolean; actions?: Snippet } = $props()
</script>

<header class="bar">
  {#if back}
    <button class="iconbtn" onclick={() => model.pop()} aria-label="Back"><Codicon name="arrow-left" /></button>
  {/if}
  <h1>{title}{#if sub}<span class="sub">{sub}</span>{/if}</h1>
  {@render actions?.()}
</header>
