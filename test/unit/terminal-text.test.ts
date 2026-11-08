import { describe, expect, test } from "bun:test"
import { clockText, commandBlockText, endText, noticeText, ruleText, sessionTerminalName, shortDuration, terminalName, toCrlf, wrapLine } from "@occ/core/terminal-text"

const E = "\x1b["
const dim = (t: string) => `${E}2m${t}${E}0m`
const bold = (t: string) => `${E}1m${t}${E}0m`
const at = Date.UTC(2026, 10, 6, 12, 33, 5)

describe("toCrlf", () => {
  test("\\n becomes \\r\\n, and an existing \\r\\n is left alone", () => {
    expect(toCrlf("a\nb\n").text).toBe("a\r\nb\r\n")
    expect(toCrlf("a\r\nb").text).toBe("a\r\nb")
  })
  test("a \\r\\n split across two pages is not doubled", () => {
    const first = toCrlf("line\r")
    expect(first.endsWithCR).toBe(true)
    expect(toCrlf("\nnext", first.endsWithCR).text).toBe("\nnext")
    expect(toCrlf("\nnext", false).text).toBe("\r\nnext")
  })
})

describe("clock and duration", () => {
  test("24-hour clock with seconds in the given zone", () => {
    expect(clockText(at, "UTC")).toBe("12:33:05")
    expect(clockText(at, "Asia/Dhaka")).toBe("18:33:05")
    expect(clockText(Date.UTC(2026, 10, 6, 0, 5, 9), "UTC")).toBe("00:05:09")
  })
  test("one decimal below a minute, then the usual minutes format", () => {
    expect(shortDuration(0)).toBe("0.0s")
    expect(shortDuration(1234)).toBe("1.2s")
    expect(shortDuration(400)).toBe("0.4s")
    expect(shortDuration(59_940)).toBe("59.9s")
    expect(shortDuration(65_000)).toBe("1m 05s")
    expect(shortDuration(3_720_000)).toBe("1h 02m")
  })
  test("a missing, negative or non-finite time gives nothing", () => {
    expect(shortDuration(undefined)).toBeUndefined()
    expect(shortDuration(-1)).toBeUndefined()
    expect(shortDuration(NaN)).toBeUndefined()
  })
})

