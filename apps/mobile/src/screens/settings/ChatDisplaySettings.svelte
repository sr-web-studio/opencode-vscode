<script lang="ts">
  import type { ViewSettings } from "@occ/core/protocol"
  import SettingsGroup from "../../components/settings/SettingsGroup.svelte"
  import SettingsSelect from "../../components/settings/SettingsSelect.svelte"
  import SwitchRow from "../../components/settings/SwitchRow.svelte"
  import { FONT_SIZES } from "../../lib/app-settings"
  import { model } from "../../model.svelte"

  /** How the transcript looks, saved for this phone and applied to every open chat immediately. */
  const s = $derived(model.viewSettings)
  /**
   * The stored number is the base size; the transcript renders two pixels larger (see mobile.css), so the list shows
   * the size the reader actually gets.
   */
  const fontOptions = FONT_SIZES.map((n) => ({ value: String(n), label: n === 14 ? `${n + 2} px (default)` : `${n + 2} px` }))
  const reasoningOptions: ReadonlyArray<{ value: ViewSettings["showReasoning"]; label: string }> = [
    { value: "collapsed", label: "Collapsed (tap to open)" },
    { value: "expanded", label: "Expanded" },
    { value: "hidden", label: "Hidden" },
  ]

  function setFontSize(value: string) {
    const size = Number(value)
    if (Number.isFinite(size)) model.setViewSettings({ fontSize: size })
  }
</script>

<SettingsGroup title="Chat display">
  <section class="pad">
    <SettingsSelect label="Transcript text size" value={String(s.fontSize)} options={fontOptions} onchange={setFontSize} />
    <p class="preview" style:font-size="{s.fontSize + 2}px">The transcript text looks like this.</p>
    <SwitchRow
      title="Collapse completed steps"
      detail="Keep finished tool steps folded to one line."
      checked={s.collapseCompletedSteps}
      onchange={(checked) => model.setViewSettings({ collapseCompletedSteps: checked })}
    />
    <SwitchRow
      title="Expand tool details"
      detail="Show what each tool read or changed without a tap."
      checked={s.expandToolDetails}
      onchange={(checked) => model.setViewSettings({ expandToolDetails: checked })}
    />
    <SettingsSelect label="Reasoning" value={s.showReasoning} options={reasoningOptions} onchange={(value) => model.setViewSettings({ showReasoning: value as ViewSettings["showReasoning"] })} />
    <SwitchRow
      title="Open the todo list by default"
      detail="Show a session's plan without a tap."
      checked={s.todoDefaultExpanded}
      onchange={(checked) => model.setViewSettings({ todoDefaultExpanded: checked })}
    />
  </section>
</SettingsGroup>

<style>
  .preview {
    margin: -4px 0 10px;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--oc-bubble);
    line-height: 1.45;
  }
</style>
