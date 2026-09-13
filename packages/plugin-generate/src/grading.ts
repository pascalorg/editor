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

export type Pad = {
  /** What it is under — 'house' / 'garage'. */
  name: string
  /** The footprint the pad fills, site metres. */
  polygon: readonly Pt[]
  /** The pad's finished ground level, site metres (the house slab top − 8 in; the garage slab top − 1 in). */
  padY: number
}

export type GradingPlan = {
  /**
   * The pads, each at its own level: the house slab's, and the garage's
   * beside it (a garage slab sits at the driveway, a step or more below the
   * house floor — Steve, 2026-09-07: "the garage … should drop down to
   * about 1 in above front grade of the door side").
   */
  pads: readonly Pad[]
  /** How far outside the footprints the fill blends back to grade. */
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
 * Fill the pads into the field. Inside a footprint every sample rises to
 * that pad's `padY` (a sample already higher stays — fill only); outside,
 * the target falls linearly from each pad's level at its edge to the
 * existing ground at `apronM` out, the highest apron winning. A sample
 * inside one pad never takes another pad's apron (the garage floor stays
 * at the garage's level beside the taller house pad). Returns the SAME
 * field when nothing needed fill.
 */
export function fillPad(field: TerrainField, plan: GradingPlan): { field: TerrainField; filledSamples: number; maxFillM: number } {
  const { apronM } = plan
  const pads = plan.pads.filter((p) => p.polygon.length >= 3)
  if (pads.length === 0) return { field, filledSamples: 0, maxFillM: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const pad of pads) {
    for (const p of pad.polygon) {
      minX = Math.min(minX, p[0])
      maxX = Math.max(maxX, p[0])
      minZ = Math.min(minZ, p[1])
      maxZ = Math.max(maxZ, p[1])
    }
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
      const i = row * field.cols + col
      const existing = (heights[i] ?? 0) * field.step
      let target = Number.NEGATIVE_INFINITY
      let insideOne = false
      for (const pad of pads) {
        const d = distanceToPolygon(pad.polygon, x, z)
        if (d <= 0) {
          // inside this pad: its own level, and no other pad's apron
          target = insideOne ? Math.max(target, pad.padY) : pad.padY
          insideOne = true
          continue
        }
        if (insideOne || d > apronM) continue
        target = Math.max(target, existing + (pad.padY - existing) * (1 - d / apronM))
      }
      if (target === Number.NEGATIVE_INFINITY || target <= existing + 1e-6) continue
      heights[i] = quantize(field, target)
      filled += 1
      maxFill = Math.max(maxFill, target - existing)
    }
  }
  if (filled === 0) return { field, filledSamples: 0, maxFillM: 0 }
  return { field: { ...field, heights }, filledSamples: filled, maxFillM: maxFill }
}
