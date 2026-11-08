import { describe, expect, test } from "bun:test"
import questionForm from "../fixtures/question-form.json"
import type { FormField } from "@occ/core/api"
import { OTHER, buildAnswer, choiceOf, clampStep, defaultAnswers, isChoice, tabsFor, validateField, validateForm, visibleFields } from "@occ/core/forms"

const f = (x: unknown) => x as FormField

describe("visibility", () => {
  const fields = [
    f({ key: "db", type: "string", options: [{ value: "pg", label: "Postgres" }, { value: "sqlite", label: "SQLite" }] }),
    f({ key: "url", type: "string", when: [{ key: "db", op: "eq", value: "pg" }] }),
    f({ key: "file", type: "string", when: [{ key: "db", op: "neq", value: "pg" }] }),
    f({ key: "secret", type: "string", hidden: true }),
    f({ key: "tags", type: "multiselect", options: [{ value: "a", label: "A" }] }),
    f({ key: "tagged", type: "boolean", when: [{ key: "tags", op: "eq", value: "a" }] }),
  ]
  test("when eq / neq and hidden", () => {
    expect(visibleFields(fields, {}).map((x) => x.key)).toEqual(["db", "file", "tags"])
    expect(visibleFields(fields, { db: "pg" }).map((x) => x.key)).toEqual(["db", "url", "tags"])
  })
  test("eq against a multiselect means membership", () => {
    expect(visibleFields(fields, { tags: ["a"] }).map((x) => x.key)).toContain("tagged")
    expect(visibleFields(fields, { tags: ["b"] }).map((x) => x.key)).not.toContain("tagged")
  })
  test("hidden answers do not leak into the reply", () => {
    const a = buildAnswer(fields, { db: "sqlite", url: "x", file: "a.db" }, {})
    expect(a).toEqual({ db: "sqlite", file: "a.db" })
  })
})

describe("validation", () => {
  test("string rules", () => {
    const s = f({ key: "k", type: "string", required: true, minLength: 3, maxLength: 5, pattern: "^[a-z]+$" })
    expect(validateField(s, "")).toBe("Required")
    expect(validateField(s, "ab")).toMatch(/At least 3/)
    expect(validateField(s, "abcdef")).toMatch(/At most 5/)
    expect(validateField(s, "AB1")).toMatch(/format/)
    expect(validateField(s, "abc")).toBeUndefined()
    expect(validateField(f({ key: "k", type: "string", pattern: "(" }), "x")).toBeUndefined()
    expect(validateField(f({ key: "k", type: "string", format: "email" }), "nope")).toMatch(/email/)
    expect(validateField(f({ key: "k", type: "string", format: "email" }), "a@b.co")).toBeUndefined()
  })
  test("numbers and integers, infinite limits ignored", () => {
    const n = f({ key: "n", type: "number", minimum: 1, maximum: 10 })
    expect(validateField(n, 0)).toBe("At least 1")
    expect(validateField(n, 11)).toBe("At most 10")
    expect(validateField(n, "abc")).toBe("Enter a number")
    expect(validateField(n, 5)).toBeUndefined()
    expect(validateField(f({ key: "i", type: "integer" }), 1.5)).toBe("Enter a whole number")
    expect(validateField(f({ key: "n", type: "number", minimum: "-Infinity", maximum: "Infinity" }), 1e9)).toBeUndefined()
    expect(validateField(f({ key: "n", type: "number", required: true }), undefined)).toBe("Required")
  })
  test("multiselect min/max and Other", () => {
    const m = f({ key: "m", type: "multiselect", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], minItems: 1, maxItems: 2, custom: true })
    expect(validateField(m, [])).toBe("Choose at least 1")
    expect(validateField(m, ["a", "b", "c"])).toBe("Choose at most 2")
    expect(validateField(m, ["a"])).toBeUndefined()
    expect(validateField(m, [OTHER], "")).toBe("Type your answer for Other")
    expect(validateField(m, [OTHER], "mine")).toBeUndefined()
  })
  test("string choice with Other needs text", () => {
    const s = f({ key: "q0", type: "string", required: true, options: [{ value: "a", label: "A" }], custom: true })
    expect(validateField(s, OTHER, "")).toBe("Required")
    expect(validateField(s, OTHER, "mine")).toBeUndefined()
  })
  test("boolean required", () => {
    expect(validateField(f({ key: "b", type: "boolean", required: true }), undefined)).toBe("Choose Yes or No")
    expect(validateField(f({ key: "b", type: "boolean", required: true }), false)).toBeUndefined()
  })
  test("only visible fields are validated", () => {
    const fields = [f({ key: "a", type: "boolean" }), f({ key: "b", type: "string", required: true, when: [{ key: "a", op: "eq", value: true }] })]
    expect(validateForm(fields, { a: false }, {})).toEqual({})
    expect(validateForm(fields, { a: true }, {})).toEqual({ b: "Required" })
  })
})

describe("answers", () => {
  test("Other is replaced by the typed text; numbers coerced; empties dropped", () => {
    const fields = [
      f({ key: "q0", type: "string", options: [{ value: "r", label: "R" }], custom: true }),
      f({ key: "m", type: "multiselect", options: [{ value: "a", label: "A" }], custom: true }),
      f({ key: "n", type: "integer" }),
      f({ key: "opt", type: "string" }),
      f({ key: "ext", type: "external", url: "https://x.dev" }),
    ]
    const out = buildAnswer(fields, { q0: OTHER, m: ["a", OTHER], n: "7" as any, opt: "" }, { q0: " teal ", m: "mine" })
    expect(out).toEqual({ q0: "teal", m: ["a", "mine"], n: 7 })
  })
  test("defaults", () => {
    expect(defaultAnswers([f({ key: "a", type: "string", default: "x" }), f({ key: "b", type: "boolean", default: true }), f({ key: "c", type: "multiselect", options: [], default: ["z"] }), f({ key: "d", type: "number", default: "NaN" })])).toEqual({ a: "x", b: true, c: ["z"] })
  })
  test("tabs track visibility and completion", () => {
    const fields = [f({ key: "a", title: "Database", type: "boolean" }), f({ key: "b", title: "Auth", type: "string", required: true })]
    expect(tabsFor(fields, { a: true }, {})).toEqual([{ key: "a", label: "Database", done: true }, { key: "b", label: "Auth", done: false }])
    expect(clampStep(5, 2)).toBe(1)
    expect(clampStep(-1, 2)).toBe(0)
    expect(clampStep(3, 0)).toBe(0)
  })
})

describe("real question form (captured from the server)", () => {
  const form = questionForm.form
  const fields = form.fields as FormField[]
  test("the question tool produces a single-choice string field with Other", () => {
    expect(form.metadata.kind).toBe("question")
    expect(fields[0]!.key).toBe("q0")
    expect(isChoice(fields[0]!)).toBe(true)
    expect(choiceOf(fields[0]!)?.key).toBe("q0")
    expect(choiceOf({ key: "t", type: "string" } as FormField)).toBeUndefined()
    expect((fields[0] as { custom?: boolean }).custom).toBe(true)
  })
  test("the reply matches what the server accepted", () => {
    expect(validateForm(fields, {}, {})).toEqual({})
    const answer = buildAnswer(fields, { q0: "Blue" }, {})
    expect(answer).toEqual(questionForm.replied.data.answer)
  })
  test("typed Other text is sent as the answer", () => {
    expect(buildAnswer(fields, { q0: OTHER }, { q0: "Teal" })).toEqual({ q0: "Teal" })
  })
})
