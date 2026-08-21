import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'

/**
 * Hidden-wall gate for the door / window MOVE tools.
 *
 * #689's hidden-wall pointer hold keeps EVERY hidden wall a ray target while
 * an opening tool is active — that fixed the drag detaching into the floor
 * free-follow (red world-axis ghost) when the node's own wall is hidden in
 * X-ray. But nearest-hit-wins over-corrected the MOVE tools: a hidden wall
 * INTERPOSED between the camera and the dragged opening's own wall caught
 * the `wall:move` stream, so the drag silently rode a wall the user cannot
 * see and the commit RE-PARENTED the opening onto it (night-6 QA: a window
 * moved along its z=0 wall landed on an invisible wall at z=-2.5).
 *
 * Rule — while MOVING an existing opening, a wall event may drive the drag
 * only when:
 *  - the event's wall is one of the node's OWN walls (the wall it was
 *    grabbed from, or the host it legitimately re-parented to mid-drag),
 *    hidden or not — an X-ray drag along its own hidden wall keeps working
 *    exactly as #689 intended; or
 *  - the event's wall is VISIBLE — cross-wall re-parenting stays possible,
 *    but only onto a target the user can actually see.
 *
 * Ignored events must NOT stop propagation: R3F then continues down the
 * intersection list, so the ray falls through the interposed hidden wall to
 * the node's own wall behind it and the drag keeps riding the wall the user
 * is reasoning about. If the ray misses the own wall entirely the existing
 * off-wall handling (floor free-follow) takes over unchanged.
 *
 * PLACE (fresh door/window, incl. `metadata.isNew` duplicates) keeps the
 * all-walls behavior — placing onto any wall, hidden ones included, is the
 * intended X-ray experience; the tools skip this gate for those.
 *
 * Pure so the truth table is testable without an R3F rig (mirrors
 * `wallPointerEventsSuppressed`); the tools supply live values per event.
 */
export const shouldIgnoreWallEventForOpeningMove = ({
  eventWallId,
  eventWallHidden,
  ownWallIds,
}: {
  /** The wall that emitted the `wall:enter` / `wall:move` / `wall:click`. */
  eventWallId: string
  /** Live hide state of that wall (the wall-mode pass, see `isWallMeshHidden`). */
  eventWallHidden: boolean
  /**
   * Walls the moving node may ride even while hidden: the wall it was
   * grabbed from and its current mid-drag host. Non-wall entries (a level id
   * during free-follow, a roof segment, `null`) simply never match.
   */
  ownWallIds: ReadonlyArray<string | null | undefined>
}): boolean => eventWallHidden && !ownWallIds.includes(eventWallId)

/**
 * Live hide state of a wall's registered mesh. `WallCutout` stamps
 * `userData.wallHidden` on the wall's scene-registry mesh every pass (X-ray
 * 'down' mode, cutaway-hidden faces, auto-mode interior partitions); the
 * wall renderer's pointer gate reads the same stamp. Unregistered walls
 * (not mounted yet) count as visible — there is nothing to fall through to.
 */
export const isWallMeshHidden = (wallId: string): boolean =>
  sceneRegistry.nodes.get(wallId as AnyNodeId)?.userData?.wallHidden === true
