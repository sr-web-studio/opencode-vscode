<script lang="ts">
  import { markdownLite, type SettingsControl } from "../extension/settings-model"
  import { send } from "./bridge"

  let { control }: { control: SettingsControl } = $props()

  const listValue = $derived(Array.isArray(control.value) ? (control.value as string[]) : [])
  const selectedDescription = $derived(control.kind === "enum" ? (control.options ?? []).find((option) => option.value === String(control.value ?? ""))?.description : undefined)
  const inputId = $derived(`set-${control.key}`)

  const commit = (value: unknown) => send({ type: "set", key: control.key, value })
  const reset = () => send({ type: "reset", key: control.key })

  function onBoolean(event: Event) {
    commit((event.currentTarget as HTMLInputElement).checked)
  }
  function onNumber(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value.trim()
    if (raw !== "") commit(Number(raw))
  }
  function onText(event: Event) {
    commit((event.currentTarget as HTMLInputElement).value)
  }
  function onSelect(event: Event) {
    commit((event.currentTarget as HTMLSelectElement).value)
  }
  function onList(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value
    commit(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
  }
  function onListToggle(value: string, checked: boolean) {
    commit(checked ? [...listValue, value] : listValue.filter((item) => item !== value))
  }
</script>

<div class="row setting">
  <div class="text">
    <label class="label" for={inputId}>
      {control.label}
      {#if control.machine}<span class="badge machine" title="Machine setting: saved in User settings, never in a workspace">Machine</span>{/if}
      {#if control.modified}<span class="badge modified" title="A value is saved in your settings">Modified</span>{/if}
    </label>
    {#if control.description}<p class="desc">{@html markdownLite(control.description)}</p>{/if}
  </div>

  <div class="field">
    {#if control.kind === "boolean"}
      <label class="check">
        <input id={inputId} type="checkbox" checked={!!control.value} onchange={onBoolean} />
        <span>{control.value ? "On" : "Off"}</span>
      </label>
    {:else if control.kind === "enum"}
      <select id={inputId} value={String(control.value ?? "")} onchange={onSelect}>
        {#each control.options ?? [] as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      {#if selectedDescription}<p class="hint">{selectedDescription}</p>{/if}
    {:else if control.kind === "number"}
      <input id={inputId} type="number" min={control.min} max={control.max} step={control.max !== undefined && control.max <= 10 ? 1 : "any"} value={String(control.value ?? "")} onchange={onNumber} />
    {:else if control.kind === "string"}
      <div class="input-row">
        <input id={inputId} type="text" value={String(control.value ?? "")} onchange={onText} spellcheck="false" />
        {#if control.action}
          <button type="button" onclick={() => send({ type: "command", command: control.action?.command ?? "" })}>{control.action.label}</button>
        {/if}
      </div>
    {:else if control.kind === "stringList"}
      <input id={inputId} type="text" value={listValue.join(", ")} onchange={onList} placeholder="Comma-separated" spellcheck="false" />
    {:else if control.kind === "enumList"}
      <div class="checklist" role="group" aria-label={control.label}>
        {#each control.options ?? [] as option (option.value)}
          <label class="check" title={option.description ?? option.label}>
            <input type="checkbox" checked={listValue.includes(option.value)} onchange={(event) => onListToggle(option.value, event.currentTarget.checked)} />
            <span>{option.label}</span>
          </label>
        {/each}
      </div>
    {/if}
  </div>

  <div class="reset">
    <button class="icon" type="button" title="Reset to default" aria-label="Reset {control.label} to default" disabled={!control.modified} onclick={reset}>
      <span class="codicon codicon-discard" aria-hidden="true"></span>
    </button>
  </div>
</div>
