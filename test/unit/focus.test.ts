import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { canTakeFocus, shouldFocusPrompt, type FocusEnv } from "../../src/core/focus"

const here: FocusEnv = { webviewFocused: true, otherEditableActive: false }
const elsewhere: FocusEnv = { webviewFocused: false, otherEditableActive: false }
const typing: FocusEnv = { webviewFocused: true, otherEditableActive: true }

describe("shouldFocusPrompt", () => {
  test("state emits without a focus request never focus, however many arrive", () => {
    // The host re-sends state many times a second while a session streams. The counter does not move.
    let focused = 0
    for (let i = 0; i < 500; i++) if (shouldFocusPrompt(7, 7, here)) focused++
    expect(focused).toBe(0)
  })

  test("the very first value is a baseline, not a request", () => {
    expect(shouldFocusPrompt(undefined, 0, here)).toBe(false)
    expect(shouldFocusPrompt(undefined, 5, here)).toBe(false)
  })

  test("an explicit request focuses when this view has the keyboard", () => {
    expect(shouldFocusPrompt(0, 1, here)).toBe(true)
  })

  test("an explicit request while the webview is not focused does not focus (editor, terminal, other panel)", () => {
    expect(shouldFocusPrompt(0, 1, elsewhere)).toBe(false)
  })

  test("an explicit request never steals focus from another input inside the webview", () => {
    expect(shouldFocusPrompt(0, 1, typing)).toBe(false)
  })

  test("both conditions together, and a decreasing counter (state reset) is still just a change", () => {
    expect(canTakeFocus({ webviewFocused: false, otherEditableActive: true })).toBe(false)
    expect(shouldFocusPrompt(3, 1, here)).toBe(true)
  })
})

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

/** Guards against the original bug coming back: the UI has exactly one place that calls `.focus()`. */
describe("focus call sites", () => {
  test("only src/ui/focus.ts calls .focus() in the UI", () => {
    const offenders = walk("src/ui")
      .filter((f) => /\.(ts|svelte)$/.test(f) && !f.endsWith(join("src", "ui", "focus.ts")))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => /\.focus\(\)/.test(l)).map(({ f, i, l }) => `${f}:${i}: ${l.trim()}`))
    expect(offenders).toEqual([])
  })

  test("no effect reads the host's focus counters directly (the state object is replaced on every emit)", () => {
    const offenders = walk("src/ui")
      .filter((f) => f.endsWith(".svelte"))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => /\$effect\(.*(focusTick|draftEpoch)/.test(l)).map(({ f, i }) => `${f}:${i}`))
    expect(offenders).toEqual([])
  })

  test("the extension host never reveals or shows the chat view on its own", () => {
    const bad = walk("src/extension")
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => /\.reveal\(|webviewView\.show\(|\bview\??\.show\(/.test(l)).map(({ f, i, l }) => `${f}:${i}: ${l.trim()}`))
    expect(bad).toEqual([])
  })

  test("the view-focus command is only executed from explicit commands and notification actions", () => {
    const hits = walk("src/extension")
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => /VIEW_ID\}\.focus/.test(l)).map(({ f, l }) => `${f}: ${l.trim()}`))
    // runNotice (user clicked "Open"), opencode.focus, opencode.newSession. Nothing in a state/event path.
    expect(hits.length).toBe(3)
    expect(hits.every((h) => h.startsWith(join("src", "extension", "extension.ts")))).toBe(true)
  })
})
