<script lang="ts">
  import type { Snippet } from "svelte"

  /** One settings section. The heading stays visible while the section scrolls, like VS Code's own Settings. */
  let { id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children?: Snippet } = $props()
</script>

<section class="section" {id} data-nav={id}>
  <h2>{title}</h2>
  {#if subtitle}<p class="section-sub">{subtitle}</p>{/if}
  <div class="rows">
    {@render children?.()}
  </div>
</section>
