<script lang="ts">
  /** A codicon from the bundled `@vscode/codicons` font. Decorative unless `label` is given. */
  let { name, label, spin = false }: { name: string; label?: string; spin?: boolean } = $props()
</script>

<span class="codicon codicon-{name}" class:spin role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}></span>

<style>
  .spin { animation: oc-spin 1s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
</style>
