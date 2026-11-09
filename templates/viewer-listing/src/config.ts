/** Where the viewer reads from. Both are public values; no secret belongs here. */
export const PASCAL_BASE_URL = (
  import.meta.env.VITE_PASCAL_BASE_URL || 'https://editor.pascal.app'
).replace(/\/+$/, '')

/** `?project=<id>` wins, so one deployment can show any public project. */
export function projectIdFromLocation(search = window.location.search): string | null {
  const fromQuery = new URLSearchParams(search).get('project')?.trim()
  return fromQuery || import.meta.env.VITE_PASCAL_PROJECT_ID?.trim() || null
}
