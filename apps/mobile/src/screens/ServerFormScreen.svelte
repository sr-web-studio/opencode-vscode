<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import Bar from "../components/Bar.svelte"
  import { testConnection } from "../lib/client"
  import { looksLikePairingLink } from "../lib/pairing-link"
  import { scanQr } from "../lib/platform"
  import { hostOf } from "../lib/profiles"
  import { model } from "../model.svelte"

  /** Add a server (URL + password, a scanned QR code, or a pasted pairing link) or edit a saved one. */
  let { key, profileID }: { key: number; profileID?: string } = $props()

  // svelte-ignore state_referenced_locally
  const existing = profileID ? model.profiles.find((p) => p.id === profileID) : undefined
  // svelte-ignore state_referenced_locally
  let name = $state(existing?.name ?? "")
  // svelte-ignore state_referenced_locally
  let url = $state(existing?.url ?? "")
  let password = $state("")
  // svelte-ignore state_referenced_locally
  let serverId = $state(existing?.serverId ?? "")
  let link = $state("")
  let busy = $state<"" | "test" | "save" | "scan" | "pair">("")
  let result = $state<{ ok: boolean; text: string } | undefined>()

  const defaultId = $derived(hostOf(url))

  async function scan() {
    busy = "scan"
    result = undefined
    const r = await scanQr()
    busy = ""
    if (!r.ok) {
      if (!r.cancelled) result = { ok: false, text: r.message }
      return
    }
    if (!looksLikePairingLink(r.value)) {
      result = { ok: false, text: "This QR code is not an OpenCode pairing code. Use the one from “Pair mobile device”." }
      return
    }
    await pair(r.value)
  }

  async function pair(text: string) {
    busy = "pair"
    result = undefined
    const r = await model.pair(text)
    busy = ""
    if (!r.ok) {
      result = { ok: false, text: r.message }
      return
    }
    model.finishForm(key, r.profile)
  }

  async function test() {
    busy = "test"
    result = undefined
    const pw = password || existing?.password || ""
    const r = await testConnection({ url: url.trim(), password: pw })
    busy = ""
    result = r.ok ? { ok: true, text: `Connected. OpenCode ${r.version}${r.hostname ? ` on ${r.hostname}` : ""}.` } : { ok: false, text: r.message }
  }

  async function save() {
    busy = "save"
    result = undefined
    try {
      const saved = await model.saveProfile({ id: existing?.id, name, url, password, serverId })
      busy = ""
      model.finishForm(key, saved)
    } catch (e) {
      busy = ""
      result = { ok: false, text: e instanceof Error ? e.message : "Could not save the server." }
    }
  }

  async function remove() {
    if (!existing) return
    const ok = await model.confirm({
      title: `Remove “${existing.name}”?`,
      detail: "The saved address and password are deleted from this phone. Nothing changes on the server.",
      confirm: "Remove",
      danger: true,
    })
    if (!ok) return
    await model.removeProfile(existing.id)
    model.close(key)
  }
</script>

<Bar title={existing ? "Edit server" : "Add server"} />

<div class="body pad">
  {#if !existing}
    <section class="pairing">
      <button class="btn" onclick={scan} disabled={busy !== ""}>
        {#if busy === "scan" || busy === "pair"}<Codicon name="loading" spin />{:else}<Codicon name="device-camera" />{/if}
        Scan QR code
      </button>
      <p class="muted small">On your computer run “OpenCode: Pair Mobile Device” in VS Code and scan the code it shows.</p>
      <label class="field">
        <span>Or paste the pairing link</span>
        <textarea rows="2" bind:value={link} placeholder="http://192.168.1.10:4096/auth/connect/…" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
      </label>
      <button class="btn quiet" onclick={() => pair(link)} disabled={busy !== "" || !link.trim()}>
        {#if busy === "pair"}<Codicon name="loading" spin />{/if} Pair with this link
      </button>
    </section>
    <h2 class="or">Or enter the address and password</h2>
  {/if}

  <label class="field">
    <span>Server address</span>
    <input type="url" inputmode="url" bind:value={url} placeholder="http://192.168.1.10:4096" autocapitalize="off" autocomplete="off" spellcheck="false" />
  </label>
  <label class="field">
    <span>Password</span>
    <input type="password" bind:value={password} placeholder={existing ? "Leave empty to keep the saved password" : "Server password"} autocomplete="off" />
  </label>
  <label class="field">
    <span>Name (optional)</span>
    <input type="text" bind:value={name} placeholder={defaultId || "My computer"} autocomplete="off" />
  </label>
  <label class="field">
    <span>Server id (optional)</span>
    <input type="text" bind:value={serverId} placeholder={defaultId || "host name"} autocapitalize="off" autocomplete="off" spellcheck="false" />
    <small>Notification links name the server by this id. It is the host of the address unless you change it.</small>
  </label>

  {#if existing}
    <button class="btn quiet del" onclick={remove} disabled={busy !== ""}><Codicon name="trash" /> Remove this server</button>
  {/if}
</div>

<!-- Outside the scroll area: the result and the two buttons stay on screen, above the bottom inset (the screen itself is padded by it). -->
<div class="footer">
  {#if result}<div class="note" class:err={!result.ok} class:ok={result.ok} role="status">{result.text}</div>{/if}
  <div class="actions">
    <button class="btn quiet" onclick={test} disabled={busy !== "" || !url.trim()}
      >{#if busy === "test"}<Codicon name="loading" spin />{/if} Test connection</button
    >
    <button class="btn" onclick={save} disabled={busy !== "" || !url.trim()}
      >{#if busy === "save"}<Codicon name="loading" spin />{/if} Save and open</button
    >
  </div>
</div>

<style>
  .small {
    font-size: 0.85em;
    margin: 8px 0 14px;
  }
  .pairing {
    margin-bottom: 8px;
  }
  .or {
    font-size: 0.95em;
    font-weight: 600;
    margin: 22px 0 12px;
    color: var(--oc-muted);
  }
  .footer {
    flex: none;
    max-height: 45%;
    overflow-y: auto;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--oc-hairline);
    background: var(--vscode-editor-background);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions .btn {
    flex: 1;
  }
  .del {
    margin-top: 10px;
    width: 100%;
    color: var(--oc-error);
  }
  .note {
    margin-bottom: 10px;
  }
</style>
