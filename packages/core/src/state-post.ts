import type { AppState } from "./protocol"
import type { SessionView, StepView, TurnView } from "./transcript/types"

/**
 * State posts are the largest thing a busy window sends: a whole `AppState` (every session of the project, the whole
 * transcript) on every 30 ms emit. This module turns the difference between two states into a small message the webview
 * can apply, so a streaming answer costs a few kilobytes instead of a few hundred.
 *
 * The transcript is diffed by reference: the reducer is immutable and shares every turn and step it did not touch, so a
 * changed reference means a changed turn, and the patch only carries what changed.
 */

/** The steps of one changed turn. A step is small, so a changed one is sent whole. */
export type StepPatchOps = { kind: "full"; steps: StepView[] } | { kind: "append"; from: number; steps: StepView[] } | { kind: "changes"; changes: Array<{ index: number; step: StepView }> }

/**
 * One changed turn: either the whole turn, or its fields without `steps` plus a patch for the steps. `steps` is left
 * out of the turn itself because it is usually the largest part of it.
 */
export type TurnPatch = { index: number; turn: TurnView } | { index: number; turn: Omit<TurnView, "steps">; steps: StepPatchOps }

export type TurnPatchOps =
  | { kind: "full"; turns: TurnView[] }
  /** The turns the previous state ended with are still there: only the new tail is sent. */
  | { kind: "append"; from: number; turns: TurnView[] }
  /** "Show earlier messages": the previous turns are now the tail. */
  | { kind: "prepend"; turns: TurnView[] }
  | { kind: "changes"; changes: TurnPatch[] }

export type ViewPatch = {
  turns?: TurnPatchOps
  queued?: SessionView["queued"]
  loaded?: boolean
  revert?: SessionView["revert"]
  /** View fields the new state does not set any more (`revert` when a staged rollback is dropped). */
  cleared?: Array<"queued" | "loaded" | "revert">
}

/**
 * What changed between two states. Only the keys that changed are present. `cleared` lists the keys that must be
 * removed: a message is JSON, so a key set to `undefined` would not arrive at all.
 */
export type StatePatch = Partial<Omit<AppState, "view">> & { view?: ViewPatch; cleared?: string[] }

/* --------------------------------------------------------------- diffing */

/**
 * Compare two values the way the webview needs them: by identity, then by shape for the small arrays and records that
 * `snapshot()` rebuilds on every call (`running`, `waiting`, `workerRunning`, `pins`, `folders`, …).
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => k in b && sameValue(a[k], b[k]))
  }
  return false
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Everything that changed from `prev` to `next`, or undefined when nothing the view shows did. */
export function diffState(prev: AppState, next: AppState): StatePatch | undefined {
  const patch: Record<string, unknown> = {}
  const cleared: string[] = []
  let any = false
  for (const key of Object.keys(next) as Array<keyof AppState>) {
    const before = prev[key]
    const after = next[key]
    if (key === "view") {
      if (before === after) continue
      const view = diffView(before as SessionView, after as SessionView)
      if (view) {
        patch.view = view
        any = true
      }
      continue
    }
    if (after === undefined) {
      // A key the new state does not set. It cannot travel as `undefined` (a message is JSON), so it is listed.
      if (before !== undefined) {
        cleared.push(key)
        any = true
      }
      continue
    }
    if (sameValue(before, after)) continue
    patch[key] = after
    any = true
  }
  for (const key of Object.keys(prev)) {
    if (key in next || cleared.includes(key)) continue
    cleared.push(key)
    any = true
  }
  if (cleared.length > 0) patch.cleared = cleared
  return any ? (patch as StatePatch) : undefined
}

function diffView(prev: SessionView, next: SessionView): ViewPatch | undefined {
  const patch: ViewPatch = {}
  const cleared: Array<"queued" | "loaded" | "revert"> = []
  let any = false
  if (prev.turns !== next.turns) {
    const turns = diffTurns(prev.turns, next.turns)
    if (turns) {
      patch.turns = turns
      any = true
    }
  }
  if (prev.queued !== next.queued) {
    patch.queued = next.queued
    any = true
  }
  if (prev.loaded !== next.loaded) {
    patch.loaded = next.loaded
    any = true
  }
  if (prev.revert !== next.revert) {
    if (next.revert === undefined) cleared.push("revert")
    else patch.revert = next.revert
    any = true
  }
  if (cleared.length > 0) patch.cleared = cleared
  return any ? patch : undefined
}

