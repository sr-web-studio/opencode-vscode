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
  } from "../../core/attachments"
  import { mergeDictation } from "../../core/dictation"
  import { micLabel, micTitle } from "../../core/local-voice"
  import { shouldFocusPrompt } from "../../core/focus"
  import { cycleAgent, findModel } from "../../core/models"
  import { promptHeight } from "../../core/prompt-height"
  import type { AppState } from "../../core/protocol"
  import { isRunning } from "../../core/transcript/reducer"
  import { focusGuarded, focusWhenAllowed, readFocusEnv } from "../focus"
  import { useStore } from "../context"
  import AgentModelPicker from "./AgentModelPicker.svelte"
  import Chip from "./Chip.svelte"
  import Codicon from "./Codicon.svelte"

  let { app, text = $bindable() }: { app: AppState; text: string } = $props()
  const store = useStore()

  const MIN_LINES = 2
  const MAX_LINES = 12

  let area: HTMLTextAreaElement | undefined = $state()
  let files = $state<Attachment[]>([])
  let note = $state("")
  let dragging = $state(false)
  let seq = 0
  // The text that a revert put into the box, so Redo only clears it when the user did not change it.
  let restored: string | undefined

  const running = $derived(isRunning(app.view) || (app.target.kind === "session" && app.running.includes(app.target.id)))
  const canSend = $derived((text.trim().length > 0 || files.length > 0) && app.connection.status === "connected" && !app.sending)
  const imageOK = $derived(modelTakesImages(findModel(app.models, app.model)?.input))

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
    // Sending ends the dictation.
    if (recording !== "off") {
      dropDictation = true
      if (recording === "starting" || recording === "on") store.bridge.voice()
    }
    dictation = undefined
    store.dispatch({ type: "send", text, files: files.map(({ uri, name }) => ({ uri, name })) })
    text = ""
    files = []
    note = ""
    restored = undefined
    void tick().then(() => { resize(); focusGuarded(area) })
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
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
  $effect(() => { void text; void tick().then(resize) })
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
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="input" class:drag={dragging} {ondragover} ondragleave={() => (dragging = false)} {ondrop}>
    {#if files.length > 0}
      <div class="chips">
        {#each files as f (f.id)}
          <Chip name={f.name} mime={f.mime} thumb={f.thumb} warn={isImageMime(f.mime) && !imageOK ? "This model does not take images" : undefined} onremove={() => (files = files.filter((x) => x.id !== f.id))} />
        {/each}
      </div>
    {/if}
    <textarea bind:this={area} bind:value={text} {onkeydown} {onpaste} oninput={resize} rows="2" placeholder={running ? "Steer: OpenCode reads it at its next step" : "Ask OpenCode"} aria-label="Message"></textarea>
    <div class="actions">
      <button class="clip muted" onclick={pick} title="Attach files" aria-label="Attach files"><Codicon name="attach" /></button>
      <span class="grow"></span>
      <!-- When it cannot start yet (no Soniox key) the mic only looks disabled: a click opens the key dialog, so it stays focusable and clickable. -->
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
      {#if running}
        <button class="stop" onclick={() => store.dispatch({ type: "stop" })} title="Stop (Esc)" aria-label="Stop"><span class="sq"></span></button>
      {/if}
      <button class="send" onclick={send} disabled={!canSend} title="Send (Enter)" aria-label="Send"><Codicon name="arrow-up" /></button>
    </div>
  </div>
  {#if note}<div class="note err small" role="alert">{note}</div>{/if}
  <AgentModelPicker {app} />
</div>

<style>
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
