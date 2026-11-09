/**
 * Project display names as OpenCode keeps them on the server.
 *
 * A project record is matched by id, never by its canonical folder: the server can hold several records for the same
 * folder (and a `global` record), so picking "the first project with this path" would show another record's name.
 * Pure helpers, so the VS Code extension, the webview and the Android app apply the same rules.
 */

/** The parts of an OpenCode `Project` these helpers need. */
export type ProjectNameRecord = { id: string; canonical?: string; name?: string }

/** Longest name we accept. The server stores longer ones; this keeps the dropdown readable. */
export const MAX_PROJECT_NAME = 100

/** Trim a stored or typed name. An empty name means "no name": the folder name shows instead. */
export function normalizeProjectName(value: string | undefined | null): string | undefined {
  const name = typeof value === "string" ? value.trim() : ""
  return name ? name : undefined
}

export type ProjectNameCheck = { ok: true; name: string | undefined } | { ok: false; error: string }

/**
 * Check a name typed into an InputBox. An empty value is valid and clears the name: OpenCode then shows the folder
 * name again, which is what the server does with an empty `project.update` name.
 */
export function checkProjectName(value: string): ProjectNameCheck {
  const name = normalizeProjectName(value)
  if (name && name.length > MAX_PROJECT_NAME) return { ok: false, error: `Use ${MAX_PROJECT_NAME} characters or fewer.` }
  return { ok: true, name }
}

/** The name OpenCode shows for a project, or undefined when it has none. */
export function projectNameOf(projectID: string | undefined, projects: readonly ProjectNameRecord[]): string | undefined {
  if (!projectID) return undefined
  return normalizeProjectName(projects.find((project) => project.id === projectID)?.name)
}

/** What to show for a folder: its project name when OpenCode has one, else the workspace folder name. */
export function projectDisplayName(name: string | undefined, folderName: string): string {
  return normalizeProjectName(name) ?? folderName
}

/** A `project.updated` payload folded into a project-id → name map. An empty or missing name removes the entry. */
export function applyProjectUpdated(names: ReadonlyMap<string, string>, project: ProjectNameRecord): ReadonlyMap<string, string> {
  const next = new Map(names)
  const name = normalizeProjectName(project.name)
  if (name) next.set(project.id, name)
  else next.delete(project.id)
  return next
}
