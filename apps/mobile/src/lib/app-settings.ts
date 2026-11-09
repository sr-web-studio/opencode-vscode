/**
 * The app's own settings, the pure part: what the chat looks like on this phone and which model "Enhance prompt"
 * uses per server. Values live in localStorage (the screens and the model write them); reading them validates every
 * field, so a hand-edited or older value falls back to its default instead of breaking the chat.
 *
 * No DOM and no Capacitor here: the unit tests import this file directly.
 */
import { normalizeModelSelection, type ModelSelection } from "@occ/core/models"
import { defaultViewSettings, type ViewSettings } from "@occ/core/protocol"

/** Chat display settings, shared by every open project. */
export const VIEW_KEY = "occ.view"
/** One "Enhance prompt" model per saved server, the same key the controller reads. */
export const ENHANCE_KEY_PREFIX = "occ.enhanceModel."

/** The transcript sizes the Settings screen offers, in px. */
export const FONT_MIN = 12
export const FONT_MAX = 20
export const FONT_SIZES: readonly number[] = Array.from({ length: FONT_MAX - FONT_MIN + 1 }, (_, i) => FONT_MIN + i)

const asObject = (raw: unknown): Record<string, unknown> => (typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {})

/** A saved size in the offered range, rounded; anything else keeps the default. */
function fontSize(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return defaultViewSettings.fontSize
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(raw)))
}

/** Read chat display settings; missing or wrong values keep their defaults. */
export function parseViewSettings(raw: unknown): ViewSettings {
  const o = asObject(raw)
  const bool = (key: keyof ViewSettings, fallback: boolean) => (typeof o[key] === "boolean" ? (o[key] as boolean) : fallback)
  const reasoning = o.showReasoning
  return {
    collapseCompletedSteps: bool("collapseCompletedSteps", defaultViewSettings.collapseCompletedSteps),
    expandToolDetails: bool("expandToolDetails", defaultViewSettings.expandToolDetails),
    showReasoning: reasoning === "expanded" || reasoning === "hidden" ? reasoning : "collapsed",
    fontSize: fontSize(o.fontSize),
    todoDefaultExpanded: bool("todoDefaultExpanded", defaultViewSettings.todoDefaultExpanded),
    terminalFontFamily: typeof o.terminalFontFamily === "string" ? o.terminalFontFamily : defaultViewSettings.terminalFontFamily,
  }
}

/** Apply a change on top of the saved values, validating the result as if it came from storage. */
export function patchViewSettings(current: ViewSettings, patch: Partial<ViewSettings>): ViewSettings {
  return parseViewSettings({ ...current, ...patch })
}

/** The localStorage key of one server's enhancement model. */
export function enhanceModelKey(profileID: string): string {
  return `${ENHANCE_KEY_PREFIX}${profileID}`
}

/** A saved enhancement model, or undefined for "the server's default model". */
export function parseEnhanceModel(raw: unknown): ModelSelection | undefined {
  return normalizeModelSelection(raw)
}

/** "Server default", or the saved model as `provider/model` with its variant. */
export function enhanceModelLabel(model: ModelSelection | undefined): string {
  if (!model) return "Server default"
  return `${model.providerID}/${model.id}${model.variant ? ` · ${model.variant}` : ""}`
}

/** Every key that "Reset app settings" clears. Servers, sessions, passwords and notification switches are not here. */
export function resetSettingKeys(profileIDs: ReadonlyArray<string>): string[] {
  return [VIEW_KEY, ...profileIDs.map(enhanceModelKey)]
}
