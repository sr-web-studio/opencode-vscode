/**
 * The app's version and the words of its preview label. The version comes from `apps/mobile/package.json` (Vite
 * `define` in vite.config.ts), so there is one source in the web code; the Android `versionName` is checked against it
 * by a unit test.
 */
declare const __APP_VERSION__: string

/** e.g. `0.2.2-beta`. "dev" when the build does not define it (unit tests). */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"

/** A pre-release such as `0.2.2-beta` is a preview build. */
export const IS_PREVIEW: boolean = /-(alpha|beta|rc|preview)/i.test(APP_VERSION)

/** The semver pre-release tag as a short word (`beta`), or undefined for a plain release. */
export const PREVIEW_TAG: string | undefined = /-([a-z]+)/i.exec(APP_VERSION)?.[1]?.toLowerCase()

/** The line at the bottom of Settings. */
export function aboutLine(version: string = APP_VERSION): string {
  const preview = /-(alpha|beta|rc|preview)/i.test(version) ? " · Preview build" : ""
  return `OpenCode (unofficial) ${version}${preview} · Not affiliated with the OpenCode team`
}
