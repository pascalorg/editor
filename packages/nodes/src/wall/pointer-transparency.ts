/**
 * Should a wall's pointer handlers swallow (early-return) this event?
 *
 * Hidden walls ('down' wall mode, cutaway-hidden faces, auto-mode interior
 * partitions) keep invisible full-height collision meshes that raycast for
 * every pointer event. #683 made them blanket pointer-TRANSPARENT so clicks
 * reached the visible objects behind them (wall-mounted plugin device /
 * service boxes, items). That over-corrected hover + selection: with the
 * Bones X-ray on (walls hidden, framing members — handler-less
 * InstancedMeshes — rendering where the walls are), mousing over a wall
 * highlighted and selected the furniture BEHIND it, because nothing at the
 * wall's depth was a ray candidate at all.
 *
 * The rule is now NEAREST-FIRST with wall-furniture priority: a hidden wall
 * participates in hover/selection raycasts and wins when it is genuinely the
 * closest thing on the ray, but it YIELDS (early-return, no stopPropagation,
 * so R3F falls through to the real target) whenever any other interactive
 * hit outranks it:
 *
 * - a hit HOSTED by this wall (its own doors / windows / wall-mounted
 *   children — subtree membership, so grazing angles can't inflate the
 *   depth gap past any epsilon);
 * - a hit at ~equal-or-nearer depth (`HIDDEN_WALL_SELECTION_EPSILON`
 *   tie-break: device boxes flush with / proud of / recessed into the face,
 *   items standing in front of the wall);
 * - a WALL-MOUNTED hit anywhere further down the ray — a non-wall hit
 *   within epsilon of some other wall's collision hit (the #683 / night-5
 *   D4 class: a visible receptacle on a wall two meters BEHIND an
 *   interposed hidden wall must still win — the interposed wall falls
 *   through exactly like the #694 MOVE gate does).
 *
 * Free-standing hits clearly behind the wall (a sofa mid-room, the floor
 * slab, the grid) no longer outrank it: the wall in front highlights, which
 * is what the ray visually strikes when the Bones framing renders there.
 * Trade-off (deliberate, host-side only — no plugin presence flag): in a
 * plain manual 'down' mode with NO overlay rendering at the wall, that same
 * wall strip becomes hover/selectable again even though it draws nothing.
 *
 * Two pre-existing exceptions keep ALL events flowing unconditionally:
 *
 * - DELETE hover mode: hidden walls must stay hover-targetable for the
 *   deleteInvisible highlight flow.
 * - A live hidden-wall pointer HOLD (`holdHiddenWallPointerEvents`, core):
 *   the door / window move + place tools drive their cursor entirely from
 *   `wall:enter` / `wall:move` / `wall:click`, so while one is active the
 *   hidden wall must keep raycasting or the opening detaches into the floor
 *   free-follow (red world-axis ghost) instead of sliding along its wall.
 *   (#694's own-wall MOVE gate then filters those events downstream —
 *   this predicate never runs for held events, so the two compose.)
 *
 * Visible walls never suppress. Pure so the truth table is testable without
 * an R3F rig; the renderer supplies live values per event.
 */

/**
 * Depth tie-break for "at the wall face": in-wall boxes sit flush-to-
 * recessed within a wall thickness (0.09–0.3 m); openings sit inside the
 * slab. Along-ray gaps inflate by 1/cos(incidence), so this carries typical
 * face-mounted gear through moderate grazing angles without letting a sofa
 * a metre behind the wall win.
 */
export const HIDDEN_WALL_SELECTION_EPSILON = 0.35

/** The wall renderer names its invisible pick mesh this (see renderer.tsx). */
export const WALL_COLLISION_MESH_NAME = 'collision-mesh'

/** One interactive raycast hit, reduced to what the yield rule needs. */
export type WallRayHit = {
  /** Distance along the ray, in meters (three.js Intersection.distance). */
  distance: number
  /** True when the hit object is some wall's invisible collision mesh. */
  isWallCollision: boolean
  /** True when the hit object lives inside THIS wall's rendered subtree. */
  hostedByThisWall: boolean
}