describe("ruleText", () => {
  const plain = (s: string) => s.replace(/\x1b\[\d+m/g, "")
  test("is exactly as wide as the terminal, the clock on the right", () => {
    for (const cols of [80, 120, 40]) {
      const r = plain(ruleText(cols, "12:33:05"))
      expect(r.length).toBe(cols)
      expect(r.endsWith(" 12:33:05")).toBe(true)
      expect(r.startsWith("───")).toBe(true)
    }
  })
  test("exact bytes at the default width", () => {
    expect(ruleText(undefined, "12:33:05")).toBe(`${E}2m${"─".repeat(71)} 12:33:05${E}0m`)
  })
  test("unknown or tiny widths fall back to 80", () => {
    expect(plain(ruleText(0, "12:33:05")).length).toBe(80)
    expect(plain(ruleText(5, "12:33:05")).length).toBe(80)
    expect(plain(ruleText(NaN, "12:33:05")).length).toBe(80)
  })
})

describe("wrapLine", () => {
  test("short lines are kept", () => {
    expect(wrapLine("echo hi", 78)).toEqual(["echo hi"])
  })
  test("breaks at the last space, else hard at the width", () => {
    expect(wrapLine("aaaa bbbb cccc dddd", 10)).toEqual(["aaaa bbbb", "cccc dddd"])
    expect(wrapLine("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)])
  })
  test("no piece is longer than the width and nothing is lost", () => {
    const line = "git commit -m 'a very long message that keeps going and going until it has to wrap around the edge'"
    const parts = wrapLine(line, 30)
    expect(parts.every((p) => p.length <= 30)).toBe(true)
    expect(parts.join(" ").replace(/ +/g, " ")).toBe(line)
  })
})

describe("commandBlockText", () => {
  const rule = `${E}2m${"─".repeat(71)} 12:33:05${E}0m`
  test("blank line, rule, bold cyan prompt and bold command, cwd, blank line (exact bytes)", () => {
    expect(commandBlockText({ command: "echo hi", cwd: "~/proj", at, timeZone: "UTC" })).toBe(`\r\n${rule}\r\n${E}1;36m❯${E}0m ${bold("echo hi")}\r\n${dim("~/proj")}\r\n\r\n`)
  })
  test("the cwd is left out when it did not change, and shown when it did", () => {
    const same = commandBlockText({ command: "ls", cwd: "~/proj", lastCwd: "~/proj", at, timeZone: "UTC" })
    expect(same).toBe(`\r\n${rule}\r\n${E}1;36m❯${E}0m ${bold("ls")}\r\n\r\n`)
    expect(commandBlockText({ command: "ls", cwd: "~/other", lastCwd: "~/proj", at, timeZone: "UTC" })).toContain(dim("~/other"))
    expect(commandBlockText({ command: "ls", at, timeZone: "UTC" })).not.toContain(`${E}2m~`)
  })
  test("a long command wraps with a hanging indent and every line is bold", () => {
    const out = commandBlockText({ command: "aaaa bbbb cccc dddd", columns: 20, at, timeZone: "UTC" })
    const lines = out.split("\r\n")
    expect(lines[2]).toBe(`${E}1;36m❯${E}0m ${bold("aaaa bbbb cccc")}`)
    expect(lines[3]).toBe(`  ${bold("dddd")}`)
  })
  test("a multi-line command keeps its lines; the rule follows the terminal width", () => {
    const out = commandBlockText({ command: "echo a\necho b", columns: 100, at, timeZone: "UTC" })
    expect(out).toContain(`${E}1;36m❯${E}0m ${bold("echo a")}\r\n  ${bold("echo b")}\r\n`)
    expect(out.split("\r\n")[1]!.replace(/\x1b\[\d+m/g, "").length).toBe(100)
  })
  test("starts and ends on a blank line", () => {
    const out = commandBlockText({ command: "x", at, timeZone: "UTC" })
    expect(out.startsWith("\r\n")).toBe(true)
    expect(out.endsWith("\r\n\r\n")).toBe(true)
  })
})

describe("endText", () => {
  test("exit 0 is green with a check and the duration (exact bytes)", () => {
    expect(endText({ status: "exited", exit: 0 }, 1234, true)).toBe(`${E}0m${E}32m✓ exit 0 · 1.2s${E}0m\r\n`)
    expect(endText({ status: "exited" }, 1234, true)).toBe(`${E}0m${E}32m✓ exit 0 · 1.2s${E}0m\r\n`)
  })
  test("a failure is red with a cross", () => {
    expect(endText({ status: "exited", exit: 1 }, 400, true)).toBe(`${E}0m${E}31m✗ exit 1 · 0.4s${E}0m\r\n`)
  })
  test("timed out and stopped are yellow", () => {
    expect(endText({ status: "timeout" }, 30_000, true)).toBe(`${E}0m${E}33mtimed out · 30.0s${E}0m\r\n`)
    expect(endText({ status: "killed" }, 2500, true)).toBe(`${E}0m${E}33mstopped · 2.5s${E}0m\r\n`)
  })
  test("output that did not end on a line break gets one first", () => {
    expect(endText({ status: "exited", exit: 0 }, 1000, false)).toBe(`${E}0m\r\n${E}32m✓ exit 0 · 1.0s${E}0m\r\n`)
  })
  test("no duration, no dot", () => {
    expect(endText({ status: "exited", exit: 0 }, undefined, true)).toBe(`${E}0m${E}32m✓ exit 0${E}0m\r\n`)
  })
})

describe("noticeText", () => {
  test("yellow, on a fresh line", () => {
    expect(noticeText("gone", true)).toBe(`${E}0m${E}33mgone${E}0m\r\n`)
    expect(noticeText("gone", false)).toBe(`${E}0m\r\n${E}33mgone${E}0m\r\n`)
  })
})

describe("names", () => {
  test("per command: OpenCode: cmd, and OpenCode (agent): cmd for workers", () => {
    expect(terminalName("bun test")).toBe("OpenCode: bun test")
    expect(terminalName("bun   test\n", "explore")).toBe("OpenCode (explore): bun test")
    expect(terminalName("x".repeat(80)).length).toBeLessThan(60)
  })
  test("per session: the title, the agent for a worker, ` #n` for extra terminals", () => {
    expect(sessionTerminalName("Fix the login bug", undefined, 1)).toBe("OpenCode: Fix the login bug")
    expect(sessionTerminalName("Scaffold", "developer", 1)).toBe("OpenCode (developer): Scaffold")
    expect(sessionTerminalName("Fix the login bug", undefined, 2)).toBe("OpenCode: Fix the login bug #2")
    expect(sessionTerminalName("", undefined, 1)).toBe("OpenCode: session")
    expect(sessionTerminalName(undefined, "explore", 3)).toBe("OpenCode (explore): worker #3")
    expect(sessionTerminalName("t".repeat(100), undefined, 1).length).toBeLessThan(60)
  })
})
