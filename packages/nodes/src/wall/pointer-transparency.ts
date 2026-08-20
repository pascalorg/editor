/**
 * Should a wall's pointer handlers swallow (early-return) this event?
 *
 * Hidden walls ('down' wall mode, cutaway-hidden faces, auto-mode interior
 * partitions) are pointer-transparent so clicks reach the visible objects
 * behind their invisible full-height collision meshes (wall-mounted plugin
 * device / service boxes, items). Two exceptions keep the events flowing:
 *
 * - DELETE hover mode: hidden walls must stay hover-targetable for the
 *   deleteInvisible highlight flow.
 * - A live hidden-wall pointer HOLD (`holdHiddenWallPointerEvents`, core):
 *   the door / window move + place tools drive their cursor entirely from
 *   `wall:enter` / `wall:move` / `wall:click`, so while one is active the
 *   hidden wall must keep raycasting or the opening detaches into the floor
 *   free-follow (red world-axis ghost) instead of sliding along its wall.
 *
 * Visible walls never suppress. Pure so the truth table is testable without
 * an R3F rig; the renderer supplies live values per event.
 */
export const wallPointerEventsSuppressed = ({
  wallHidden,
  hoverHighlightMode,
  hiddenWallHoldActive,
}: {
  wallHidden: boolean
  hoverHighlightMode: string | null | undefined
  hiddenWallHoldActive: boolean
}): boolean => wallHidden && hoverHighlightMode !== 'delete' && !hiddenWallHoldActive
