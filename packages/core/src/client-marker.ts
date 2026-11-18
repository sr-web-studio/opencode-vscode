/**
 * Session metadata every session created by these clients carries. The Android app's notification service reads
 * `metadata.client` to tell a session a person started here from an agent's own probe session, before any client has
 * viewed it. Keep the value in step with `SessionMeta.CLIENT` in
 * `apps/mobile/android/app/src/main/java/dev/srwebstudio/opencode/notify/SessionMeta.java`.
 */
export const CLIENT_MARKER = "occ"

export const CLIENT_METADATA = { client: CLIENT_MARKER } as const
