/**
 * Where a write went, on every surface: the project it reached, or `null` and `unsaved` on a
 * scratch scene no project holds, so an agent that missed a load error does not build on into
 * nothing (add_wall answered ok with no project bound). Its own key: a result's
 * `note` is the operation's.
 */
export const NOT_SAVED_NOTE =
  'Not saved to any project: create_project or load_scene first, or save_scene to keep it.'

export function writeTarget(project: string | null): { project: string | null; unsaved?: string } {
  return { project, ...(project ? {} : { unsaved: NOT_SAVED_NOTE }) }
}
