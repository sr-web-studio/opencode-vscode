<script lang="ts">
  import { onMount, tick } from "svelte"
  import {
    attachmentFromUri,
    checkBlob,
    dataUri,
    droppedFileUris,
    isImageMime,
    mimeFromName,
    modelTakesImages,
    type Attachment,
  } from "@occ/core/attachments"
  import { mergeDictation } from "@occ/core/dictation"
  import { micLabel, micTitle } from "@occ/core/local-voice"
  import { languageCode, languageLabel, languageTitle } from "@occ/core/voice-catalog"
  import { shouldFocusPrompt } from "@occ/core/focus"
  import { cycleAgent, findModel } from "@occ/core/models"
  import { promptHeight } from "@occ/core/prompt-height"
  import type { AppState } from "@occ/core/protocol"
  import {
    applySuggestion,
    commandBlock,
    isClientCommand,
    parseSlash,
    skillsFilter,
    slashQuery,
    suggestCommands,
    suggestSkills,
    undoTarget,
    type ClientCommandName,
    type Suggestion,
  } from "@occ/core/slash"
  import { isRunning } from "@occ/core/transcript/reducer"
  import { focusGuarded, focusWhenAllowed, readFocusEnv } from "../focus"
  import { useStore } from "../context"
  import AgentModelPicker from "./AgentModelPicker.svelte"
  import Chip from "./Chip.svelte"
  import Codicon from "./Codicon.svelte"
  import McpPanel from "./McpPanel.svelte"
  import SlashPopup from "./SlashPopup.svelte"

  let { app, text = $bindable() }: { app: AppState; text: string } = $props()
  const store = useStore()
  const caps = store.bridge.capabilities ?? {}

  const MIN_LINES = 2
  const MAX_LINES = 12

  let area: HTMLTextAreaElement | undefined = $state()
  let files = $state<Attachment[]>([])
  let note = $state("")
  // A short remark about a slash command that cannot run now. Not an error, so it is muted and goes away when typing.
  let hint = $state("")
  // Skills chosen with `/skills`: sent with the next prompt.
  let skills = $state<Array<{ id: string; name: string }>>([])
  let caret = $state(0)
  let active = $state(0)
  // Esc closes the popup for the text it was closed on; any edit brings it back.
  let dismissedFor = $state<string | undefined>(undefined)
  let dragging = $state(false)
  let seq = 0
  // The text that a revert put into the box, so Redo only clears it when the user did not change it.
  let restored: string | undefined

  const running = $derived(isRunning(app.view) || (app.target.kind === "session" && app.running.includes(app.target.id)))
  const canSend = $derived((text.trim().length > 0 || files.length > 0) && app.connection.status === "connected" && !app.sending)
  const imageOK = $derived(modelTakesImages(findModel(app.models, app.model)?.input))

  /* -------------------------------------------------------- slash popup */

  const filter = $derived(skillsFilter(text))
  const slash = $derived(filter === undefined ? slashQuery(text, caret) : undefined)
  const items = $derived<Suggestion[]>(
    filter !== undefined ? suggestSkills(filter, app.skills) : slash ? suggestCommands(slash.query, app.commands) : [],
  )
  // An empty command list hides the popup, so a plain "/path/to/file" message just sends. An empty skills list says so.
  const popup = $derived(dismissedFor !== text && !app.mcp.open && (filter !== undefined || (slash !== undefined && items.length > 0)))
  const POPUP_ID = "oc-slash"
  const activeIndex = $derived(Math.min(active, Math.max(0, items.length - 1)))
  const skillsEmpty = $derived(app.skills.length === 0 ? "This project has no skills." : "No matching skills")

  // Refresh the server's lists when the popup opens (cheap: the controller caches for a few seconds).
  let listed: "commands" | "skills" | undefined
  $effect(() => {
    const which = !popup ? undefined : filter !== undefined ? "skills" : "commands"
    if (which && which !== listed) store.dispatch({ type: which === "skills" ? "loadSkills" : "loadCommands" })
    listed = which
  })
  $effect(() => { void filter; void slash?.query; active = 0 })

  function syncCaret() { caret = area?.selectionStart ?? text.length }

  async function setText(next: string, at = next.length) {
    text = next
    caret = at
    await tick()
    area?.setSelectionRange(at, at)
    resize()
  }

  /** Accept a row: a command is completed to `/name `, a skill becomes a chip. */
  function accept(s: Suggestion) {
    if (s.source === "skill") {
      if (s.id && !skills.some((k) => k.id === s.id)) skills = [...skills, { id: s.id, name: s.name }]
      void setText("")
    } else {
      const r = applySuggestion(text, s.name)
      void setText(r.text, r.caret)
    }
    hint = ""
    void tick().then(() => focusGuarded(area))
  }

  /** Run a built-in command now. The text is already cleared by the caller. */
  function runClient(name: ClientCommandName) {
    const view = app.view
    const block = commandBlock(name, {
      hasSession: app.target.kind === "session",
      running,
      revertStaged: !!view.revert,
      canRevert: app.features.revert && !app.readOnly,
      undoTarget: undoTarget(view),
    })
    if (block) { hint = block; return }
    switch (name) {
      case "mcps": store.dispatch({ type: "mcp", op: "open" }); break
      case "compact": store.dispatch({ type: "compact" }); break
      case "fork": store.dispatch({ type: "fork" }); break
      case "redo": store.dispatch({ type: "redo" }); break
      // The same confirmation as the revert button on a prompt; the host then runs the revert and restores the prompt text.
      case "undo": store.bridge.confirmRevert(undoTarget(view)!); break
      case "skills": void setText("/skills "); break
    }
  }

  /**
   * Fit the box to its text. Runs synchronously (oninput, mount, restore, new chips, width change) so the old height is
   * never shown for a frame next to the new line. Hidden overflow while measuring keeps a scrollbar from taking width
   * and wrapping the text differently; the math itself is `promptHeight`.
   */
  function resize() {
    if (!area) return
    const cs = getComputedStyle(area)
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6
    area.style.overflowY = "hidden"
    area.style.height = "auto"
    const fit = promptHeight({ scrollHeight: area.scrollHeight, lineHeight: line, minLines: MIN_LINES, maxLines: MAX_LINES })
    area.style.height = `${fit.height}px`
    area.style.overflowY = fit.overflow
  }
  /** Explicit user action inside this view (suggestion click, after send, popover closed). Guarded: never steals focus. */
  export function focusPrompt() { focusGuarded(area) }

  /* ------------------------------------------------------------- dictation */

  // What the current recording put at the end of the box, so its next guess replaces it (`mergeDictation`).
  let dictation: { id: string; shown: string } | undefined
  // The prompt was sent while recording: words still on their way must not land in the emptied box. The host posts a
  // recording's last text before its state turns `off`, so clearing this on `off` drops exactly that recording.
  let dropDictation = false
  const recording = $derived(app.voice.recording)
  $effect(() => {
    if (recording === "off") dropDictation = false
  })

  onMount(() =>
    store.onDictation((m) => {
      if (dropDictation) return
      const shown = dictation?.id === m.id ? dictation.shown : ""
      const r = mergeDictation(text, shown, m.text)
      text = r.text
      dictation = m.done ? undefined : { id: m.id, shown: r.shown }
      void tick().then(resize)
    }),
  )

  function send() {
    if (!canSend) return
    const command = parseSlash(text)
    if (command && !command.args && files.length === 0 && isClientCommand(command.name)) {
      const name = command.name
      if (name === "skills") { runClient(name); return }
      void setText("")
      hint = ""
      runClient(name)
      return
    }
    // Sending ends the dictation.
    if (recording !== "off") {
      dropDictation = true
      if (recording === "starting" || recording === "on") store.bridge.voice()
    }
    dictation = undefined
    store.dispatch({ type: "send", text, files: files.map(({ uri, name }) => ({ uri, name })), skills: skills.map(({ id }) => ({ id })) })
    text = ""
    files = []
    skills = []
    note = ""
    hint = ""
    restored = undefined
    void tick().then(() => { resize(); focusGuarded(area) })
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return
    if (popup && items.length > 0) {
      const chosen = items[activeIndex]!
      // Typing a whole command name and pressing Enter runs it; Enter on a half-typed name completes it first.
      const typed = chosen.source !== "skill" && slash?.query.toLowerCase() === chosen.name.toLowerCase()
      if (e.key === "ArrowDown") { e.preventDefault(); active = (activeIndex + 1) % items.length; return }
      if (e.key === "ArrowUp") { e.preventDefault(); active = (activeIndex - 1 + items.length) % items.length; return }
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); accept(chosen); return }
      if (e.key === "Enter" && !e.shiftKey && !typed) { e.preventDefault(); accept(chosen); return }
    }
    // `/skills foo` with nothing to choose: Enter must not send the filter as a prompt.
    if (popup && filter !== undefined && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); return }
    if (popup && e.key === "Escape") {
      // Closes the popup only: it must not also stop the agent.
      e.preventDefault(); e.stopPropagation()
      dismissedFor = text
      return
    }
    if (e.key === "Escape" && app.mcp.open) { e.preventDefault(); store.dispatch({ type: "mcp", op: "close" }); return }
    if (e.key === "Enter" && !e.shiftKey && caps.enterSends !== false) { e.preventDefault(); send() }
    else if (e.key === "Tab" && !e.shiftKey && text === "" && app.agents.length > 1) {
      e.preventDefault()
      const next = cycleAgent(app.agents.map((a) => a.id), app.agent)
      if (next && next !== app.agent) store.dispatch({ type: "pickAgent", id: next })
    } else if (e.key === "Escape" && running) { store.dispatch({ type: "stop" }) }
  }

  /* ----------------------------------------------------------- attachments */

  function add(a: Attachment) {
    if (files.some((f) => f.uri === a.uri)) return
    files = [...files, a]
    note = ""
    void tick().then(resize)
  }

  async function pick() {
    const picked = await store.bridge.pickFiles()
    for (const p of picked) add(attachmentFromUri(`a${++seq}`, p.uri, p.name, p.mime ?? mimeFromName(p.name)))
    void tick().then(() => focusGuarded(area))
  }

  /** Read a pasted or dropped blob into a `data:` URI (≤ 20 MiB). */
  function readBlob(file: File): Promise<void> {
    const check = checkBlob({ mime: file.type || "application/octet-stream", bytes: file.size, name: file.name || "pasted file" })
    if (!check.ok) {
      note = check.reason
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : ""
        const b64 = result.slice(result.indexOf(",") + 1)
        const mime = file.type || "application/octet-stream"
        const name = file.name || `pasted.${mime.split("/")[1]?.split("+")[0] ?? "bin"}`
        add(attachmentFromUri(`a${++seq}`, dataUri(mime, b64), name, mime))
        resolve()
      }
      reader.onerror = () => {
        note = "Could not read that file."
        resolve()
      }
      reader.readAsDataURL(file)
    })
  }

  function onpaste(e: ClipboardEvent) {
    const items = [...(e.clipboardData?.files ?? [])]
    if (items.length === 0) return
    e.preventDefault()
    for (const f of items) void readBlob(f)
  }

  function ondragover(e: DragEvent) {
    const t = e.dataTransfer?.types ?? []
    if (t.includes("Files") || t.includes("text/uri-list") || t.includes("application/vnd.code.uri-list") || t.includes("resourceurls")) {
      e.preventDefault()
      dragging = true
    }
  }

  function ondrop(e: DragEvent) {
    dragging = false
    const dt = e.dataTransfer
    if (!dt) return
    e.preventDefault()
    // From the VS Code Explorer: file:// URIs. From the OS: real File objects (images become data: URIs).
    const uris = droppedFileUris({
      uriList: dt.getData("text/uri-list"),
      codeUriList: dt.getData("application/vnd.code.uri-list"),
      resourceUrls: dt.getData("resourceurls"),
      text: dt.getData("text/plain"),
    })
    for (const uri of uris) add(attachmentFromUri(`a${++seq}`, uri, undefined, mimeFromName(uri)))
    if (uris.length === 0) for (const f of [...dt.files]) void readBlob(f)
  }

  /* --------------------------------------------------------------- focus */

  // Typing is sized synchronously in `oninput`; this covers text set by code (send clears it, a revert restores it).
  $effect(() => { void text; void tick().then(() => { resize(); syncCaret() }) })
  // A narrower or wider panel re-wraps the text. Only a width change matters: our own height changes also fire the
  // observer and must not loop.
  $effect(() => {
    if (!area || typeof ResizeObserver === "undefined") return
    let width = area.clientWidth
    const observer = new ResizeObserver(() => {
      const next = area?.clientWidth ?? width
      if (next === width) return
      width = next
      resize()
    })
    observer.observe(area)
    return () => observer.disconnect()
  })
  // The host bumps this counter only for explicit requests (`+`, a revert). The state object itself is replaced on
  // every emit, so the effect must depend on this derived number and nothing broader.
  const focusRequest = $derived(app.focusTick)
  let seenRequest: number | undefined
  $effect(() => {
    const next = focusRequest
    const prev = seenRequest
    seenRequest = next
    if (shouldFocusPrompt(prev, next, readFocusEnv(area))) void tick().then(() => focusWhenAllowed(() => area))
  })

  // Revert puts the prompt text back. Redo (restore cleared by the host) empties it only if it is still unchanged.
  const restoreTick = $derived(app.restore?.tick)
  const restoreText = $derived(app.restore?.text)
  let seenRestore: number | undefined
  $effect(() => {
    const tickNow = restoreTick
    const textNow = restoreText
    if (tickNow === seenRestore) return
    seenRestore = tickNow
    if (tickNow !== undefined && textNow !== undefined) {
      text = textNow
      restored = textNow
    }
  })
  const reverted = $derived(!!app.view.revert)
  let wasReverted = false
  $effect(() => {
    const now = reverted
    if (wasReverted && !now && restored !== undefined) {
      if (text === restored) text = ""
      restored = undefined
    }
    wasReverted = now
  })

  // First time the box is shown (also after a question closes). Only if this view already has the keyboard.
  onMount(() => {
    resize()
    focusWhenAllowed(() => area)
  })
