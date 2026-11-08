<script lang="ts">
  import { tick } from "svelte"
  import type { FormField, FormInfo } from "@occ/core/api"
  import {
    OTHER,
    buildAnswer,
    clampStep,
    defaultAnswers,
    fieldTitle,
    choiceOf,
    isChoice,
    limit,
    tabsFor,
    validateField,
    validateForm,
    visibleFields,
    type Answers,
    type FormValue,
    type OtherText,
  } from "@occ/core/forms"
  import { useStore } from "../context"
  import { focusGuarded } from "../focus"

  let { form }: { form: FormInfo } = $props()
  const store = useStore()

  let answers = $state<Answers>({})
  let other = $state<OtherText>({})
  let step = $state(0)
  let hi = $state(0)
  let touched = $state<Record<string, boolean>>({})
  let busy = $state(false)
  let root: HTMLDivElement | undefined = $state()
  let currentForm = ""

  // A new form (different id) starts from its defaults.
  $effect(() => {
    if (form.id === currentForm) return
    currentForm = form.id
    answers = defaultAnswers(form.fields as FormField[])
    other = {}
    step = 0
    hi = 0
    touched = {}
    busy = false
    void tick().then(() => focusGuarded(root))
  })

  const fields = $derived(visibleFields(form.fields as FormField[], answers))
  const at = $derived(clampStep(step, fields.length))
  const field = $derived(fields[at])
  const last = $derived(at >= fields.length - 1)
  const tabs = $derived(tabsFor(form.fields as FormField[], answers, other))
  const error = $derived(field && touched[field.key] ? validateField(field, answers[field.key], other[field.key]) : undefined)

  const options = (f: FormField) => (f as { options?: { value: string; label: string; description?: string }[] }).options ?? []
  const custom = (f: FormField) => (f as { custom?: boolean }).custom === true
  const rowCount = (f: FormField) => options(f).length + (custom(f) ? 1 : 0)

  function set(key: string, value: FormValue) {
    answers = { ...answers, [key]: value }
  }

  function go(delta: number) {
    if (!field) return
    touched = { ...touched, [field.key]: true }
    if (delta > 0 && validateField(field, answers[field.key], other[field.key])) return
    step = clampStep(at + delta, fields.length)
    hi = 0
    void tick().then(() => focusGuarded(root))
  }

  async function submit() {
    if (busy) return
    const all = form.fields as FormField[]
    const errors = validateForm(all, answers, other)
    const bad = fields.findIndex((f) => errors[f.key])
    if (bad !== -1) {
      touched = { ...touched, ...Object.fromEntries(fields.map((f) => [f.key, true])) }
      step = bad
      return
    }
    busy = true
    store.dispatch({ type: "formReply", answer: buildAnswer(all, answers, other) })
  }

  function cancel() {
    if (busy) return
    busy = true
    store.dispatch({ type: "formCancel" })
  }

  /** Choose a row of a single-choice field, then move on (or submit on the last step). */
  function chooseRow(f: Extract<FormField, { type: "string" }>, i: number) {
    hi = i
    const opts = options(f)
    if (i < opts.length) {
      set(f.key, opts[i]!.value)
      advance()
    } else {
      set(f.key, OTHER)
      void tick().then(() => focusGuarded(root?.querySelector<HTMLInputElement>(".other-input")))
    }
  }

  function toggleRow(f: Extract<FormField, { type: "multiselect" }>, i: number) {
    hi = i
    const opts = options(f)
    const value = i < opts.length ? opts[i]!.value : OTHER
    const current = Array.isArray(answers[f.key]) ? (answers[f.key] as string[]) : []
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    if (!current.includes(value) && f.maxItems !== undefined && next.length > f.maxItems) return
    set(f.key, next)
    if (value === OTHER && next.includes(OTHER)) void tick().then(() => focusGuarded(root?.querySelector<HTMLInputElement>(".other-input")))
  }

  function advance() {
    if (!field) return
    touched = { ...touched, [field.key]: true }
    if (validateField(field, answers[field.key], other[field.key])) return
    if (last) void submit()
    else go(1)
  }

  function onkeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    const typing = target instanceof HTMLInputElement
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      cancel()
      return
    }
    if (!field) return
    if (e.key === "Tab" && !e.shiftKey && fields.length > 1) {
      e.preventDefault()
      go(1)
      return
    }
    if (e.key === "Tab" && e.shiftKey && fields.length > 1) {
      e.preventDefault()
      go(-1)
      return
    }
    const rows = isChoice(field) || field.type === "multiselect" ? rowCount(field) : 0
    if (typing && target.classList.contains("other-input")) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault()
        hi = Math.max(0, Math.min(rows - 1, hi + (e.key === "ArrowDown" ? 1 : -1)))
        focusGuarded(root)
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (field.type === "multiselect") last ? submit() : go(1)
        else advance()
      }
      return
    }
    if (typing) {
      if (e.key === "Enter") {
        e.preventDefault()
        touched = { ...touched, [field.key]: true }
        if (last) void submit()
        else go(1)
      }
      return
    }
    if (rows > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        hi = Math.min(rows - 1, hi + 1)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        hi = Math.max(0, hi - 1)
      } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= rows) {
        e.preventDefault()
        const c = choiceOf(field)
        if (c) chooseRow(c, Number(e.key) - 1)
        else toggleRow(field as Extract<FormField, { type: "multiselect" }>, Number(e.key) - 1)
      } else if (e.key === " " && field.type === "multiselect") {
        e.preventDefault()
        toggleRow(field, hi)
      } else if (e.key === "Enter") {
        e.preventDefault()
        const c = choiceOf(field)
        if (c) chooseRow(c, hi)
        else if (last) void submit()
        else go(1)
      }
    } else if (field.type === "boolean") {
      if (e.key === "y" || e.key === "1") {
        set(field.key, true)
        advance()
      } else if (e.key === "n" || e.key === "2") {
        set(field.key, false)
        advance()
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault()
        set(field.key, e.key === "ArrowLeft")
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (answers[field.key] === undefined) set(field.key, false)
        advance()
      }
    } else if (e.key === "Enter" && field.type === "external") {
      e.preventDefault()
      advance()
    }
  }
