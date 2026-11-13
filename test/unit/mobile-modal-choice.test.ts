import { describe, expect, test } from "bun:test"
import { EXPORT_FORMATS } from "@occ/core/session-export"
import { choiceAnswer, type ModalOption } from "../../apps/mobile/src/lib/modal-choice"

/** The buttons `/export` shows, built the way the model builds them. */
const formats: ReadonlyArray<ModalOption> = EXPORT_FORMATS.map((format) => ({ id: format.format, label: format.label }))

describe("a choice dialog", () => {
  test("returns the id of the Markdown button", () => {
    expect(choiceAnswer(formats, "markdown")).toBe("markdown")
  })

  test("returns the id of the JSON button", () => {
    expect(choiceAnswer(formats, "json")).toBe("json")
  })

  test("Cancel, the scrim and Android back all give undefined", () => {
    // The dialog resolves `false` for every dismissal (the Cancel button, the scrim and back call answer(false)).
    expect(choiceAnswer(formats, false)).toBeUndefined()
    expect(choiceAnswer(formats, undefined)).toBeUndefined()
  })

  test("an answer that is not one of the buttons is never returned", () => {
    expect(choiceAnswer(formats, "yaml")).toBeUndefined()
    expect(choiceAnswer([], "markdown")).toBeUndefined()
  })
})