</script>

<div class="box">
  <div class="anchor">
  {#if popup}
    <SlashPopup id={POPUP_ID} {items} index={activeIndex} label={filter !== undefined ? "Skills" : "Slash commands"} empty={skillsEmpty} onpick={accept} onhover={(i) => (active = i)} />
  {/if}
  {#if app.mcp.open}<McpPanel {app} returnTo={area} />{/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="input" class:drag={dragging} {ondragover} ondragleave={() => (dragging = false)} {ondrop}>
    {#if files.length > 0 || skills.length > 0}
      <div class="chips">
        {#each skills as k (k.id)}
          <Chip name="skill: {k.name}" icon="sparkle" onremove={() => (skills = skills.filter((x) => x.id !== k.id))} />
        {/each}
        {#each files as f (f.id)}
          <Chip name={f.name} mime={f.mime} thumb={f.thumb} warn={isImageMime(f.mime) && !imageOK ? "This model does not take images" : undefined} onremove={() => (files = files.filter((x) => x.id !== f.id))} />
        {/each}
      </div>
    {/if}
    <textarea
      bind:this={area}
      bind:value={text}
      {onkeydown}
      {onpaste}
      oninput={() => { resize(); syncCaret(); hint = "" }}
      onkeyup={syncCaret}
      onclick={syncCaret}
      rows="2"
      placeholder={running ? "Steer: OpenCode reads it at its next step" : "Ask OpenCode, or type / for commands"}
      aria-label="Message"
      role="combobox"
      aria-expanded={popup}
      aria-haspopup="listbox"
      aria-controls={popup ? POPUP_ID : undefined}
      aria-activedescendant={popup && items.length > 0 ? `${POPUP_ID}-${activeIndex}` : undefined}
      aria-autocomplete="list"
    ></textarea>
    <div class="actions">
      <button class="clip muted" onclick={pick} title="Attach files" aria-label="Attach files"><Codicon name="attach" /></button>
      <span class="grow"></span>
      <!-- On-device engine: the spoken language. A click switches to the next active language. `mousedown` is not allowed to
           move focus, so the caret stays in the prompt box; the keyboard reaches it with Tab (Enter/Space switch). -->
      {#if caps.voice !== false && app.voice.engine === "local"}
        <button
          class="lang muted"
          class:off={recording !== "off"}
          aria-disabled={recording !== "off"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => recording === "off" && store.bridge.voiceLanguage()}
          title={languageTitle(app.voice.languages)}
          aria-label={languageLabel(app.voice.languages)}
        >{languageCode(app.voice.languages[0] ?? "en")}</button>
      {/if}
      <!-- When it cannot start yet (no Soniox key) the mic only looks disabled: a click opens the key dialog, so it stays focusable and clickable. -->
      {#if caps.voice !== false}
      <button
        class="mic muted"
        class:off={!app.voice.ready}
        class:rec={recording === "on"}
        class:wait={recording === "starting" || recording === "stopping"}
        aria-disabled={!app.voice.ready}
        aria-pressed={app.voice.ready ? recording !== "off" : undefined}
        onclick={() => store.bridge.voice()}
        title={micTitle({ engine: app.voice.engine, ready: app.voice.ready, recording })}
        aria-label={micLabel({ engine: app.voice.engine, ready: app.voice.ready, recording })}
      >{#if recording === "starting" || recording === "stopping"}<Codicon name="loading" spin />{:else if recording === "on"}<Codicon name="record" />{:else}<Codicon name="mic" />{/if}</button>
      {/if}
      {#if running}
        <button class="stop" onclick={() => store.dispatch({ type: "stop" })} title="Stop (Esc)" aria-label="Stop"><span class="sq"></span></button>
      {/if}
      <button class="send" onclick={send} disabled={!canSend} title={caps.enterSends === false ? "Send" : "Send (Enter)"} aria-label="Send"><Codicon name="arrow-up" /></button>
    </div>
  </div>
  </div>
  {#if note}<div class="note err small" role="alert">{note}</div>{/if}
  {#if hint}<div class="note muted small" role="status">{hint}</div>{/if}
  <AgentModelPicker {app} />
</div>

<style>
  .anchor { position: relative; }
  .box { padding: 0.3em var(--oc-side) 0.7em; display: flex; flex-direction: column; gap: 0.35em; }
  .input { display: flex; flex-direction: column; gap: 0.35em; border: 1px solid var(--vscode-input-border, var(--oc-hairline)); background: var(--vscode-input-background); border-radius: 6px; padding: 0.4em 0.55em; }
  .input:focus-within { border-color: var(--vscode-focusBorder); }
  .input.drag { border-color: var(--oc-accent); border-style: dashed; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4em; }
  /* No padding or border, so `scrollHeight` is exactly the text height. Overflow is set by `resize` (auto only past 12 lines). */
  textarea { box-sizing: border-box; width: 100%; resize: none; border: none; outline: none; background: transparent; line-height: 1.6; padding: 0; margin: 0; min-width: 0; overflow-x: hidden; overflow-y: hidden; scrollbar-gutter: auto; }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  .actions { display: flex; align-items: center; gap: 0.4em; }
  .grow { flex: 1; }
  .clip { display: inline-flex; align-items: center; padding: 0.2em 0.3em; border-radius: 4px; }
  .clip:hover { color: var(--oc-fg); background: var(--oc-hover); }
  .lang { display: inline-flex; align-items: center; padding: 0.2em 0.35em; border-radius: 4px; font-size: 0.78em; font-weight: 600; letter-spacing: 0.04em; line-height: 1.6; }
  .lang:hover { color: var(--oc-fg); background: var(--oc-hover); }
  .lang.off { opacity: 0.45; }
  .mic { display: inline-flex; align-items: center; padding: 0.2em 0.3em; border-radius: 4px; }
  .mic:hover { color: var(--oc-fg); background: var(--oc-hover); }
  .mic.off { opacity: 0.45; }
  .mic.off:hover { opacity: 0.8; }
  .mic.rec { color: var(--vscode-errorForeground, #f14c4c); animation: oc-pulse 1.4s ease-in-out infinite; }
  .mic.wait { color: var(--oc-fg); }
  @keyframes oc-pulse { 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) { .mic.rec { animation: none; } }
  .send { width: 1.8em; height: 1.8em; border-radius: 50%; background: var(--vscode-button-background); color: var(--vscode-button-foreground); display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .send:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .stop { width: 1.8em; height: 1.8em; border-radius: 50%; border: 1px solid var(--oc-muted); display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .stop:hover { border-color: var(--oc-fg); }
  .sq { width: 0.55em; height: 0.55em; background: var(--oc-fg); border-radius: 1px; }
  .note { padding: 0 0.2em; }
</style>
