<script lang="ts">
  import { onMount } from "svelte"
  import { filterSections, markdownLite, matchesQuery, type SettingsState } from "../extension/settings-model"
  import { onMessage, send } from "./bridge"
  import Control from "./Control.svelte"
  import Section from "./Section.svelte"

  type NavItem = { id: string; title: string }

  let settings = $state<SettingsState | undefined>(undefined)
  let query = $state("")
  let active = $state("connection")
  let toast = $state<{ level: "info" | "error"; message: string } | undefined>(undefined)
  let timedOut = $state(false)
  let content = $state<HTMLElement | undefined>(undefined)
  let timeout: ReturnType<typeof setTimeout> | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const sections = $derived(settings ? filterSections(settings.sections, query) : [])
  const secrets = $derived((settings?.secrets ?? []).filter((row) => matchesQuery(`${row.label} ${row.description}`, query)))
  const actions = $derived((settings?.actions ?? []).filter((row) => matchesQuery(`${row.label} ${row.description}`, query)))
  const actionGroups = $derived.by(() => {
    const groups: { title: string; rows: SettingsState["actions"] }[] = []
    for (const row of actions) {
      const title = row.group ?? "Actions"
      const group = groups.find((item) => item.title === title)
      if (group) group.rows.push(row)
      else groups.push({ title, rows: [row] })
    }
    return groups
  })
  const companionCommands = $derived((settings?.companion.commands ?? []).filter((row) => matchesQuery(`${row.label} ${row.description}`, query)))
  const aboutLinks = $derived((settings?.about.links ?? []).filter((link) => matchesQuery(`${link.label} ${link.description ?? ""}`, query)))
  const enhanceVisible = $derived(!!settings && (!query.trim() || matchesQuery("Enhance prompt model sparkle reset server default", query)))
  const companionVisible = $derived(!!settings && (!query.trim() || matchesQuery("Voice companion microphone log downloaded languages attention", query) || companionCommands.length > 0))
  const aboutVisible = $derived(!!settings && (!query.trim() || matchesQuery("About version marketplace GitHub issues mobile setup unofficial", query) || aboutLinks.length > 0))
  const hasAccess = $derived(secrets.length > 0 || actions.length > 0)

  const nav: NavItem[] = $derived.by(() => {
    const items: NavItem[] = sections.map((section) => ({ id: `settings-${section.id}`, title: section.title }))
    if (hasAccess) items.push({ id: "access", title: "Access & actions" })
    if (enhanceVisible) items.push({ id: "enhance", title: "Enhance prompt" })
    if (companionVisible) items.push({ id: "companion", title: "Voice companion" })
    if (aboutVisible) items.push({ id: "about", title: "About" })
    return items
  })
  const nothing = $derived(!!settings && nav.length === 0)

  // Keep the highlighted section valid when the search hides the current one.
  $effect(() => {
    if (nav.length > 0 && !nav.some((item) => item.id === active)) active = nav[0]!.id
  })

  function showToast(level: "info" | "error", message: string) {
    toast = { level, message }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = undefined), level === "error" ? 7000 : 4000)
  }

  function retry() {
    timedOut = false
    send({ type: "ready" })
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      if (!settings) timedOut = true
    }, 8000)
  }

  function jump(id: string) {
    active = id
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  function track() {
    if (!content) return
    let current = ""
    for (const node of content.querySelectorAll<HTMLElement>("[data-nav]")) {
      if (node.offsetTop <= content.scrollTop + 80) current = node.dataset.nav ?? current
    }
    if (current) active = current
  }

  onMount(() => {
    const off = onMessage((message) => {
      if (message.type === "state") {
        settings = message.state
        timedOut = false
        if (timeout) clearTimeout(timeout)
      } else if (message.type === "toast") {
        showToast(message.level, message.message)
      }
    })
    timeout = setTimeout(() => {
      if (!settings) timedOut = true
    }, 8000)
    send({ type: "ready" })
    return () => {
      off()
      if (timeout) clearTimeout(timeout)
      if (toastTimer) clearTimeout(toastTimer)
    }
  })
</script>

<header class="topbar">
  <div class="title-row">
    <span class="codicon codicon-settings-gear title-icon" aria-hidden="true"></span>
    <h1>OpenCode Settings</h1>
    {#if settings}<span class="version">v{settings.version}</span>{/if}
    <button class="link open-ui" type="button" onclick={() => send({ type: "openSettings" })} title="Open VS Code's Settings UI filtered to this extension"> Open in Settings UI </button>
  </div>
  <div class="search-row">
    <div class="search">
      <span class="codicon codicon-search" aria-hidden="true"></span>
      <input type="search" placeholder="Search settings" aria-label="Search settings" bind:value={query} />
      {#if query}
        <button class="clear" type="button" aria-label="Clear search" onclick={() => (query = "")}><span class="codicon codicon-close" aria-hidden="true"></span></button>
      {/if}
    </div>
    <span class="scope-note" title="Machine settings are always saved in User settings.">Saved in User settings</span>
  </div>
</header>

{#if !settings}
  <div class="center">
    {#if timedOut}
      <span class="codicon codicon-warning big" aria-hidden="true"></span>
      <p>The settings page did not respond.</p>
      <button class="primary" type="button" onclick={retry}>Try again</button>
    {:else}
      <span class="codicon codicon-loading spin big" aria-hidden="true"></span>
      <p>Loading settings…</p>
    {/if}
  </div>
{:else}
  <div class="body">
    <nav class="nav" aria-label="Settings sections">
      {#each nav as item (item.id)}
        <button type="button" class:active={active === item.id} onclick={() => jump(item.id)}>{item.title}</button>
      {/each}
    </nav>

    <main class="content" bind:this={content} onscroll={track}>
      {#if nothing}
        <div class="center">
          <span class="codicon codicon-search big" aria-hidden="true"></span>
          <p>No settings match “{query}”.</p>
          <button class="primary" type="button" onclick={() => (query = "")}>Clear search</button>
        </div>
      {/if}

      {#each sections as section (section.id)}
        <Section id={`settings-${section.id}`} title={section.title}>
          {#each section.controls as control (control.key)}
            <Control {control} />
          {/each}
        </Section>
      {/each}

      {#if hasAccess}
        <Section id="access" title="Access & actions">
          {#if secrets.length}
            <h3 class="group">Secrets</h3>
            {#each secrets as row (row.id)}
              <div class="row custom">
                <div class="text">
                  <div class="label">
                    {row.label}
                    <span class="badge" class:set={row.set} class:unset={!row.set}>{row.set ? "Set" : "Not set"}</span>
                  </div>
                  <p class="desc">{@html markdownLite(row.description)}</p>
                </div>
                <div class="buttons">
                  <button class="primary" type="button" onclick={() => send({ type: "command", command: row.setCommand })}>{row.set ? "Change…" : "Set…"}</button>
                  {#if row.set}
                    <button type="button" onclick={() => send({ type: "command", command: row.clearCommand })}>Clear</button>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}

          {#each actionGroups as group (group.title)}
            <h3 class="group">{group.title}</h3>
            {#each group.rows as row (row.id)}
              <div class="row custom">
                <div class="text">
                  <div class="label">
                    {#if row.icon}<span class="codicon codicon-{row.icon}" aria-hidden="true"></span>{/if}
                    {row.label}
                  </div>
                  <p class="desc">{row.description}</p>
                </div>
                <div class="buttons">
                  <button type="button" onclick={() => send({ type: "command", command: row.command })}>{row.button ?? "Run"}</button>
                </div>
              </div>
            {/each}
          {/each}
        </Section>
      {/if}

      {#if enhanceVisible}
        <Section id="enhance" title="Enhance prompt">
          <div class="row custom">
            <div class="text">
              <div class="label">Enhance prompt model</div>
              <p class="desc">
                {#if settings.enhance}
                  <code>{settings.enhance.providerID}/{settings.enhance.id}</code>{#if settings.enhance.variant}<span class="muted"> · {settings.enhance.variant}</span>{/if}
                {:else}
                  Using the server's default model.
                {/if}
              </p>
              <p class="hint">Choose the model from the sparkle (✦) menu in the chat's prompt box. This page can only reset it.</p>
            </div>
            <div class="buttons">
              <button type="button" disabled={!settings.enhance} onclick={() => send({ type: "resetEnhance" })}>Reset to server default</button>
            </div>
          </div>
        </Section>
      {/if}

      {#if companionVisible}
        <Section id="companion" title="Voice companion">
          {#if settings.companion.installed}
            <p class="note">
              <span class="codicon codicon-check" aria-hidden="true"></span>
              OpenCode Voice{settings.companion.version ? ` ${settings.companion.version}` : ""} is installed on this computer.
            </p>
          {:else}
            <p class="note disabled-note">
              <span class="codicon codicon-info" aria-hidden="true"></span>
              OpenCode Voice is not installed. It ships inside this extension and installs itself the first time you use voice input, so these actions stay disabled until then.
            </p>
          {/if}
          {#each companionCommands as row (row.id)}
            <div class="row custom" class:disabled={!settings.companion.installed}>
              <div class="text">
                <div class="label">{row.label}</div>
                <p class="desc">{row.description}</p>
              </div>
              <div class="buttons">
                <button type="button" disabled={!settings.companion.installed} onclick={() => send({ type: "command", command: row.command })}>{row.button ?? "Open"}</button>
              </div>
            </div>
          {/each}
        </Section>
      {/if}

      {#if aboutVisible}
        <Section id="about" title="About">
          <div class="row custom">
            <div class="text">
              <div class="label">OpenCode (unofficial) <span class="muted">v{settings.about.version}</span></div>
              <p class="desc">{settings.about.note}</p>
            </div>
          </div>
          {#each aboutLinks as link (link.url)}
            <div class="row custom">
              <div class="text">
                <div class="label">{link.label}</div>
                {#if link.description}<p class="desc">{link.description}</p>{/if}
              </div>
              <div class="buttons">
                <button type="button" onclick={() => send({ type: "openExternal", url: link.url })}>Open</button>
              </div>
            </div>
          {/each}
        </Section>
      {/if}
    </main>
  </div>
{/if}

{#if toast}
  <div class="toast" class:error={toast.level === "error"} role="status">
    <span class="codicon codicon-{toast.level === 'error' ? 'error' : 'info'}" aria-hidden="true"></span>
    <span class="msg">{toast.message}</span>
    <button class="icon" type="button" aria-label="Dismiss" onclick={() => (toast = undefined)}><span class="codicon codicon-close" aria-hidden="true"></span></button>
  </div>
{/if}
