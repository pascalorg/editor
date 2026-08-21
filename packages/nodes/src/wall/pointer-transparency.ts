/**
 * Should a wall's pointer handlers swallow (early-return) this event?
 *
 * Hidden walls ('down' wall mode, cutaway-hidden faces, auto-mode interior
 * partitions) keep invisible full-height collision meshes that raycast for
 * every pointer event. #683 made them blanket pointer-TRANSPARENT so clicks
 * reached the visible objects behind them (wall-mounted plugin device /
 * service boxes, items). That over-corrected hover + selection: with the
 * Bones X-ray on (walls hidden, framing rendering where the walls are),
 * mousing over a wall highlighted and selected the furniture BEHIND it,
 * because nothing at the wall's depth was allowed to win.
 *
 * The rule is NEAREST-FIRST over hits that OWN SELECTION SEMANTICS. The
 * live event raycast recurses through the level/building wrapper groups
 * (they carry pointer handlers), so `event.intersections` also contains
 * passive geometry — Bones framing InstancedMeshes sit exactly at the
 * wall's own depth (QA f2 probe6/probe7), and the wall's own render mesh
 * rides the same list. Rank by distance alone and the hidden wall yields
 * everywhere its overlay (or its own body) renders — i.e. always. So every
 * hit is first classified by its nearest REGISTERED node ancestor
 * (`selection-hit-owner.ts`):
 *
 * - 'self-wall' hits (own render/collision/treatment meshes) are neutral;
 * - 'other-wall' hits never compete directly (two hidden walls must not
 *   both yield and drop the event into the room behind — delivery order
 *   gives the nearest one the event) but ANCHOR the wall-mounted test;
 * - 'passive' hits (framing members, gizmos, the grid — no selectable-node
 *   ancestry, or a level/building wrapper as their nearest handler owner)
 *   never outrank the wall;
 * - 'selectable' hits (furniture, devices, openings, slabs …) outrank the
 *   hidden wall when any of these hold:
 *     1. HOSTED by this wall (its own doors / windows / wall-mounted
 *        children — subtree membership, so grazing angles can't inflate
 *        the depth gap past any epsilon);
 *     2. at ~equal-or-nearer depth (`HIDDEN_WALL_SELECTION_EPSILON`
 *        tie-break: device boxes flush with / proud of / recessed into the
 *        face, items standing in front of the wall);
 *     3. WALL-MOUNTED further down the ray — within epsilon of some other
 *        wall's hit (the #683 / night-5 D4 class: a visible receptacle on
 *        a wall two meters BEHIND an interposed hidden wall still wins —
 *        the interposed wall falls through, like the #694 MOVE gate).
 *
 * Free-standing selectables clearly behind the wall (a sofa mid-room) no
 * longer outrank it: the wall in front highlights, which is what the ray
 * visually strikes when the Bones framing renders there. Trade-off
 * (deliberate, host-side only — no plugin presence flag): in a plain manual
 * 'down' mode with NO overlay rendering at the wall, that wall strip is
 * hover/selectable even though it draws nothing.
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

import type { WallRayHitOwnership } from './selection-hit-owner'

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

/** One raycast hit, reduced to what the yield rule needs. */
export type WallRayHit = {
  /** Distance along the ray, in meters (three.js Intersection.distance). */
  distance: number
  /** Who owns the hit — see `selection-hit-owner.ts`. */
  ownership: WallRayHitOwnership
  /** True when a 'selectable' hit lives inside THIS wall's rendered subtree. */
  hostedByThisWall: boolean
}

/** The pointer ray as seen from one hidden wall's collision-mesh hit. */
export type WallSelectionRay = {
  /** Distance of this wall's own collision-mesh hit. */
  wallHitDistance: number
  /** Every other hit on the same ray (the delivered hit itself excluded). */
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
  const wallAnchors: number[] = []
  for (const hit of ray.otherHits) {
    if (hit.ownership === 'other-wall') wallAnchors.push(hit.distance)
  }

  return ray.otherHits.some((hit) => {
    if (hit.ownership !== 'selectable') return false
    if (hit.hostedByThisWall) return true
    if (hit.distance <= ray.wallHitDistance + epsilon) return true
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
 * and the hosted door / window / item renderers. `classify` resolves each
 * hit's owner (`createWallRayHitClassifier(node.id)` in the renderer).
 * Returns undefined when the event carries no usable ray data (synthetic
 * replays); the caller then falls back to full transparency, #683's
 * original behavior.
 */
export const extractWallSelectionRay = (
  event: unknown,
  wallRoot: object | null,
  classify: (object: WallRayObjectLike) => WallRayHitOwnership,
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
    const ownership = classify(hit.object)
    otherHits.push({
      distance: hit.distance,
      ownership,
      hostedByThisWall: ownership === 'selectable' && isInSubtree(hit.object, wallRoot),
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
