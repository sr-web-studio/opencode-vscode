<script lang="ts">
  import SettingsGroup from "../../components/settings/SettingsGroup.svelte"
  import { openInBrowser } from "../../lib/platform"
  import { ISSUES_LABEL, ISSUES_URL, SETUP_GUIDE_LABEL, SETUP_GUIDE_URL } from "../../lib/texts"
  import { aboutLine } from "../../lib/version"
  import { model } from "../../model.svelte"

  async function reset() {
    const ok = await model.confirm({
      title: "Reset app settings?",
      detail: "Chat display and the enhance-prompt model go back to their defaults. Saved servers, sessions, passwords and the notification switches stay as they are.",
      confirm: "Reset",
    })
    if (!ok) return
    model.resetAppSettings()
    model.notify("info", "Settings are back to their defaults.")
  }
</script>

<SettingsGroup title="About">
  <section class="pad">
    <p class="version">{aboutLine()}</p>
    <button class="link" onclick={() => void openInBrowser(SETUP_GUIDE_URL)}>{SETUP_GUIDE_LABEL}</button>
    <button class="link" onclick={() => void openInBrowser(ISSUES_URL)}>{ISSUES_LABEL}</button>
    <p class="note">OpenCode belongs to the OpenCode team. This app is an unofficial client made by other people, and is not affiliated with them.</p>
  </section>
</SettingsGroup>

<SettingsGroup title="Reset">
  <section class="pad">
    <p class="note">Put chat display and the enhance-prompt model back to their defaults. This never deletes servers, sessions, passwords or the notification switches.</p>
    <button class="btn quiet reset" onclick={() => void reset()}>Reset app settings</button>
  </section>
</SettingsGroup>

<style>
  .version {
    margin: 0 0 8px;
    color: var(--oc-muted);
    font-size: 0.87em;
    line-height: 1.45;
  }
  .link {
    display: block;
    min-height: var(--touch);
    padding: 0;
    font: inherit;
    color: var(--vscode-textLink-foreground, #3794ff);
    background: none;
    border: 0;
    text-align: left;
    text-decoration: underline;
    cursor: pointer;
  }
  .reset {
    width: 100%;
    margin-top: 8px;
  }
</style>
