<script lang="ts">
  /** A labelled native select: Android shows its own picker, which is easier with a finger than a custom list. */
  let {
    label,
    value,
    options,
    onchange,
    hint,
  }: {
    label: string
    value: string
    options: ReadonlyArray<{ value: string; label: string }>
    onchange: (value: string) => void
    hint?: string
  } = $props()
</script>

<label class="field">
  <span>{label}</span>
  <select {value} onchange={(e) => onchange(e.currentTarget.value)}>
    {#each options as o (o.value)}
      <option value={o.value}>{o.label}</option>
    {/each}
  </select>
  {#if hint}<small>{hint}</small>{/if}
</label>

<style>
  .field {
    display: block;
    margin: 0 0 14px;
  }
  .field > span {
    display: block;
    margin-bottom: 4px;
    font-size: 0.87em;
    color: var(--oc-muted);
  }
  .field select {
    width: 100%;
    min-height: var(--touch);
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--oc-hairline));
    color: var(--vscode-input-foreground);
    font: inherit;
  }
  .field small {
    display: block;
    margin-top: 4px;
    color: var(--oc-muted);
    font-size: 0.87em;
  }
</style>
