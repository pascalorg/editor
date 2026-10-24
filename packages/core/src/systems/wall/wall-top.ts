import type { WallNode } from '../../schema/nodes/wall'

/**
 * Minimum wall body height in meters. Governs both the wall height
 * arrow's lower drag bound and the slab-elevation clamp: a slab may not
 * rise past `storeyHeight - MIN_WALL_HEIGHT` while a plane-bound wall
 * elects it as its base, or the wall's extrusion (plane minus base)
 * would collapse below this minimum.
 */
export const MIN_WALL_HEIGHT = 0.5

export function wallFollowsStorey(
  wall: Pick<WallNode, 'height' | 'supportSlabId'>,
  authoredStoreyHeight: number | null,
): boolean {
  return (
    wall.height == null ||
    (authoredStoreyHeight !== null &&
      wall.supportSlabId !== 'ground' &&
      Math.abs(wall.height - authoredStoreyHeight) <= 1e-6)
  )
}

/**
 * Wall-top inversion (vertical building model): a wall with no stored
 * `height` is plane-bound — its top sits at the storey plane (level-local
 * Y = the level's stored height), so a slab lifting the wall's base makes
 * the wall shorter, never taller, and no gap can open at the top of a
 * level. An explicit height equal to the authored storey height expresses the
 * same storey-top intent, even when the resolved plane is clamped or lifted.
 * Other explicit walls stand on their elected support; ground-hosted walls
 * always retain their authored body height.
 *
 * Returns the top in level-local Y (same frame as `electedBase`).
 */
export function resolveWallTop(
  wall: Pick<WallNode, 'height' | 'supportSlabId'>,
  storeyHeight: number,
  electedBase: number,
  authoredStoreyHeight: number | null = storeyHeight,
): number {
  if (wallFollowsStorey(wall, authoredStoreyHeight)) return storeyHeight
  return electedBase + wall.height!
}

/**
 * Extruded height of the wall body: {@link resolveWallTop} minus the
 * elected base. Base convention: the elected slab-support elevation itself
 * — the viewer computes `effectiveBaseElevation = min(baseElevation,
 * slabElevation)` and defaults `baseElevation` to the elected elevation,
 * so with only the election in hand the two coincide. Fill-down below the
 * elected base (`baseSegments`) is a geometry detail the extruder handles
 * separately and never changes where the top sits.
 *
 * Equivalently: the wall-local Y of the wall's top, measured from the wall
 * mesh origin (which sits at `electedBase`). May be non-positive when a
 * slab reaches the storey plane; callers own the degenerate-geometry
 * policy.
 */
export function resolveWallEffectiveHeight(
  wall: Pick<WallNode, 'height' | 'supportSlabId'>,
  storeyHeight: number,
  electedBase: number,
  authoredStoreyHeight: number | null = storeyHeight,
): number {
  return resolveWallTop(wall, storeyHeight, electedBase, authoredStoreyHeight) - electedBase
}
