<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import SettingsGroup from "../../components/settings/SettingsGroup.svelte"
  import { model } from "../../model.svelte"

  /** Short ways into the existing server screens: no server logic lives here. */
  const count = $derived(model.profiles.length)
</script>

<SettingsGroup title="Servers">
  <section class="list">
    <button class="row" onclick={() => model.goServers()}>
      <Codicon name="server-environment" />
      <span class="main">
        <span class="t">Saved servers</span>
        <span class="s">{count === 0 ? "No server yet" : count === 1 ? "1 server on this phone" : `${count} servers on this phone`}</span>
      </span>
      <span class="end"><Codicon name="chevron-right" /></span>
    </button>
    <button class="row" onclick={() => model.push({ kind: "server-form" })}>
      <Codicon name="add" />
      <span class="main">
        <span class="t">Add or pair a server</span>
        <span class="s">Scan the pairing QR code, or type the address and password.</span>
      </span>
      <span class="end"><Codicon name="chevron-right" /></span>
    </button>
  </section>
</SettingsGroup>

<style>
  .list {
    margin-top: 4px;
  }
</style>
