import { Buffer } from "node:buffer"
import * as vscode from "vscode"
import type { Controller } from "@occ/core/controller"
import type { FolderRegistry } from "@occ/core/folders"
import { MAX_ATTACHMENT_BYTES, dataUri, mimeFromName } from "@occ/core/attachments"
import { ImageCache, type ImageBytes } from "@occ/core/image-cache"
import { previewName, safeImageMime, stalePreviews, type ImageRef } from "@occ/core/images"

/**
 * Sent images for the webview: thumbnails on request, and previews in VS Code's own image viewer.
 * The bytes live here (bounded cache), never in the state that is posted on every emit.
 */
export class ImagePreviews implements vscode.Disposable {
  private readonly cache: ImageCache
  private readonly stops = new Map<string, () => void>()
  private readonly offFolders: () => void

  constructor(
    private readonly storage: vscode.Uri,
    private readonly folders: FolderRegistry<Controller>,
  ) {
    this.cache = new ImageCache({
      message: async (sessionID, messageID) => {
        const client = this.folders.controllers().find((c) => c.api)?.api
        return client ? await client.session.message.get({ sessionID, messageID }) : undefined
      },
      file: async (uri) => {
        const target = vscode.Uri.parse(uri)
        const stat = await vscode.workspace.fs.stat(target)
        if (stat.size > MAX_ATTACHMENT_BYTES) return undefined
        const bytes = await vscode.workspace.fs.readFile(target)
        return { mime: mimeFromName(target.path), base64: Buffer.from(bytes).toString("base64") }
      },
    })
    this.syncFolders()
    this.offFolders = folders.onChange(() => this.syncFolders())
  }

  /** A pasted image keeps its picture from the moment it is sent, before the server's stored copy is read. Every folder. */
  private syncFolders(): void {
    const open = new Set(this.folders.directories())
    for (const [directory, stop] of [...this.stops]) {
      if (open.has(directory)) continue
      stop()
      this.stops.delete(directory)
    }
    for (const controller of this.folders.controllers()) {
      // The workspace path: `controller.directory` is the server's spelling and would duplicate the stream after a sync.
      const path = controller.folderPath
      if (!path || this.stops.has(path)) continue
      this.stops.set(
        path,
        controller.observe({
          event: (ev) => {
            if (ev.type !== "session.inbox.enqueued") return
            const item = ev.data?.item
            if (item?.type === "user" && typeof ev.data?.inboxID === "string") this.cache.seed(ev.data.inboxID, item.payload?.files)
          },
        }),
      )
    }
  }

  private dir(): vscode.Uri {
    return vscode.Uri.joinPath(this.storage, "previews")
  }

  /** Delete preview files from earlier days. Anything that does not look like a preview is left alone. */
  async cleanup(): Promise<void> {
    try {
      const list = await vscode.workspace.fs.readDirectory(this.dir())
      const entries = await Promise.all(
        list.filter(([, type]) => type === vscode.FileType.File).map(async ([name]) => ({ name, mtime: (await vscode.workspace.fs.stat(vscode.Uri.joinPath(this.dir(), name))).mtime })),
      )
      for (const name of stalePreviews(entries, Date.now())) await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.dir(), name))
    } catch {
      // No previews folder yet: nothing to clean.
    }
  }

  private async bytes(sessionID: string | undefined, ref: ImageRef): Promise<ImageBytes | undefined> {
    return sessionID ? this.cache.get(sessionID, ref) : undefined
  }

  /** The thumbnail source for the webview, or undefined when the image is gone or is not an image type. */
  async thumbnail(sessionID: string | undefined, ref: ImageRef): Promise<string | undefined> {
    const b = await this.bytes(sessionID, ref)
    return b && safeImageMime(b.mime) ? dataUri(b.mime, b.base64) : undefined
  }

  /** Write the image to `globalStorageUri/previews/<msgid>-<i>.<ext>` and open it with `vscode.open` (the image viewer, with zoom). */
  async open(sessionID: string | undefined, ref: ImageRef, name?: string): Promise<void> {
    const b = await this.bytes(sessionID, ref)
    if (!b || !safeImageMime(b.mime)) {
      void vscode.window.showWarningMessage("This image is no longer available.")
      return
    }
    await vscode.workspace.fs.createDirectory(this.dir())
    const target = vscode.Uri.joinPath(this.dir(), previewName(ref, b.mime, name))
    await vscode.workspace.fs.writeFile(target, Buffer.from(b.base64, "base64"))
    await vscode.commands.executeCommand("vscode.open", target, { preview: true })
  }

  dispose(): void {
    this.offFolders()
    for (const stop of this.stops.values()) stop()
    this.stops.clear()
    this.cache.clear()
  }
}
