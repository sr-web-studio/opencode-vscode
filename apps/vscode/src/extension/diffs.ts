import * as vscode from "vscode"
import { hunksOnly, parsePatch, patchKind, reconstructBefore } from "@occ/core/diff"

export const DIFF_SCHEME = "opencode-diff"
const MAX_DOCS = 400

/** One side-by-side pair for the diff editor: the left (before) and right (after) documents of a file. */
export type DiffPair = { file: string; label: string; resource: vscode.Uri; before: vscode.Uri; after: vscode.Uri; hunksOnly: boolean }

/**
 * Virtual `opencode-diff:` documents for the "before" side of an edit (and for the hunks-only fallback). The text is
 * rebuilt from the edit tool's patch, so nothing is written to disk and OpenCode's files are never touched.
 */
export class DiffViews implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly docs = new Map<string, string>()
  private seq = 0
  private readonly registration: vscode.Disposable

  constructor(private readonly resolve: (path: string) => vscode.Uri) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, this)
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.toString()) ?? ""
  }

  /** A virtual document that ends in the real file name, so VS Code picks the right language for highlighting. */
  private virtual(file: string, side: string, text: string): vscode.Uri {
    const name =
      file
        .split(/[\\/]+/)
        .filter(Boolean)
        .pop() ?? "file"
    const uri = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${++this.seq}/${side}/${name}` })
    this.docs.set(uri.toString(), text)
    if (this.docs.size > MAX_DOCS) this.docs.delete(this.docs.keys().next().value as string)
    return uri
  }

  private async current(uri: vscode.Uri): Promise<string | undefined> {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
    } catch {
      return undefined
    }
  }

  /**
   * The before/after pair of a file. `after` is the file on disk; `before` is rebuilt by applying the patches backwards.
   * Added files compare with an empty document, deleted files with an empty "after". When the file changed too much
   * for that, the pair is just the hunks of the patches (old side, new side).
   */
  async pair(file: string, patches: ReadonlyArray<string>): Promise<DiffPair> {
    const target = this.resolve(file)
    const text = await this.current(target)
    const first = patchKind(parsePatch(patches[0] ?? ""))
    const last = patchKind(parsePatch(patches[patches.length - 1] ?? ""))
    const make = (before: string, after: vscode.Uri, onlyHunks: boolean): DiffPair => ({
      file,
      label: onlyHunks ? `${file} (edit, hunks only)` : `${file} (OpenCode edit)`,
      resource: target,
      before: this.virtual(file, "before", before),
      after,
      hunksOnly: onlyHunks,
    })
    if (text === undefined) {
      // Gone from disk: a deleted file is rebuilt from its patch; anything else shows only the hunks.
      const rebuilt = last === "deleted" ? reconstructBefore("", patches) : undefined
      if (rebuilt !== undefined) return make(rebuilt, this.virtual(file, "after", ""), false)
    } else if (first === "added" && patches.length === 1) {
      return make("", target, false)
    } else {
      const before = reconstructBefore(text, patches)
      if (before !== undefined) return make(before, target, false)
    }
    const sides = hunksOnly(patches)
    return { file, label: `${file} (edit, hunks only)`, resource: target, before: this.virtual(file, "before", sides.before), after: this.virtual(file, "after", sides.after), hunksOnly: true }
  }

  /** `vscode.diff(before, after, "<file> (OpenCode edit)")` */
  async open(file: string, patches: ReadonlyArray<string>): Promise<void> {
    if (patches.length === 0) {
      void vscode.window.showInformationMessage(`No changes were recorded for ${file}.`)
      return
    }
    const pair = await this.pair(file, patches)
    await vscode.commands.executeCommand("vscode.diff", pair.before, pair.after, pair.label, { preview: true })
  }

  /** One editor with every changed file of a turn (`vscode.changes`, VS Code 1.88 and later). */
  async changes(files: ReadonlyArray<{ file: string; patches: string[] }>, title: string): Promise<void> {
    const pairs = await Promise.all(files.filter((f) => f.patches.length > 0).map((f) => this.pair(f.file, f.patches)))
    if (pairs.length === 0) return
    await vscode.commands.executeCommand(
      "vscode.changes",
      title,
      pairs.map((p) => [p.resource, p.before, p.after]),
    )
  }

  dispose(): void {
    this.registration.dispose()
    this.docs.clear()
  }
}
