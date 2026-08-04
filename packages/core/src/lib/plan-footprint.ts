/**
 * Pure plan (XZ) footprint math — one source for MCP layout clearance,
 * spatial-grid collision, and alignment anchors.
 *
 * ## Why this exists (post #569 / Aymericr)
 * MCP layout clearance and core spatial-grid each need rotation-aware plan
 * boxes. Duplicating the formula risks a rotation-sign drift. Callers share
 * these helpers; do not invent a third AABB path.
 *
 * ## Gap call-site meanings
 * - `aabbsOverlapPlan(a, b, gap)` treats `gap` as **minimum free space**
 *   (expand-then-intersect). Positive gap means boxes that close to within
 *   `gap` meters still count as overlapping.
 * - **Packing / furnish:** typically `gap ≈ 0.08` for breathing room.
 * - **check / verify collision:** use `gap = 0` for true interpenetration only.
 *
 * ## Scope
 * Foundation only after MCP layout clearance (#569). Does not move door
 * keep-outs, level ancestry, or furnish search into core.
 *
 * ## Non-floor hosts
 * `planFootprintAABBForItem` returns null for wall / wall-side / ceiling
 * attach targets so wall-local coords are never treated as world XZ.
 */

import type { ItemNode } from '../schema'
import { getScaledDimensions } from '../schema'

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

/**
 * True when A and B come closer than `gap` meters (including penetration).
 * `gap` is minimum free space: expand each box by `gap` effectively via
 * `a.maxX + gap > b.minX && a.minX - gap < b.maxX` (same for Z).
 */
export function aabbsOverlapPlan(a: PlanAabb, b: PlanAabb, gap = 0): boolean {
  return (
    a.maxX + gap > b.minX &&
    a.minX - gap < b.maxX &&
    a.maxZ + gap > b.minZ &&
    a.minZ - gap < b.maxZ
  )
}

/**
 * Plan AABB for a scene item using **scaled** dimensions.
 * Returns null for wall / wall-side / ceiling hosted items (local frame,
 * not world-XZ floor packing).
 */
export function planFootprintAABBForItem(item: ItemNode): PlanAabb | null {
  const attach = item.asset?.attachTo
  if (attach === 'wall' || attach === 'wall-side' || attach === 'ceiling') {
    return null
  }
  const dimensions = getScaledDimensions(item)
  const rotationY = Array.isArray(item.rotation) ? (item.rotation[1] ?? 0) : 0
  const position = (item.position ?? [0, 0, 0]) as [number, number, number]
  return planFootprintAABB(position, dimensions, rotationY)
}

/** Corners AABB — same bounds as `planFootprintAABB` (sanity / exact match). */
export function planFootprintAABBFromCorners(
  position: readonly [number, number, number],
  dimensions: readonly [number, number, number],
  rotationY: number,
  inset = 0,
): PlanAabb {
  const corners = planFootprintCorners(position, dimensions, rotationY, inset)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [cx, cz] of corners) {
    if (cx < minX) minX = cx
    if (cx > maxX) maxX = cx
    if (cz < minZ) minZ = cz
    if (cz > maxZ) maxZ = cz
  }
  return { minX, maxX, minZ, maxZ }
}
