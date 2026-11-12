<script lang="ts">
  import { tick } from "svelte"
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { model } from "../model.svelte"

  /** The text of an input dialog; reset from the modal each time one opens. */
  let text = $state("")
  let inputError = $state<string | undefined>()
  let field: HTMLInputElement | undefined = $state()

  $effect(() => {
    const m = model.modal
    if (!m?.input) return
    text = m.input.value
    void tick().then(() => field?.focus())
  })
  $effect(() => {
    const m = model.modal
    if (!m?.input) {
      inputError = undefined
      return
    }
    inputError = m.input.validate?.(text)
  })
</script>

{#if model.toast}
  {@const t = model.toast}
  <div class="toast {t.level}" role="status" aria-live="polite">
    <span>{t.text}</span>
    <button class="x" onclick={() => model.dismissToast()} aria-label="Dismiss"><Codicon name="close" /></button>
  </div>
{/if}

{#if model.modal}
  {@const m = model.modal}
  <div class="scrim" role="presentation" onclick={() => model.answer(false)}>
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dlg-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === "Escape" && model.answer(false)}
    >
      <h2 id="dlg-title">{m.title}</h2>
      {#if m.detail}<p class="muted">{m.detail}</p>{/if}
      {#if m.input}
        <label class="field">
          <span>{m.input.label ?? "Name"}</span>
          <input
            bind:this={field}
            bind:value={text}
            placeholder={m.input.placeholder}
            maxlength={m.input.maxLength}
            aria-invalid={!!inputError}
            aria-describedby={inputError || m.input.help ? "dlg-help" : undefined}
            onkeydown={(e) => e.key === "Enter" && !inputError && model.answerInput(text)}
          />
        </label>
        {#if inputError}
          <p class="err" id="dlg-help">{inputError}</p>
        {:else if m.input.help}
          <p class="muted help" id="dlg-help">{m.input.help}</p>
        {/if}
      {/if}
      {#if m.options}
        <div class="actions choices">
          {#each m.options as option (option.id)}
            <button class="btn" onclick={() => model.answerChoice(option.id)}>{option.label}</button>
          {/each}
          <button class="btn quiet" onclick={() => model.answer(false)}>Cancel</button>
        </div>
      {:else}
        <div class="actions">
          <button class="btn quiet" onclick={() => model.answer(false)}>Cancel</button>
          <button class="btn" class:danger={m.danger} disabled={!!inputError} onclick={() => (m.input ? model.answerInput(text) : model.answer(true))}>{m.confirm}</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .toast {
    position: absolute;
    z-index: 60;
    left: 12px;
    right: 12px;
    bottom: calc(var(--sab) + 12px);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px 6px 14px;
    border-radius: 10px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--oc-hairline);
    box-shadow: 0 4px 16px var(--vscode-widget-shadow);
  }
  .toast span {
    flex: 1;
    min-width: 0;
  }
  .toast.error {
    border-color: var(--oc-error);
  }
  .toast.warning {
    border-color: var(--oc-amber);
  }
  .x {
    flex: none;
    min-width: 40px;
    min-height: 40px;
  }
  .scrim {
    position: absolute;
    z-index: 70;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.5);
  }
  .dialog {
    width: 100%;
    max-width: 380px;
    padding: 18px;
    border-radius: 12px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--oc-hairline);
    box-shadow: 0 8px 32px var(--vscode-widget-shadow);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.1em;
  }
  p {
    margin: 0 0 16px;
  }
  .field {
    display: block;
    margin: 0 0 6px;
  }
  .field > span {
    display: block;
    margin-bottom: 4px;
    font-size: 0.85em;
    color: var(--oc-muted);
  }
  .field input {
    width: 100%;
    min-height: 42px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--oc-hairline);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font: inherit;
  }
  .field input[aria-invalid="true"] {
    border-color: var(--oc-error);
  }
  .err {
    margin: 0 0 12px;
    font-size: 0.85em;
    color: var(--oc-error);
  }
  .help {
    margin: 0 0 12px;
    font-size: 0.85em;
  }
  .actions button:disabled {
    opacity: 0.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  /* A choice dialog stacks its buttons, each a full touch target: 48dp, with --touch (44px today) as the floor.
     The dialog is outside `.screen`, so mobile.css's `.btn` rule does not reach it: give these a visible surface. */
  .actions.choices {
    flex-direction: column;
  }
  .choices .btn {
    min-height: max(var(--touch, 48px), 48px);
    padding: 0 16px;
    border: 1px solid var(--oc-hairline);
    border-radius: 8px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-weight: 500;
  }
  .choices .btn.quiet {
    background: transparent;
    color: var(--oc-accent);
  }
</style>
