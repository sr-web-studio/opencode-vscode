/**
 * Display casing for ids that come from the server (`assistant`, `code-reviewer`, `shell`).
 * Only the first letter of each word is raised, so `GPT` stays `GPT`. The API keeps receiving the original ids.
 */
export function displayName(id: string): string {
  return id
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
