import { getContext, setContext } from "svelte"
import type { Features } from "../core/protocol"
import type { Worker } from "../core/workers"
import type { Store } from "./store.svelte"

const KEY = Symbol("opencode.store")
const VIEW = Symbol("opencode.transcript")

export const provideStore = (store: Store) => setContext(KEY, store)
export const useStore = (): Store => getContext<Store>(KEY)

/** What transcript lines need from the surrounding view, as getters so they stay current. */
export type TranscriptContext = {
  workers: () => Worker[]
  features: () => Features
  readOnly: () => boolean
  running: () => boolean
}

export const provideTranscript = (c: TranscriptContext) => setContext(VIEW, c)
export const useTranscript = (): TranscriptContext => getContext<TranscriptContext>(VIEW)
