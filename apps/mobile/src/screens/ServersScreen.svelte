<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import Bar from "../components/Bar.svelte"
  import { model } from "../model.svelte"
</script>

<Bar title="Servers" back={false}>
  {#snippet actions()}
    <button class="iconbtn" onclick={() => model.push({ kind: "server-form" })} aria-label="Add server"><Codicon name="add" /></button>
  {/snippet}
</Bar>

<div class="body">
  {#if model.profiles.length === 0}
    <div class="center">
      <Codicon name="server-environment" />
      <strong>No server yet</strong>
      <p class="muted">Add the OpenCode server that runs on your computer. The easiest way is to scan the QR code from “OpenCode: Pair Mobile Device” in VS Code, or from <code>opencode pair</code>.</p>
      <button class="btn" onclick={() => model.push({ kind: "server-form" })}><Codicon name="add" /> Add server</button>
    </div>
  {:else}
    {#each model.profiles as p (p.id)}
      {@const bad = model.problem?.profileID === p.id ? model.problem : undefined}
      <div class="entry">
        <button class="row" onclick={() => void model.connect(p)} disabled={model.connecting !== undefined}>
          <span class="main">
            <span class="t">{p.name}</span>
            <span class="s">{p.url}</span>
            {#if bad}<span class="bad" role="alert">{bad.message}</span>{/if}
          </span>
          {#if model.connecting === p.id}<span class="end"><Codicon name="loading" spin /> Connecting…</span>
          {:else if model.activeID === p.id}<span class="end">Last used</span>{/if}
        </button>
        <button class="iconbtn" onclick={() => model.push({ kind: "server-form", profileID: p.id })} aria-label="Edit {p.name}"><Codicon name="edit" /></button>
      </div>
    {/each}
  {/if}
</div>

<style>
  .entry { display: flex; align-items: center; border-bottom: 1px solid var(--oc-hairline); padding-right: 8px; }
  .entry .row { border-bottom: none; }
  .bad { display: block; margin-top: 2px; font-size: 0.85em; color: var(--oc-error); white-space: normal; }
</style>
