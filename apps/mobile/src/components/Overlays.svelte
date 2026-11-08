<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { model } from "../model.svelte"
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
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && model.answer(false)}>
      <h2 id="dlg-title">{m.title}</h2>
      {#if m.detail}<p class="muted">{m.detail}</p>{/if}
      <div class="actions">
        <button class="btn quiet" onclick={() => model.answer(false)}>Cancel</button>
        <button class="btn" class:danger={m.danger} onclick={() => model.answer(true)}>{m.confirm}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .toast { position: absolute; z-index: 60; left: 12px; right: 12px; bottom: calc(var(--sab) + 12px); display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 14px; border-radius: 10px; background: var(--vscode-editorWidget-background); border: 1px solid var(--oc-hairline); box-shadow: 0 4px 16px var(--vscode-widget-shadow); }
  .toast span { flex: 1; min-width: 0; }
  .toast.error { border-color: var(--oc-error); }
  .toast.warning { border-color: var(--oc-amber); }
  .x { flex: none; min-width: 40px; min-height: 40px; }
  .scrim { position: absolute; z-index: 70; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.5); }
  .dialog { width: 100%; max-width: 380px; padding: 18px; border-radius: 12px; background: var(--vscode-editorWidget-background); border: 1px solid var(--oc-hairline); box-shadow: 0 8px 32px var(--vscode-widget-shadow); }
  h2 { margin: 0 0 8px; font-size: 1.1em; }
  p { margin: 0 0 16px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
