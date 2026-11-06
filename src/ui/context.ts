import { getContext, setContext } from "svelte"
import type { Store } from "./store.svelte"

const KEY = Symbol("opencode.store")

export const provideStore = (store: Store) => setContext(KEY, store)
export const useStore = (): Store => getContext<Store>(KEY)
