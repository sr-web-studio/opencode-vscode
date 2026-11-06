<script lang="ts">
  import { splitLine } from "../../core/paths"
  import { useStore } from "../context"
  import { renderMarkdown } from "../markdown"

  let { text }: { text: string } = $props()
  const store = useStore()
  const html = $derived(renderMarkdown(text))

  function onclick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a")
    if (!a) return
    e.preventDefault()
    const path = a.dataset.path
    if (path) {
      const ref = splitLine(path)
      store.bridge.openFile(ref.path, ref.line)
      return
    }
    const href = a.getAttribute("href") ?? ""
    if (/^https?:\/\//i.test(href)) store.bridge.openExternal(href)
  }
</script>

<!-- Links are real anchors; the delegated handler keeps keyboard activation working. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" {onclick}>{@html html}</div>
