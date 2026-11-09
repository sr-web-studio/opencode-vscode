<script lang="ts">
  import Bar from "../components/Bar.svelte"
  import AboutSettings from "./settings/AboutSettings.svelte"
  import ChatDisplaySettings from "./settings/ChatDisplaySettings.svelte"
  import EnhanceSettings from "./settings/EnhanceSettings.svelte"
  import NotificationSettings from "./settings/NotificationSettings.svelte"
  import ServerSettings from "./settings/ServerSettings.svelte"
</script>

<Bar title="Settings" sub="This phone" />

<div class="body">
  <ChatDisplaySettings />
  <EnhanceSettings />
  <NotificationSettings />
  <ServerSettings />
  <AboutSettings />
</div>
