/**
 * Pure plan (XZ) footprint math — one source for spatial-grid collision and
 * alignment anchors. The `@pascal-app/core/plan-footprint` subpath is the seam
 * for a follow-up that consolidates MCP layout clearance onto these helpers.
 *
 * ## Invariant
 * Callers share `planFootprintCorners` / `planFootprintAABB`. Do not invent a
 * third rotation-aware plan AABB path beside this module.
 *
 * ## Gap call-site meanings (for the follow-up overlap helper)
 * When an expand-then-intersect overlap check lands here, treat `gap` as
 * **minimum free space** (expand each box by `gap`, then intersect):
 * - Packing / furnish: typically `gap ≈ 0.08` for breathing room between items
 * - check / verify collision: use `gap = 0` for true interpenetration only
 * Do not share one default blindly across both questions.
 *
 * ## Scope
 * Foundation only. Does not move door keep-outs, level ancestry, or furnish
 * search into core. Item-scaled / attach-aware wrappers stay with callers
 * until the MCP consolidation follow-up.
 */

export type PlanAabb = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type PlanVec2 = [number, number]

/**
 * Four XZ corners of a centred footprint at `position`, rotated by Y
 * rotation. Matches spatial-grid `getItemFootprint` convention:
 * local +X maps with (cos, sin), local +Z with (-sin, cos) terms as used
 * in the existing corner formula.
 */
export function planFootprintCorners(
  position: readonly [number, number, number],
  dimensions: readonly [number, number, number],
  rotationY: number,
  inset = 0,
): PlanVec2[] {
  const [x, , z] = position
  const [w, , d] = dimensions
  const halfW = Math.max(0, w / 2 - inset)
  const halfD = Math.max(0, d / 2 - inset)
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)

  return [
    [x + (-halfW * cos + halfD * sin), z + (-halfW * sin - halfD * cos)],
    [x + (halfW * cos + halfD * sin), z + (halfW * sin - halfD * cos)],
    [x + (halfW * cos - halfD * sin), z + (halfW * sin + halfD * cos)],
    [x + (-halfW * cos - halfD * sin), z + (-halfW * sin + halfD * cos)],
  ]
}

/**
 * Axis-aligned XZ extent of a footprint. Equivalent to the AABB of
 * `planFootprintCorners` (no inset) and to spatial-grid `footprintBoundsXZ`.
 */
export function planFootprintAABB(
  position: readonly [number, number, number],
  dimensions: readonly [number, number, number],
  rotationY: number,
): PlanAabb {
  const [width, , depth] = dimensions
  const cos = Math.abs(Math.cos(rotationY))
  const sin = Math.abs(Math.sin(rotationY))
  const rotatedW = width * cos + depth * sin
  const rotatedD = width * sin + depth * cos
  return {
    minX: position[0] - rotatedW / 2,
    maxX: position[0] + rotatedW / 2,
    minZ: position[2] - rotatedD / 2,
    maxZ: position[2] + rotatedD / 2,
  }
}
