import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

// The picker is shared by the VS Code webview and the Android app, and the bug was pure layout: a long agent
// description made the popover wider than the prompt column. A browser test would prove it once; these checks keep
// the contract that fixes it (a width bound to the container, a clamped second line) from being undone.
const source = readFileSync("packages/ui/src/components/AgentModelPicker.svelte", "utf8")
const css = source.slice(source.indexOf("<style>"), source.lastIndexOf("</style>"))
const mobile = readFileSync("apps/mobile/src/mobile.css", "utf8")
const desktop = readFileSync("packages/ui/src/app.css", "utf8")
const changelog = readFileSync("CHANGELOG.md", "utf8")

/** One rule's declarations, matched by its exact selector at the start of a line. */
function rule(selector: string): string {
  const start = css.indexOf(`\n  ${selector} {`)
  expect(start).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf("}", start))
}

describe("agent picker width", () => {
  test("the popover is bounded by the prompt column, never by the viewport", () => {
    const pop = rule(".pop")
    expect(pop).toContain("max-width: 100%")
    expect(pop).toContain("width: max-content")
    // 18em is the smallest sensible popover, but it must give way when the column is narrower than that.
    expect(pop).toContain("min-width: min(18em, 100%)")
    // `100vw` is what let the list grow past the chat column in a wide window.
    expect(pop).not.toContain("100vw")
  })

  test("a long description wraps in the row instead of widening it", () => {
    const row = rule(".row")
    expect(row).toContain("min-height: var(--oc-popup-row")
    // The name and the description share a column that is allowed to shrink.
    expect(rule(".txt")).toContain("min-width: 0")
    expect(rule(".txt")).toContain("flex-direction: column")
    const d = rule(".d")
    expect(d).not.toContain("nowrap")
    expect(d).toContain("-webkit-line-clamp: 2")
    expect(d).toContain("line-clamp: 2")
    expect(d).toContain("display: -webkit-box")
    expect(d).toContain("overflow: hidden")
  })

  test("the markup puts the name over the description, and the full text in the tooltip", () => {
    expect(source).toContain(`<span class="txt">`)
    expect(source).toContain(`{#if a.description}<span class="muted d">{a.description}</span>{/if}`)
    expect(source).toContain("title={a.description || undefined}")
    const name = source.indexOf(`<span class="n">{displayName(a.name || a.id)}</span>`)
    const description = source.indexOf(`class="muted d"`)
    expect(name).toBeGreaterThan(-1)
    expect(description).toBeGreaterThan(name)
  })

  test("rows keep a finger-sized height on the phone and a dense one in the editor", () => {
    // The shared defaults are the desktop sizes; the Android stylesheet raises the same variable.
    expect(desktop).toContain("--oc-popup-row: 24px")
    expect(mobile).toContain("--oc-popup-row: 48px")
  })
})

describe("model picker width", () => {
  test("a long model name is shortened inside the row, not pushed out of it", () => {
    const n = rule(".n")
    expect(n).toContain("text-overflow: ellipsis")
    expect(n).toContain("overflow: hidden")
    expect(n).toContain("min-width: 0")
    expect(source).toContain(`<span class="n mname" title={m.name}>{m.name}</span>`)
  })

  test("the name keeps a readable width and the variants move to a second line", () => {
    expect(rule(".mname")).toContain("min-width: 6em")
    const vars = rule(".vars")
    expect(vars).toContain("flex-wrap: wrap")
    expect(vars).toContain("min-width: 0")
    expect(rule(".var")).toContain("white-space: nowrap")
  })

  test("a provider's name is cut with an ellipsis rather than widening the popover", () => {
    const group = rule(".group")
    expect(group).toContain("text-overflow: ellipsis")
    expect(group).toContain("white-space: nowrap")
  })
})

describe("changelog", () => {
  test("the fix is announced above the last release", () => {
    const entry = changelog.indexOf("The agent list no longer spreads across the window when an agent has a long description")
    expect(entry).toBeGreaterThan(-1)
    expect(entry).toBeLessThan(changelog.indexOf("## 0.3.20 (preview)"))
  })
})
