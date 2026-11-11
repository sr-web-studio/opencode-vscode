/**
 * `/export` on the phone: write the file the controller built, then open Android's share sheet. No new native code:
 * `@capacitor/filesystem` writes it into the app's cache and `@capacitor/share` hands that file to the app the user
 * picks (Drive, mail, Files, …). Without a share target it is saved to Documents instead. In a desktop browser
 * (`bun run dev`) it is an ordinary download.
 */
import { Capacitor } from "@capacitor/core"
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem"
import { Share } from "@capacitor/share"

export type ExportSave = {
  how: "share" | "documents" | "download"
  name: string
}

export async function saveExport(name: string, content: string, mime: string): Promise<ExportSave> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const a = document.createElement("a")
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return { how: "download", name }
  }

  const canShare = await Share.canShare().catch(() => ({ value: false }))
  if (canShare.value) {
    const written = await Filesystem.writeFile({ path: name, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 })
    await Share.share({ title: name, files: [written.uri], dialogTitle: "Export session" })
    return { how: "share", name }
  }

  await Filesystem.writeFile({ path: name, data: content, directory: Directory.Documents, encoding: Encoding.UTF8 })
  return { how: "documents", name }
}
