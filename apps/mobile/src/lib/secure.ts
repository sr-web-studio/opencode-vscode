/**
 * Secure storage for the saved servers (passwords and pairing tokens). On Android this is the Keystore-backed
 * `@aparajita/capacitor-secure-storage`. In a desktop browser (`bun run dev`) the plugin falls back to localStorage;
 * that is for testing only, the phone never uses it.
 */
import { SecureStorage } from "@aparajita/capacitor-secure-storage"
import type { SecureKV } from "./profiles"

export const secureKV: SecureKV = {
  get: (key) => SecureStorage.get(key),
  set: async (key, value) => {
    await SecureStorage.set(key, value)
  },
  remove: async (key) => {
    await SecureStorage.remove(key)
  },
}
