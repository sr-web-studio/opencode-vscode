<script lang="ts">
  import { onMount } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import SettingsGroup from "../../components/settings/SettingsGroup.svelte"
  import SwitchRow from "../../components/settings/SwitchRow.svelte"
  import { ago, NOTIFY_KINDS, statusLine } from "../../lib/notify"
  import { canWatchInBackground } from "../../lib/notify-native"
  import { model } from "../../model.svelte"

  /** Background notifications and battery: the same switches and status as before, now one section of Settings. */
  const st = $derived(model.notifyStatus)
  const cfg = $derived(model.notifySettings)
  const native = canWatchInBackground()
  let now = $state(Date.now())

  // The status is read from the service: refresh it while this screen is open.
  onMount(() => {
    const t = setInterval(() => {
      now = Date.now()
      void model.refreshNotifyStatus()
    }, 3000)
    return () => clearInterval(t)
  })
</script>

<SettingsGroup title="Notifications">
  <section class="pad">
    <SwitchRow
      title="Background notifications"
      detail="Keep a quiet connection to your servers so this phone can tell you when a session needs you, also when the app is closed or the screen is off."
      checked={cfg.enabled}
      disabled={!native}
      onchange={(checked) => void model.setNotify({ enabled: checked })}
    />

    {#if !native}
      <p class="note">Notifications work in the Android app. This screen only shows the switches here.</p>
    {:else}
      <p class="note" class:err={cfg.enabled && !st.notificationsAllowed} class:ok={cfg.enabled && st.running && st.connected === st.servers && st.servers > 0}>
        {statusLine(cfg, st, model.profiles.length)}
        {#if cfg.enabled && st.running}<br />Last event: {ago(st.lastEventAt, now)}.{/if}
      </p>
      {#if cfg.enabled && st.watching.length > 0}
        <ul class="servers">
          {#each st.watching as w (w.id)}
            <li><span class="dot" class:up={w.connected}></span> {w.name} <span class="muted">{w.connected ? "connected" : "reconnecting"}</span></li>
          {/each}
        </ul>
      {/if}
      {#if cfg.enabled && !st.notificationsAllowed}
        <button class="btn" onclick={() => model.openNotificationSettings()}><Codicon name="bell" /> Allow notifications</button>
      {/if}
    {/if}
  </section>
</SettingsGroup>

<SettingsGroup title="Tell me when">
  <section class="pad kinds" class:dim={!cfg.enabled}>
    {#each NOTIFY_KINDS as k (k.key)}
      <SwitchRow title={k.title} detail={k.detail} checked={cfg[k.key]} disabled={!cfg.enabled} onchange={(checked) => void model.setNotify({ [k.key]: checked })} />
    {/each}
  </section>
</SettingsGroup>

{#if native}
  <SettingsGroup title="Battery">
    <section class="pad">
      <p class="note">
        {#if st.batteryUnrestricted}Android lets this app run in the background without limits. Good.
        {:else}Android may put this app to sleep when the screen is off, and then you miss notifications.{/if}
      </p>
      {#if !st.batteryUnrestricted}
        <button class="btn" onclick={() => void model.askBattery()}><Codicon name="zap" /> Allow background activity</button>
      {/if}
      <button class="btn quiet" onclick={() => model.openBatterySettings()}><Codicon name="settings-gear" /> Open battery settings</button>
      <p class="hint">
        <strong>Samsung:</strong> open <em>Settings → Battery → Background usage limits</em>, then add OpenCode to <em>Never sleeping apps</em>, and take it out of <em>Sleeping apps</em> and
        <em>Deep sleeping apps</em>. Other phones: look for “Unrestricted” or “Don't optimise” under the app's battery settings.
      </p>
    </section>
  </SettingsGroup>
{/if}

<style>
  .kinds.dim {
    opacity: 0.5;
  }
  .servers {
    list-style: none;
    margin: 4px 0 12px;
    padding: 0;
    font-size: 0.92em;
  }
  .servers li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }
  .servers .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--oc-amber);
  }
  .servers .dot.up {
    background: var(--oc-ok);
  }
  .btn {
    margin: 6px 8px 6px 0;
  }
  .hint {
    margin: 10px 0 0;
    color: var(--oc-muted);
    font-size: 0.87em;
    line-height: 1.45;
  }
</style>
