/**
 * What the prompt box does with focus once a prompt left it. The editor keeps the caret in the box (`focus`); a phone
 * (`dismiss`) lets go so the soft keyboard closes. `hasFocus` is whether the box is the active element: a box that is
 * not focused is never touched.
 */
export const focusAfterSend = (dismiss: boolean, hasFocus: boolean): "focus" | "blur" | "none" => (!dismiss ? "focus" : hasFocus ? "blur" : "none")