</script>

<!-- The group owns the keyboard for the whole form (numbers, arrows, Tab, Esc). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="q" role="group" aria-label={form.title} tabindex="-1" bind:this={root} {onkeydown}>
  {#if fields.length > 1}
    <div class="tabs">
      {#each tabs as t, i (i)}
        <button
          class="tab"
          class:on={i === at}
          onclick={() => {
            step = i
            hi = 0
          }}
          >{t.label}{#if t.done}
            <span class="ok">✓</span>{/if}</button
        >
      {/each}
      <span class="count muted">{at + 1} / {fields.length}</span>
    </div>
  {/if}

  {#if field}
    <div class="head">
      <div class="title">{fieldTitle(field)}</div>
      {#if field.description}<div class="muted hdesc">{field.description}</div>{/if}
    </div>

    {#if choiceOf(field)}
      {@const choice = choiceOf(field)!}
      <div class="rows" role="listbox">
        {#each options(field) as o, i (i)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="row" class:hi={i === hi} role="option" tabindex="-1" aria-selected={answers[field.key] === o.value} onclick={() => chooseRow(choice, i)} onmousemove={() => (hi = i)}>
            <span class="num muted">{i + 1}</span>
            <span class="txt">
              <span class="lbl"
                >{o.label}{#if answers[field.key] === o.value}
                  <span class="ok">✓</span>{/if}</span
              >
              {#if o.description}<span class="muted desc">{o.description}</span>{/if}
            </span>
          </div>
        {/each}
        {#if custom(field)}
          {@const i = options(field).length}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="row" class:hi={i === hi} role="option" tabindex="-1" aria-selected={answers[field.key] === OTHER} onclick={() => chooseRow(choice, i)} onmousemove={() => (hi = i)}>
            <span class="num muted">{i + 1}</span>
            <span class="lbl">Other…</span>
            {#if answers[field.key] === OTHER}
              <input
                class="other-input"
                placeholder="Type your answer"
                value={other[field.key] ?? ""}
                oninput={(e) => (other = { ...other, [field.key]: e.currentTarget.value })}
                onfocus={() => {
                  hi = i
                }}
              />
            {/if}
          </div>
        {/if}
      </div>
    {:else if field.type === "multiselect"}
      {@const picked = Array.isArray(answers[field.key]) ? (answers[field.key] as string[]) : []}
      <div class="rows" role="listbox" aria-multiselectable="true">
        {#each options(field) as o, i (i)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="row" class:hi={i === hi} role="option" tabindex="-1" aria-selected={picked.includes(o.value)} onclick={() => toggleRow(field, i)} onmousemove={() => (hi = i)}>
            <span class="box" class:on={picked.includes(o.value)}>{picked.includes(o.value) ? "✓" : ""}</span>
            <span class="txt">
              <span class="lbl">{o.label}</span>
              {#if o.description}<span class="muted desc">{o.description}</span>{/if}
            </span>
          </div>
        {/each}
        {#if custom(field)}
          {@const i = options(field).length}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="row" class:hi={i === hi} role="option" tabindex="-1" aria-selected={picked.includes(OTHER)} onclick={() => toggleRow(field, i)} onmousemove={() => (hi = i)}>
            <span class="box" class:on={picked.includes(OTHER)}>{picked.includes(OTHER) ? "✓" : ""}</span>
            <span class="lbl">Other…</span>
            {#if picked.includes(OTHER)}
              <input
                class="other-input"
                placeholder="Type your answer"
                value={other[field.key] ?? ""}
                oninput={(e) => (other = { ...other, [field.key]: e.currentTarget.value })}
                onclick={(e) => e.stopPropagation()}
              />
            {/if}
          </div>
        {/if}
      </div>
      {#if field.minItems !== undefined || field.maxItems !== undefined}
        <div class="muted hint">
          {#if field.minItems !== undefined && field.maxItems !== undefined}Choose {field.minItems}–{field.maxItems}{:else if field.minItems !== undefined}Choose at least {field.minItems}{:else}Choose
            up to {field.maxItems}{/if}
        </div>
      {/if}
    {:else if field.type === "boolean"}
      <div class="seg" role="radiogroup">
        <button role="radio" aria-checked={answers[field.key] === true} class:on={answers[field.key] === true} onclick={() => set(field.key, true)}>Yes</button>
        <button role="radio" aria-checked={answers[field.key] === false} class:on={answers[field.key] === false} onclick={() => set(field.key, false)}>No</button>
      </div>
    {:else if field.type === "string"}
      <input
        class="field"
        type="text"
        placeholder={field.placeholder ?? ""}
        value={typeof answers[field.key] === "string" ? (answers[field.key] as string) : ""}
        oninput={(e) => set(field.key, e.currentTarget.value)}
        onblur={() => (touched = { ...touched, [field.key]: true })}
      />
    {:else if field.type === "number" || field.type === "integer"}
      <input
        class="field"
        type="text"
        inputmode="decimal"
        placeholder={[limit(field.minimum) !== undefined ? `min ${limit(field.minimum)}` : "", limit(field.maximum) !== undefined ? `max ${limit(field.maximum)}` : ""].filter(Boolean).join(" · ")}
        value={answers[field.key] === undefined ? "" : String(answers[field.key])}
        oninput={(e) => {
          const v = e.currentTarget.value.trim()
          set(field.key, v === "" ? "" : Number.isFinite(Number(v)) ? Number(v) : v)
        }}
        onblur={() => (touched = { ...touched, [field.key]: true })}
      />
    {:else if field.type === "external"}
      <button class="link ext" onclick={() => store.bridge.openExternal(field.url)}>Open {field.url} ↗</button>
    {/if}

    {#if error}<div class="err small">{error}</div>{/if}
  {:else}
    <div class="muted">Nothing to answer.</div>
  {/if}

  <div class="actions">
    <span class="muted keys"
      >Esc to cancel{#if field && (isChoice(field) || field.type === "multiselect")}
        · ↑↓ and 1–9{/if}{#if fields.length > 1}
        · Tab next{/if}</span
    >
    <span class="btns">
      <button class="muted" onclick={cancel} disabled={busy}>Cancel</button>
      {#if last || fields.length <= 1}
        <button class="primary" onclick={submit} disabled={busy}>Submit</button>
      {:else}
        <button class="accent" onclick={() => go(1)} disabled={busy}>Next →</button>
      {/if}
    </span>
  </div>
</div>

<style>
  .q {
    border: 1px solid var(--oc-hairline);
    border-radius: 6px;
    padding: 0.5em 0.7em;
    background: var(--oc-popover);
    outline: none;
  }
  .q:focus-visible {
    border-color: var(--vscode-focusBorder);
  }
  .tabs {
    display: flex;
    align-items: baseline;
    gap: 0.9em;
    margin-bottom: 0.4em;
    flex-wrap: wrap;
  }
  .tab {
    color: var(--oc-muted);
    padding-bottom: 1px;
    border-bottom: 1px solid transparent;
  }
  .tab.on {
    color: var(--oc-fg);
    border-bottom-color: var(--oc-accent);
  }
  .count {
    margin-left: auto;
    font-size: 0.9em;
  }
  /* Questions and answers are read in full: everything wraps, nothing is cut with an ellipsis. */
  .head {
    margin-bottom: 0.45em;
  }
  .title {
    font-weight: 600;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.4;
  }
  .hdesc {
    margin-top: 0.15em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.4;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 24em;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    padding: 0.25em 0.4em;
    border-radius: 3px;
    cursor: pointer;
  }
  .row.hi {
    background: var(--oc-hover);
  }
  .num {
    width: 1em;
    text-align: right;
    flex: none;
  }
  .txt {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .lbl {
    overflow-wrap: anywhere;
    line-height: 1.4;
  }
  .desc {
    font-size: 0.92em;
    overflow-wrap: anywhere;
    line-height: 1.4;
  }
  .tab {
    white-space: normal;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .ok {
    color: var(--oc-accent);
  }
  .box {
    width: 1em;
    height: 1em;
    flex: none;
    border: 1px solid var(--oc-muted);
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8em;
    align-self: center;
  }
  .box.on {
    border-color: var(--oc-accent);
    color: var(--oc-accent);
  }
  input.field,
  .other-input {
    padding: 0.25em 0.5em;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--oc-hairline));
    border-radius: 3px;
    min-width: 0;
  }
  input.field {
    width: 100%;
  }
  .other-input {
    flex: 1;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--oc-hairline);
    border-radius: 4px;
    overflow: hidden;
  }
  .seg button {
    padding: 0.15em 1em;
    color: var(--oc-muted);
  }
  .seg button.on {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .hint,
  .small {
    font-size: 0.9em;
    margin-top: 0.25em;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6em;
    margin-top: 0.5em;
  }
  .keys {
    font-size: 0.9em;
  }
  .btns {
    display: flex;
    gap: 0.9em;
  }
  .primary {
    color: var(--oc-accent);
    font-weight: 600;
  }
  .btns button:hover:not(:disabled) {
    text-decoration: underline;
  }
  .ext {
    margin: 0.2em 0;
  }
</style>
