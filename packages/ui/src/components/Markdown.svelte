<script lang="ts">
  import { onDestroy, untrack } from "svelte"
  import { splitLine } from "@occ/core/paths"
  import { copyCodeBlock } from "../code-copy"
  import { useStore } from "../context"
  import { renderDue, STREAM_RENDER_MS } from "../markdown-stream"
  import { renderMarkdown } from "../markdown"

  /**
   * `streaming`: the text is still arriving. A streaming answer is re-rendered at most every `STREAM_RENDER_MS`
   * (parsing and sanitising the whole text per delta is quadratic); the finished text is rendered at once.
   */
  let { text, streaming = false }: { text: string; streaming?: boolean } = $props()
  const store = useStore()

  // The first text is rendered once, here; every later one goes through the effect below.
  let html = $state(untrack(() => renderMarkdown(text)))
  let shown = untrack(() => text)
  let renderedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    const next = text
    const live = streaming
    if (next === shown) return
    if (renderDue(live, Date.now() - renderedAt)) {
      render(next)
      return
    }
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      render(text)
    }, STREAM_RENDER_MS)
  })

  function render(value: string) {
    html = renderMarkdown(value)
    shown = value
    renderedAt = Date.now()
  }

  onDestroy(() => {
    if (timer) clearTimeout(timer)
  })

  function onclick(e: MouseEvent) {
    const target = e.target as HTMLElement
    const copyBtn = target.closest<HTMLElement>("button.oc-copy")
    if (copyBtn) {
      e.preventDefault()
      void copyCodeBlock(copyBtn)
      return
    }
    const a = target.closest("a")
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
