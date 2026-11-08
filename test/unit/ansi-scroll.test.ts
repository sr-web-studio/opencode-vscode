import { describe, expect, test } from "bun:test"
import { ansiToSpans, cssColor, stripAnsi } from "@occ/core/ansi"
import { anchoredScrollTop, initialScroll, isNearBottom, scrollTopAfterPrepend, showJump, stepScroll, type Metrics } from "@occ/core/scroll"

describe("ansiToSpans", () => {
  test("plain text is one span", () => {
    expect(ansiToSpans("hello")).toEqual([{ text: "hello" }])
  })
  test("colors, bold and reset", () => {
    const s = ansiToSpans("\u001b[1;32mok\u001b[0m done")
    expect(s[0]).toEqual({ text: "ok", bold: true, fg: { kind: "named", name: "ansiGreen" } })
    expect(s[1]).toEqual({ text: " done" })
  })
  test("bright, 256 and truecolor", () => {
    expect(ansiToSpans("\u001b[91mx")[0]!.fg).toEqual({ kind: "named", name: "ansiBrightRed" })
    expect(ansiToSpans("\u001b[38;5;196mx")[0]!.fg).toEqual({ kind: "rgb", r: 255, g: 0, b: 0 })
    expect(ansiToSpans("\u001b[38;2;1;2;3mx")[0]!.fg).toEqual({ kind: "rgb", r: 1, g: 2, b: 3 })
    expect(ansiToSpans("\u001b[38;5;3mx")[0]!.fg).toEqual({ kind: "named", name: "ansiYellow" })
  })
  test("a bare ESC[m resets; 39 clears only the foreground", () => {
    const s = ansiToSpans("\u001b[31;1ma\u001b[39mb\u001b[mc")
    expect(s.map((x) => [x.text, x.fg?.kind, x.bold])).toEqual([["a", "named", true], ["b", undefined, true], ["c", undefined, undefined]])
  })
  test("cursor movement, OSC titles and unknown escapes are dropped, text kept", () => {
    expect(stripAnsi("a\u001b[2Kb\u001b]0;title\u0007c\u001b[?25hd")).toBe("abcd")
    expect(ansiToSpans("\u001b[2Jx").map((s) => s.text).join("")).toBe("x")
  })
  test("CRLF becomes LF and a progress-bar carriage return is not shown", () => {
    expect(ansiToSpans("a\r\nb").map((s) => s.text).join("")).toBe("a\nb")
    expect(ansiToSpans("50%\r100%").map((s) => s.text).join("")).toBe("50%100%")
  })
  test("garbage parameters do not throw", () => {
    expect(() => ansiToSpans("\u001b[38;5mx\u001b[999;;;mx\u001b[;mx")).not.toThrow()
  })
  test("named colors map to terminal theme variables", () => {
    expect(cssColor({ kind: "named", name: "ansiGreen" })).toBe("var(--vscode-terminal-ansiGreen)")
    expect(cssColor({ kind: "rgb", r: 1, g: 2, b: 3 })).toBe("rgb(1, 2, 3)")
  })
})

const at = (distance: number): Metrics => ({ scrollTop: 1000 - distance, clientHeight: 500, scrollHeight: 1500 })

describe("scroll follow logic", () => {
  test("near bottom means within 40px", () => {
    expect(isNearBottom(at(0))).toBe(true)
    expect(isNearBottom(at(40))).toBe(true)
    expect(isNearBottom(at(41))).toBe(false)
  })
  test("content follows to the end while the user is at the bottom", () => {
    const r = stepScroll(initialScroll, { type: "content", metrics: at(0) })
    expect(r.scrollToEnd).toBe(true)
    expect(showJump(r.state)).toBe(false)
  })
  test("scrolling up stops following, and new content then never moves the view", () => {
    const up = stepScroll(initialScroll, { type: "scrolled", metrics: at(300) })
    expect(up.state.follow).toBe(false)
    expect(showJump(up.state)).toBe(true)
    const more = stepScroll(up.state, { type: "content", metrics: at(300) })
    expect(more.scrollToEnd).toBe(false)
    expect(more.state.unseen).toBe(true)
  })
  test("growing content before we scroll to it does not stop following (the user did not scroll)", () => {
    const grew = stepScroll(initialScroll, { type: "content", metrics: at(900) })
    expect(grew.scrollToEnd).toBe(true)
    expect(grew.state.follow).toBe(true)
  })
  test("scrolling back to the bottom resumes following and clears the dot", () => {
    const away = stepScroll(stepScroll(initialScroll, { type: "scrolled", metrics: at(300) }).state, { type: "content", metrics: at(300) }).state
    expect(away.unseen).toBe(true)
    const back = stepScroll(away, { type: "scrolled", metrics: at(10) })
    expect(back.state).toEqual({ follow: true, unseen: false })
  })
  test("the jump button and sending a prompt always go to the end and resume following", () => {
    const away = stepScroll(initialScroll, { type: "scrolled", metrics: at(500) }).state
    for (const type of ["jump", "sent", "reset"] as const) {
      const r = stepScroll(away, { type })
      expect(r.scrollToEnd).toBe(true)
      expect(r.state).toEqual({ follow: true, unseen: false })
    }
  })
  test("expanding a step keeps the clicked element in place", () => {
    // The element sat at y=200, the content above it grew by 80, so it is now at y=280: scrollTop moves by 80.
    expect(anchoredScrollTop(400, 200, 280)).toBe(480)
    expect(anchoredScrollTop(400, 200, 200)).toBe(400)
    expect(anchoredScrollTop(400, 200, 150)).toBe(350)
  })
  test("prepending older messages keeps the visible part where it was", () => {
    expect(scrollTopAfterPrepend(0, 1000, 1800)).toBe(800)
    expect(scrollTopAfterPrepend(120, 1000, 1000)).toBe(120)
  })
})
