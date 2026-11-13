<script lang="ts">
  import type { Snippet } from "svelte"

  /** One heading and the rows under it, in the same quiet style as the session list's headings. */
  let { title, children }: { title: string; children: Snippet } = $props()
</script>

<h2 class="group">{title}</h2>
{@render children()}

<style>
  h2.group {
    margin: 20px 16px 0;
    font-size: 0.87em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--oc-muted);
  }
  h2.group:first-child {
    margin-top: 8px;
  }
</style>
