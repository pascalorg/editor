/**
 * The building PAD — "built up dirt to level it out" (Steve, 2026-09-07).
 *
 * A slab house stands 8 in above the HIGH side of the ground under it; the
 * low side is FILLED up to the same level so the slab bears on grade all
 * round instead of hanging over air. The fill is written into the site's
 * heightfield: every sample under the footprint rises to the pad level
 * (never cut — fill only), and an apron around it blends back to the
 * existing ground at a gentle slope. A raised house is not graded: its
 * stem walls step down the hill (Bones steps the footings).
 *
 * Pure: (field, pad polygon in site metres, pad height in site metres,
 * apron width) → a new field. The caller commits it to the site node.
 */
import { quantize, type TerrainField } from '@pascal-app/core'

export type Pt = readonly [number, number]

export type GradingPlan = {
  /** The footprint the pad fills, site metres. */
  polygon: readonly Pt[]
  /** The pad's finished ground level, site metres (the slab top − 8 in). */
  padY: number
  /** How far outside the footprint the fill blends back to grade. */
  apronM: number
  /** Why — printed on the notes. */
  note: string
}

/** Signed distance from a point to a polygon's boundary (negative inside). */
function distanceToPolygon(polygon: readonly Pt[], x: number, z: number): number {
  let inside = false
  let best = Number.POSITIVE_INFINITY
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i] as Pt
    const b = polygon[j] as Pt
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) inside = !inside
    const abx = b[0] - a[0]
    const abz = b[1] - a[1]
    const l2 = abx * abx + abz * abz
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / l2))
    const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t))
    if (d < best) best = d
  }
  return inside ? -best : best
}

/**
 * Fill the pad into the field. Inside the footprint every sample rises to
 * `padY` (a sample already higher stays — fill only); in the apron the
 * target falls linearly from `padY` at the footprint edge to the existing
 * ground at `apronM` out. Returns the SAME field when nothing needed fill.
 */
export function fillPad(field: TerrainField, plan: GradingPlan): { field: TerrainField; filledSamples: number; maxFillM: number } {
  const { polygon, padY, apronM } = plan
  if (polygon.length < 3) return { field, filledSamples: 0, maxFillM: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const p of polygon) {
    minX = Math.min(minX, p[0])
    maxX = Math.max(maxX, p[0])
    minZ = Math.min(minZ, p[1])
    maxZ = Math.max(maxZ, p[1])
  }
  const col0 = Math.max(0, Math.floor((minX - apronM - field.origin[0]) / field.spacing))
  const col1 = Math.min(field.cols - 1, Math.ceil((maxX + apronM - field.origin[0]) / field.spacing))
  const row0 = Math.max(0, Math.floor((minZ - apronM - field.origin[1]) / field.spacing))
  const row1 = Math.min(field.rows - 1, Math.ceil((maxZ + apronM - field.origin[1]) / field.spacing))
  if (col1 < col0 || row1 < row0) return { field, filledSamples: 0, maxFillM: 0 }
  const heights = new Int16Array(field.heights)
  let filled = 0
  let maxFill = 0
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      const x = field.origin[0] + col * field.spacing
      const z = field.origin[1] + row * field.spacing
      const d = distanceToPolygon(polygon, x, z)
      if (d > apronM) continue
      const i = row * field.cols + col
      const existing = (heights[i] ?? 0) * field.step
      const blend = d <= 0 ? 1 : 1 - d / apronM
      const target = existing + (padY - existing) * blend
      if (target <= existing + 1e-6) continue
      heights[i] = quantize(field, target)
      filled += 1
      maxFill = Math.max(maxFill, target - existing)
    }
  }
  if (filled === 0) return { field, filledSamples: 0, maxFillM: 0 }
  return { field: { ...field, heights }, filledSamples: filled, maxFillM: maxFill }
}
