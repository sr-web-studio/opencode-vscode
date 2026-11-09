import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  buildSettingsSections,
  coerceSettingValue,
  configurationProperties,
  controlKind,
  filterSections,
  humanizeKey,
  markdownLite,
  resolveWriteTarget,
  sectionIdFor,
  shortKeyOf,
  type ConfigurationSchema,
  type PropertySchema,
} from "../../apps/vscode/src/extension/settings-model"

const pkg = JSON.parse(readFileSync("apps/vscode/package.json", "utf8")) as { contributes: { configuration: ConfigurationSchema } }
const schema = pkg.contributes.configuration

const property = (overrides: Partial<PropertySchema>): PropertySchema => ({ type: "string", ...overrides })

describe("configuration schema", () => {
  test("one object and an array of objects both work", () => {
    const merged = configurationProperties([{ properties: { "opencode.a": property({}) } }, { properties: { "opencode.b": property({ type: "boolean" }) } }])
    expect(Object.keys(merged)).toEqual(["opencode.a", "opencode.b"])
    expect(configurationProperties(undefined)).toEqual({})
  })
  test("keys drop only the opencode prefix", () => {
    expect(shortKeyOf("opencode.transcript.fontSize")).toBe("transcript.fontSize")
    expect(shortKeyOf("other.key")).toBe("other.key")
  })
  test("every contributed setting is shown except the deprecated one", () => {
    const sections = buildSettingsSections(schema, {})
    const keys = sections.flatMap((section) => section.controls.map((control) => control.key))
    const contributed = Object.keys(schema.properties ?? {})
    expect(keys).not.toContain("opencode.voice.localLanguage")
    expect(keys.sort()).toEqual(contributed.filter((key) => key !== "opencode.voice.localLanguage").sort())
  })
  test("the page includes the new view width setting", () => {
    const view = buildSettingsSections(schema, {}).find((section) => section.id === "view")
    expect(view?.title).toBe("View")
    expect(view?.controls[0]).toMatchObject({ key: "opencode.view.minWidth", kind: "number", min: 0, defaultValue: 380 })
  })
  test("sections are grouped in a stable, readable order", () => {
    expect(buildSettingsSections(schema, {}).map((section) => section.id)).toEqual(["connection", "transcript", "todo", "notifications", "terminal", "voice", "view"])
  })
})

describe("section and control model", () => {
  test("server and CLI settings belong to Connection; nested keys to their first segment", () => {
    expect(sectionIdFor("serverUrl")).toBe("connection")
    expect(sectionIdFor("cliPath")).toBe("connection")
    expect(sectionIdFor("transcript.fontSize")).toBe("transcript")
    expect(sectionIdFor("voice.engine")).toBe("voice")
    expect(sectionIdFor("brandNewSetting")).toBe("connection")
  })
  test("labels read like VS Code settings", () => {
    expect(humanizeKey("collapseCompletedSteps")).toBe("Collapse completed steps")
    expect(humanizeKey("serverUrl")).toBe("Server URL")
    expect(humanizeKey("cliPath")).toBe("CLI path")
    expect(humanizeKey("localLanguages")).toBe("Local languages")
    expect(humanizeKey("todo.defaultExpanded")).toBe("Default expanded")
  })
  test("the schema type picks the control", () => {
    expect(controlKind(property({ type: "boolean" }))).toBe("boolean")
    expect(controlKind(property({ type: "number" }))).toBe("number")
    expect(controlKind(property({ type: "string", enum: ["a"] }))).toBe("enum")
    expect(controlKind(property({ type: "array", items: { type: "string" } }))).toBe("stringList")
    expect(controlKind(property({ type: "array", items: { type: "string", enum: ["en", "bn"] } }))).toBe("enumList")
  })
  test("enum options carry the schema labels and descriptions", () => {
    const [notifications] = buildSettingsSections(schema, {}).filter((section) => section.id === "notifications")
    const os = notifications?.controls.find((control) => control.shortKey === "notifications.os")
    expect(os?.options?.map((option) => option.value)).toEqual(["auto", "off"])
    expect(os?.options?.[0]?.description).toContain("taskbar button flashes")
  })
  test("the effective value is shown and an explicit value marks the setting modified", () => {
    const sections = buildSettingsSections(schema, {
      "transcript.fontSize": { value: 18, defaultValue: 0, globalValue: 18 },
      "transcript.showReasoning": { value: "expanded", defaultValue: "collapsed" },
    })
    const transcript = sections.find((section) => section.id === "transcript")!
    expect(transcript.controls.find((control) => control.shortKey === "transcript.fontSize")).toMatchObject({ value: 18, modified: true })
    expect(transcript.controls.find((control) => control.shortKey === "transcript.showReasoning")).toMatchObject({ value: "expanded", modified: false })
  })
  test("a machine scope is flagged, and the CLI path gets a Browse action", () => {
    const sections = buildSettingsSections(schema, {})
    const all = sections.flatMap((section) => section.controls)
    expect(all.find((control) => control.shortKey === "serverUrl")?.machine).toBe(true)
    expect(all.find((control) => control.shortKey === "transcript.fontSize")?.machine).toBe(false)
    expect(all.find((control) => control.shortKey === "cliPath")?.action).toEqual({ label: "Browse…", command: "opencode.setCliPath" })
  })
})

