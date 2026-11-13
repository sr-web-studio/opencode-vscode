<script lang="ts">
  /** A titled switch with one line of explanation; the whole row is the tap target. */
  let { title, detail, checked, disabled = false, onchange }: { title: string; detail?: string; checked: boolean; disabled?: boolean; onchange: (checked: boolean) => void } = $props()
</script>

<label class="switch">
  <span class="txt">
    <strong>{title}</strong>
    {#if detail}<small>{detail}</small>{/if}
  </span>
  <input type="checkbox" role="switch" {checked} {disabled} onchange={(e) => onchange(e.currentTarget.checked)} />
</label>

<style>
  .switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 56px;
    padding: 8px 0;
  }
  .switch .txt {
    flex: 1;
    min-width: 0;
  }
  .switch strong {
    display: block;
    font-weight: 500;
  }
  .switch small {
    display: block;
    margin-top: 2px;
    color: var(--oc-muted);
    font-size: 0.87em;
    line-height: 1.35;
  }
  .switch input {
    flex: none;
    width: 48px;
    height: 28px;
    accent-color: var(--vscode-button-background);
  }
</style>
