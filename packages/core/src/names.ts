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

const VARIANT_NAMES: Record<string, string> = { xhigh: "X-High", xlow: "X-Low" }

/** Display casing for model variants (`low` → `Low`, `xhigh` → `X-High`). The API keeps the original id. */
export function variantName(id: string): string {
  return VARIANT_NAMES[id.trim().toLowerCase()] ?? displayName(id)
}
