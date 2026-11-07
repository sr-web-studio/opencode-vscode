import { describe, expect, test } from "bun:test"
import { codeCopyText, codeLanguage } from "../../src/core/code-block"

describe("codeCopyText", () => {
  test("strips the single newline marked adds", () => {
    expect(codeCopyText("a\nb\n")).toBe("a\nb")
  })
  test("keeps a deliberate blank last line and indentation", () => {
    expect(codeCopyText("  x\n\n")).toBe("  x\n")
  })
  test("leaves text without trailing newline alone", () => {
    expect(codeCopyText("abc")).toBe("abc")
    expect(codeCopyText("")).toBe("")
  })
})

describe("codeLanguage", () => {
  test("reads the marked language class", () => {
    expect(codeLanguage("language-ts")).toBe("ts")
    expect(codeLanguage("foo language-c++ bar")).toBe("c++")
  })
  test("empty when there is no language", () => {
    expect(codeLanguage(null)).toBe("")
    expect(codeLanguage(undefined)).toBe("")
    expect(codeLanguage("")).toBe("")
    expect(codeLanguage("hljs")).toBe("")
  })
  test("absurdly long info strings are dropped", () => {
    expect(codeLanguage("language-" + "x".repeat(40))).toBe("")
  })
})
