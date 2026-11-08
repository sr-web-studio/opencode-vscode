<script lang="ts">
  import { onMount } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import Bar from "../components/Bar.svelte"
  import { model } from "../model.svelte"
  import { NOTIFY_KINDS, ago, statusLine } from "../lib/notify"
  import { canWatchInBackground } from "../lib/notify-native"
  import { aboutLine } from "../lib/version"

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

<Bar title="Settings" sub="Background notifications" />

<div class="body">
  <section class="pad">
    <label class="switch main-switch">
      <span class="txt">
        <strong>Background notifications</strong>
        <small>Keep a quiet connection to your servers so this phone can tell you when a session needs you, also when the app is closed or the screen is off.</small>
      </span>
      <input type="checkbox" role="switch" checked={cfg.enabled} disabled={!native} onchange={(e) => void model.setNotify({ enabled: e.currentTarget.checked })} />
    </label>

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

  <h2 class="group">Tell me when</h2>
  <section class="pad kinds" class:dim={!cfg.enabled}>
    {#each NOTIFY_KINDS as k (k.key)}
      <label class="switch">
        <span class="txt"><strong>{k.title}</strong><small>{k.detail}</small></span>
        <input type="checkbox" role="switch" checked={cfg[k.key]} disabled={!cfg.enabled} onchange={(e) => void model.setNotify({ [k.key]: e.currentTarget.checked })} />
      </label>
    {/each}
  </section>

  {#if native}
    <h2 class="group">Battery</h2>
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
        <strong>Samsung:</strong> open <em>Settings → Battery → Background usage limits</em>, then add OpenCode to <em>Never sleeping apps</em>, and take it out of <em>Sleeping apps</em> and <em>Deep sleeping apps</em>.
        Other phones: look for “Unrestricted” or “Don't optimise” under the app's battery settings.
      </p>
    </section>
  {/if}

  <p class="about">{aboutLine()}</p>
</div>

<style>
  .about { margin: 24px 16px 16px; color: var(--oc-muted); font-size: 0.8em; line-height: 1.4; text-align: center; }
  .main-switch { padding-bottom: 6px; }
  .switch { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 8px 0; }
  .switch .txt { flex: 1; min-width: 0; }
  .switch strong { display: block; font-weight: 500; }
  .switch small { display: block; margin-top: 2px; color: var(--oc-muted); font-size: 0.82em; line-height: 1.35; }
  .switch input { flex: none; width: 44px; height: 26px; accent-color: var(--vscode-button-background); }
  .kinds.dim { opacity: 0.5; }
  .note { margin: 8px 0; line-height: 1.4; }
  .servers { list-style: none; margin: 4px 0 12px; padding: 0; font-size: 0.92em; }
  .servers li { display: flex; align-items: center; gap: 8px; min-height: 28px; }
  .servers .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--oc-amber); }
  .servers .dot.up { background: var(--oc-ok); }
  .btn { margin: 6px 8px 6px 0; }
  .hint { margin: 10px 0 0; color: var(--oc-muted); font-size: 0.85em; line-height: 1.45; }
  h2.group { margin: 16px 16px 0; font-size: 0.8em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--oc-muted); }
</style>