describe("where a value is written", () => {
  test("machine-scoped settings always go to User (Global) settings", () => {
    expect(resolveWriteTarget(property({ scope: "machine" }), "workspace")).toBe("global")
    expect(resolveWriteTarget(property({ scope: "machine-overridable" }), "workspace")).toBe("global")
    expect(resolveWriteTarget(property({ scope: "application" }), "workspace")).toBe("global")
  })
  test("window and resource settings can follow a Workspace choice; the default is User", () => {
    expect(resolveWriteTarget(property({ scope: "window" }), "workspace")).toBe("workspace")
    expect(resolveWriteTarget(property({ scope: "resource" }), "workspace")).toBe("workspace")
    expect(resolveWriteTarget(property({ scope: "window" }))).toBe("global")
  })
})

describe("value validation", () => {
  test("booleans must be booleans", () => {
    expect(coerceSettingValue(property({ type: "boolean" }), true)).toEqual({ ok: true, value: true })
    expect(coerceSettingValue(property({ type: "boolean" }), "true").ok).toBe(false)
  })
  test("numbers are checked against the schema bounds", () => {
    expect(coerceSettingValue(property({ type: "number", minimum: 0, maximum: 32 }), "18")).toEqual({ ok: true, value: 18 })
    expect(coerceSettingValue(property({ type: "number", minimum: 1 }), 0)).toMatchObject({ ok: false, error: "Enter 1 or more." })
    expect(coerceSettingValue(property({ type: "number", maximum: 5 }), 9)).toMatchObject({ ok: false, error: "Enter 5 or less." })
    expect(coerceSettingValue(property({ type: "number" }), "").ok).toBe(false)
    expect(coerceSettingValue(property({ type: "number" }), "abc").ok).toBe(false)
  })
  test("integer settings reject fractions", () => {
    expect(coerceSettingValue(property({ type: "integer" }), 2.5).ok).toBe(false)
    expect(coerceSettingValue(property({ type: "integer" }), 2)).toEqual({ ok: true, value: 2 })
  })
  test("string enums only accept their listed values", () => {
    const enumProperty = property({ type: "string", enum: ["collapsed", "expanded", "hidden"] })
    expect(coerceSettingValue(enumProperty, "hidden")).toEqual({ ok: true, value: "hidden" })
    expect(coerceSettingValue(enumProperty, "sideways").ok).toBe(false)
    expect(coerceSettingValue(enumProperty, 3).ok).toBe(false)
  })
  test("string lists are split, trimmed and de-duplicated", () => {
    expect(coerceSettingValue(property({ type: "array", items: { type: "string" } }), " bn, en ,bn, ")).toEqual({ ok: true, value: ["bn", "en"] })
    expect(coerceSettingValue(property({ type: "array", items: { type: "string" } }), ["en", "en"])).toEqual({ ok: true, value: ["en"] })
  })
  test("enum lists keep only values the schema knows", () => {
    const languages = property({ type: "array", items: { type: "string", enum: ["en", "bn"] } })
    expect(coerceSettingValue(languages, ["bn", "en"])).toEqual({ ok: true, value: ["bn", "en"] })
    expect(coerceSettingValue(languages, ["en", "xx"]).ok).toBe(false)
  })
})

describe("search and descriptions", () => {
  test("a section title match keeps all its controls; a control match keeps only that control", () => {
    const sections = buildSettingsSections(schema, {})
    const voice = sections.find((section) => section.id === "voice")!
    expect(filterSections(sections, "voice").find((section) => section.id === "voice")?.controls).toEqual(voice.controls)
    const transcript = filterSections(sections, "font size")
    expect(transcript.flatMap((section) => section.controls.map((control) => control.shortKey))).toEqual(["transcript.fontSize"])
    expect(filterSections(sections, "nothing-like-this")).toEqual([])
  })
  test("descriptions render code, bold, links and #setting# references, and never raw HTML", () => {
    expect(markdownLite("Use `opencode.serverUrl` **now**")).toBe("Use <code>opencode.serverUrl</code> <strong>now</strong>")
    expect(markdownLite("See [docs](https://example.com/x)")).toBe('See <a href="https://example.com/x" target="_blank" rel="noreferrer">docs</a>')
    expect(markdownLite("Uses `#chat.editor.fontSize#`")).toBe("Uses <code>chat.editor.fontSize</code>")
    expect(markdownLite("<img src=x onerror=alert(1)>")).toBe("&lt;img src=x onerror=alert(1)&gt;")
    expect(markdownLite("one\ntwo\n- three")).toBe("one<br>two<br>• three")
  })
})
