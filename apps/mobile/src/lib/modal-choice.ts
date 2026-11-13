/**
 * A choice dialog (one button per option) shared by the model and its unit test. The phone's modal used to have a
 * single confirm button, so a choice like "Markdown or JSON?" needed two dialogs; with this it is one.
 */

/** One button of a choice dialog: the id the app acts on and the label it shows. */
export type ModalOption<T extends string = string> = { id: T; label: string }

/**
 * What a choice dialog resolves with: the id of the button that was pressed, or undefined when the dialog was
 * dismissed (Cancel, the scrim, Android back). An answer that is not one of the options is never returned.
 */
export function choiceAnswer<T extends string>(options: ReadonlyArray<ModalOption<T>>, answer: boolean | string | undefined): T | undefined {
  return typeof answer === "string" ? options.find((option) => option.id === answer)?.id : undefined
}
