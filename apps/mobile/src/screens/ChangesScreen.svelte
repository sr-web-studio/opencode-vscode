<script lang="ts">
  import Codicon from "@occ/ui/components/Codicon.svelte"
  import { parsePatch, patchKind } from "@occ/core/diff"
  import Bar from "../components/Bar.svelte"
  import { leaf } from "../lib/files"
  import { model } from "../model.svelte"

  /** "Changes (3 files)" of a turn: the list of files, each opening its diff. */
  let { directory, title, files }: { directory: string; title: string; files: Array<{ file: string; patches: string[] }> } = $props()

  // The session that was open when Changes was tapped (not reactive on purpose: this list belongs to that session even if
  // another one is opened underneath later). Shown under the title so it is clear whose changes these are.
  // svelte-ignore state_referenced_locally
  const ctl = model.controller(directory)
  const sessionTitle = ctl.sessionMeta(ctl.currentSessionID ?? "")?.title?.trim() || undefined

  const icon = (patches: string[]) => {
    const k = patchKind(patches.flatMap((p) => parsePatch(p)))
    return k === "added" ? "diff-added" : k === "deleted" ? "diff-removed" : "diff-modified"
  }
</script>

<Bar {title} sub={sessionTitle} />

<div class="body">
  {#each files as f (f.file)}
    <button class="row" onclick={() => model.push({ kind: "diff", directory, file: f.file, patches: f.patches })}>
      <Codicon name={icon(f.patches)} />
      <span class="main"><span class="t">{leaf(f.file)}</span><span class="s">{f.file}</span></span>
      <Codicon name="chevron-right" />
    </button>
  {:else}
    <div class="center muted">No files changed.</div>
  {/each}
</div>