/** Undefined when the arrays hold the same turns in the same order (a fresh array of the same objects). */
function diffTurns(prev: TurnView[], next: TurnView[]): TurnPatchOps | undefined {
  if (prev.length === next.length && isPrefix(prev, next)) return undefined
  if (prev.length === 0) return { kind: "full", turns: next }
  if (next.length > prev.length) {
    if (isPrefix(prev, next)) return { kind: "append", from: prev.length, turns: next.slice(prev.length) }
    if (isSuffix(prev, next)) return { kind: "prepend", turns: next.slice(0, next.length - prev.length) }
  }
  if (next.length === prev.length) {
    const changes: TurnPatch[] = []
    for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) changes.push(diffTurn(i, prev[i]!, next[i]!))
    if (changes.length > 0) return { kind: "changes", changes }
  }
  return { kind: "full", turns: next }
}

function diffTurn(index: number, prev: TurnView, next: TurnView): TurnPatch {
  // A different id means a different turn in that place; the whole turn is cheaper than checking every field.
  if (prev.id !== next.id || prev.steps === next.steps) return { index, turn: next }
  const { steps, ...head } = next
  return { index, turn: head, steps: diffSteps(prev.steps, next.steps) }
}

function diffSteps(prev: StepView[], next: StepView[]): StepPatchOps {
  if (prev.length === 0) return { kind: "full", steps: next }
  if (next.length > prev.length && isPrefix(prev, next)) return { kind: "append", from: prev.length, steps: next.slice(prev.length) }
  if (next.length === prev.length) {
    const changes: Array<{ index: number; step: StepView }> = []
    for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) changes.push({ index: i, step: next[i]! })
    if (changes.length > 0) return { kind: "changes", changes }
  }
  return { kind: "full", steps: next }
}

function isPrefix(prev: ReadonlyArray<unknown>, next: ReadonlyArray<unknown>): boolean {
  if (prev.length > next.length) return false
  for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return false
  return true
}

function isSuffix(prev: ReadonlyArray<unknown>, next: ReadonlyArray<unknown>): boolean {
  const offset = next.length - prev.length
  if (offset < 0) return false
  for (let i = 0; i < prev.length; i++) if (prev[i] !== next[offset + i]) return false
  return true
}

/* --------------------------------------------------------------- applying */

/**
 * Apply a patch to the state the webview holds. Throws when the patch does not fit the state (a lost or reordered
 * message): the caller then asks for a full state instead of showing a transcript that is quietly wrong.
 */
export function applyStatePatch(prev: AppState, patch: StatePatch): AppState {
  const next: Record<string, unknown> = { ...prev }
  for (const key of patch.cleared ?? []) delete next[key]
  for (const key of Object.keys(patch)) {
    if (key === "cleared") continue
    const value = (patch as Record<string, unknown>)[key]
    if (key === "view") {
      if (value !== undefined) next.view = applyViewPatch(prev.view, value as ViewPatch)
      continue
    }
    next[key] = value
  }
  return next as AppState
}

function applyViewPatch(prev: SessionView, patch: ViewPatch): SessionView {
  const next: SessionView = { ...prev }
  for (const key of patch.cleared ?? []) delete (next as Record<string, unknown>)[key]
  if (patch.turns) next.turns = applyTurnPatch(prev.turns, patch.turns)
  if ("queued" in patch) next.queued = patch.queued!
  if ("loaded" in patch) next.loaded = patch.loaded!
  if ("revert" in patch) next.revert = patch.revert
  return next
}

function applyTurnPatch(prev: TurnView[], patch: TurnPatchOps): TurnView[] {
  if (patch.kind === "full") return patch.turns
  if (patch.kind === "append") {
    if (patch.from !== prev.length) throw new Error("state patch: turn append does not fit")
    return [...prev, ...patch.turns]
  }
  if (patch.kind === "prepend") return [...patch.turns, ...prev]
  const next = prev.slice()
  for (const change of patch.changes) {
    const before = next[change.index]
    if (!before) throw new Error("state patch: turn change out of range")
    next[change.index] = "steps" in change ? { ...change.turn, steps: applyStepPatch(before.steps, change.steps) } : change.turn
  }
  return next
}

function applyStepPatch(prev: StepView[], patch: StepPatchOps): StepView[] {
  if (patch.kind === "full") return patch.steps
  if (patch.kind === "append") {
    if (patch.from !== prev.length) throw new Error("state patch: step append does not fit")
    return [...prev, ...patch.steps]
  }
  const next = prev.slice()
  for (const change of patch.changes) {
    if (!next[change.index]) throw new Error("state patch: step change out of range")
    next[change.index] = change.step
  }
  return next
}
