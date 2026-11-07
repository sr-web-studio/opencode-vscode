/**
 * The phone's file picker for the prompt's paperclip: a hidden `<input type="file">` (Android shows its document
 * picker). Files become `data:` URIs, up to 20 MiB each, like pasted files in the VS Code UI.
 */
import { checkBlob, dataUri, mimeFromName } from "@occ/core/attachments"
import type { PickedFile } from "@occ/core/protocol"

export type PickResult = { files: PickedFile[]; problems: string[] }

function read(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."))
    reader.readAsDataURL(file)
  })
}

export function pickFiles(): Promise<PickResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.addEventListener("cancel", () => resolve({ files: [], problems: [] }))
    input.addEventListener("change", async () => {
      const files: PickedFile[] = []
      const problems: string[] = []
      for (const file of Array.from(input.files ?? [])) {
        const mime = file.type || mimeFromName(file.name) || "application/octet-stream"
        const check = checkBlob({ mime, bytes: file.size, name: file.name })
        if (!check.ok) {
          problems.push(check.reason)
          continue
        }
        try {
          const url = await read(file)
          // `readAsDataURL` can name the type differently (or not at all); the base64 part is what counts.
          files.push({ uri: dataUri(mime, url.slice(url.indexOf(",") + 1)), name: file.name, mime })
        } catch {
          problems.push(`${file.name} could not be read.`)
        }
      }
      resolve({ files, problems })
    })
    input.click()
  })
}
