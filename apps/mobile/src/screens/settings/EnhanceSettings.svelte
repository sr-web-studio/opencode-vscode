<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import SettingsGroup from "../../components/settings/SettingsGroup.svelte"
  import { enhanceModelLabel } from "../../lib/app-settings"
  import { model } from "../../model.svelte"

  /** The model each server uses for "Enhance prompt"; a reset puts it back on the server's default. */
  const rows = $derived.by(() => {
    // The tick changes when a model is reset, including from the reset-all action.
    void model.settingsTick
    return model.profiles.map((profile) => ({ profile, enhancement: model.enhanceModelOf(profile.id) }))
  })

  function reset(profileID: string, name: string) {
    model.resetEnhanceModel(profileID)
    model.notify("info", `“${name}” uses its default model again.`)
  }
</script>

<SettingsGroup title="Enhance prompt">
  <section class="pad">
    <p class="note">The sparkle button above the prompt box polishes or rewrites what you typed. Each server can use its own default model or one you picked there.</p>
    {#if rows.length === 0}
      <p class="note">Add a server to choose a model.</p>
    {:else}
      <ul class="servers">
        {#each rows as row (row.profile.id)}
          <li>
            <span class="txt">
              <strong>{row.profile.name}</strong>
              <small class:default={!row.enhancement}>{enhanceModelLabel(row.enhancement)}</small>
            </span>
            {#if row.enhancement}
              <button class="btn quiet" onclick={() => reset(row.profile.id, row.profile.name)}><Codicon name="discard" /> Reset</button>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="hint">To choose a specific model, open a chat and use the sparkle menu → Model.</p>
    {/if}
  </section>
</SettingsGroup>

<style>
  .servers {
    list-style: none;
    margin: 4px 0 8px;
    padding: 0;
  }
  .servers li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 6px 0;
    border-bottom: 1px solid var(--oc-hairline);
  }
  .servers li:last-child {
    border-bottom: none;
  }
  .servers .txt {
    flex: 1;
    min-width: 0;
  }
  .servers strong {
    display: block;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .servers small {
    display: block;
    margin-top: 2px;
    color: var(--oc-muted);
    font-size: 0.82em;
    overflow-wrap: anywhere;
  }
  .servers small.default {
    color: var(--oc-ok);
  }
  .servers .btn {
    flex: none;
    padding: 0 12px;
  }
  .hint {
    margin: 8px 0 0;
    color: var(--oc-muted);
    font-size: 0.85em;
    line-height: 1.45;
  }
</style>
