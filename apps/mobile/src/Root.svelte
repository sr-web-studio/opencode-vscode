<script lang="ts">
  import { onMount } from "svelte"
  import Drawer from "./components/Drawer.svelte"
  import Overlays from "./components/Overlays.svelte"
  import { model } from "./model.svelte"
  import ChangesScreen from "./screens/ChangesScreen.svelte"
  import ChatScreen from "./screens/ChatScreen.svelte"
  import DiffScreen from "./screens/DiffScreen.svelte"
  import FileScreen from "./screens/FileScreen.svelte"
  import ImageScreen from "./screens/ImageScreen.svelte"
  import ProjectsScreen from "./screens/ProjectsScreen.svelte"
  import ServerFormScreen from "./screens/ServerFormScreen.svelte"
  import ServersScreen from "./screens/ServersScreen.svelte"
  import SettingsScreen from "./screens/SettingsScreen.svelte"
  import SessionsScreen from "./screens/SessionsScreen.svelte"
  import ShellScreen from "./screens/ShellScreen.svelte"
  import WorkerScreen from "./screens/WorkerScreen.svelte"

  onMount(() => void model.init())
</script>

{#if !model.ready}
  <div class="screen"><div class="center muted">Loading…</div></div>
{:else}
  <!-- Every screen of the stack stays mounted: the one below keeps its scroll position and its unsent text. -->
  {#each model.stack as entry, i (entry.key)}
    {@const s = entry.screen}
    <div class="screen" class:under={i < model.stack.length - 1} inert={i < model.stack.length - 1 || model.drawerOpen || undefined}>
      {#if s.kind === "servers"}<ServersScreen />
      {:else if s.kind === "server-form"}<ServerFormScreen key={entry.key} profileID={s.profileID} />
      {:else if s.kind === "projects"}<ProjectsScreen />
      {:else if s.kind === "sessions"}<SessionsScreen directory={s.directory} />
      {:else if s.kind === "chat"}<ChatScreen screenKey={entry.key} directory={s.directory} sessionID={s.sessionID} draft={s.draft} />
      {:else if s.kind === "file"}<FileScreen directory={s.directory} path={s.path} line={s.line} />
      {:else if s.kind === "diff"}<DiffScreen file={s.file} patches={s.patches} />
      {:else if s.kind === "changes"}<ChangesScreen directory={s.directory} title={s.title} files={s.files} />
      {:else if s.kind === "shell"}<ShellScreen directory={s.directory} shellID={s.shellID} title={s.title} sessionID={s.sessionID} />
      {:else if s.kind === "worker"}<WorkerScreen directory={s.directory} sessionID={s.sessionID} />
      {:else if s.kind === "image"}<ImageScreen directory={s.directory} sessionID={s.sessionID} imageRef={s.ref} name={s.name} />
      {/if}
    </div>
  {/each}
  <!-- Settings is a layer over the stack (it is not an entry of nav.ts): back and any new screen close it. -->
  {#if model.settingsOpen}
    <div class="screen"><SettingsScreen /></div>
  {/if}
  <Drawer />
{/if}

<Overlays />
