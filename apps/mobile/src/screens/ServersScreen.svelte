<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import Bar from "../components/Bar.svelte"
  import { openInBrowser } from "../lib/platform"
  import { EMPTY_SERVERS_HELP, SETUP_GUIDE_LABEL, SETUP_GUIDE_URL } from "../lib/texts"
  import { model } from "../model.svelte"
  import { IS_PREVIEW, PREVIEW_TAG } from "../lib/version"
</script>

<Bar title="Servers" back={false} badge={IS_PREVIEW ? PREVIEW_TAG : undefined}>
  {#snippet actions()}
    <button class="iconbtn" onclick={() => model.openSettings()} aria-label="Settings"><Codicon name="settings-gear" /></button>
    <button class="iconbtn" onclick={() => model.push({ kind: "server-form" })} aria-label="Add server"><Codicon name="add" /></button>
  {/snippet}
</Bar>

<div class="body">
  {#if model.profiles.length === 0}
    <div class="center">
      <Codicon name="server-environment" />
      <strong>No server yet</strong>
      <p class="muted">{EMPTY_SERVERS_HELP}</p>
      <button class="btn" onclick={() => model.push({ kind: "server-form" })}><Codicon name="add" /> Add server</button>
      <button class="helplink" onclick={() => void openInBrowser(SETUP_GUIDE_URL)}>{SETUP_GUIDE_LABEL}</button>
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
  .helplink {
    font: inherit;
    font-size: 0.9em;
    color: var(--vscode-textLink-foreground, #3794ff);
    background: none;
    border: 0;
    padding: 4px;
    text-decoration: underline;
    cursor: pointer;
  }
  .entry {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--oc-hairline);
    padding-right: 8px;
  }
  .entry .row {
    border-bottom: none;
  }
  .bad {
    display: block;
    margin-top: 2px;
    font-size: 0.85em;
    color: var(--oc-error);
    white-space: normal;
  }
</style>