/** The pointer ray as seen from one hidden wall's collision-mesh hit. */
export type WallSelectionRay = {
  /** Distance of this wall's own collision-mesh hit. */
  wallHitDistance: number
  /** Every other interactive hit on the same ray (self excluded). */
  otherHits: ReadonlyArray<WallRayHit>
}

/**
 * Does any other hit on the ray outrank this hidden wall for hover /
 * selection? True → the wall yields the event (pointer-transparent).
 */
export const hiddenWallOutrankedOnRay = (
  ray: WallSelectionRay,
  epsilon: number = HIDDEN_WALL_SELECTION_EPSILON,
): boolean => {
  // Other walls' hits never compete directly (two hidden walls must not
  // BOTH yield and drop the event through to the room behind — the nearest
  // one wins by delivery order). They only anchor the wall-mounted test.
  const wallAnchors: number[] = []
  for (const hit of ray.otherHits) {
    if (hit.isWallCollision) wallAnchors.push(hit.distance)
  }

  return ray.otherHits.some((hit) => {
    if (hit.isWallCollision) return false
    // The wall's own hosted children (doors, windows, wall-mounted items)
    // always win, at any incidence angle.
    if (hit.hostedByThisWall) return true
    // Nearer, or at ~the wall face: devices flush/proud/recessed, items in
    // front of the wall.
    if (hit.distance <= ray.wallHitDistance + epsilon) return true
    // Wall-mounted gear further down the ray (a receptacle on a wall behind
    // this one): visible through the framing, deliberately small targets —
    // an interposed hidden wall must not swallow them (D4).
    return wallAnchors.some((anchor) => Math.abs(hit.distance - anchor) <= epsilon)
  })
}

/** Minimal structural shapes so extraction is testable without three.js. */
export type WallRayObjectLike = {
  name?: string
  parent?: WallRayObjectLike | null
}
export type WallRayIntersectionLike = {
  distance: number
  object: WallRayObjectLike
}

const isInSubtree = (object: WallRayObjectLike, root: object | null): boolean => {
  if (!root) return false
  let current: WallRayObjectLike | null | undefined = object
  while (current) {
    if (current === root) return true
    current = current.parent
  }
  return false
}

/**
 * Reduce a live R3F pointer event (Intersection & { intersections }) to the
 * `WallSelectionRay` the yield rule consumes. `wallRoot` is the wall's
 * registered outer mesh — its subtree hosts the collision mesh, treatments,
 * and the hosted door / window / item renderers. Returns undefined when the
 * event carries no usable ray data (synthetic replays); the caller then
 * falls back to full transparency, #683's original behavior.
 */
export const extractWallSelectionRay = (
  event: unknown,
  wallRoot: object | null,
): WallSelectionRay | undefined => {
  const e = event as {
    distance?: unknown
    object?: WallRayObjectLike
    intersections?: unknown
  }
  if (typeof e?.distance !== 'number' || !e.object || !Array.isArray(e.intersections)) {
    return undefined
  }
  const self = e.object
  const otherHits: WallRayHit[] = []
  for (const hit of e.intersections as WallRayIntersectionLike[]) {
    if (!hit || typeof hit.distance !== 'number' || !hit.object) continue
    if (hit.object === self) continue
    otherHits.push({
      distance: hit.distance,
      isWallCollision: hit.object.name === WALL_COLLISION_MESH_NAME,
      // Self is excluded above, so subtree membership here means a HOSTED
      // child (door / window / wall-mounted item), not the pick mesh.
      hostedByThisWall: isInSubtree(hit.object, wallRoot),
    })
  }
  return { wallHitDistance: e.distance, otherHits }
}

export const wallPointerEventsSuppressed = ({
  wallHidden,
  hoverHighlightMode,
  hiddenWallHoldActive,
  selectionRay,
}: {
  wallHidden: boolean
  hoverHighlightMode: string | null | undefined
  hiddenWallHoldActive: boolean
  /**
   * The pointer ray context for hover/selection events. Omitted or
   * undefined → the hidden wall stays fully transparent (#683 fallback for
   * events without intersection data).
   */
  selectionRay?: WallSelectionRay
}): boolean => {
  if (!wallHidden) return false
  if (hoverHighlightMode === 'delete') return false
  if (hiddenWallHoldActive) return false
  if (!selectionRay) return true
  return hiddenWallOutrankedOnRay(selectionRay)
}
