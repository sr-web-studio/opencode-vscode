<script lang="ts">
  import type { Snippet } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { model } from "../model.svelte"

  /** The top bar of a screen: a back button (the same as Android's), the title, and room for actions. */
  let { title, sub, back = true, badge, actions }: { title: string; sub?: string; back?: boolean; badge?: string; actions?: Snippet } = $props()
</script>

<header class="bar">
  {#if back}
    <button class="iconbtn" onclick={() => model.pop()} aria-label="Back"><Codicon name="arrow-left" /></button>
  {/if}
  <h1>{title}{#if badge}<span class="badge">{badge}</span>{/if}{#if sub}<span class="sub">{sub}</span>{/if}</h1>
  {@render actions?.()}
</header>

<style>
  .badge { display: inline-block; margin-left: 8px; padding: 1px 7px; border: 1px solid var(--oc-hairline); border-radius: 999px; font-size: 0.62em; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; vertical-align: middle; color: var(--oc-muted); }
</style>
