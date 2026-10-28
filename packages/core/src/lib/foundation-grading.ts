import type { AnyNode, AnyNodeId, SiteNode } from '../schema'
import { inches } from './building-foundation'
import { foundationGradingPads } from './generic-foundation'
import { quantize, type TerrainField } from './terrain-field'
import { terrainFieldOf } from './terrain-source'

type P = [number, number]

/**
 * How a foundation grades the ground round it:
 *
 * - `pad` (a slab's building pad, the default): the finished grade held along its edge, its top
 *   less the exposure the record asks (8 in by default, IRC R317.1), whatever the ground did
 *   before. Low ground is filled up to it, high ground cut down to it.
 * - `cut` (round a raised floor's stem wall): ground standing over that grade is cut down to it;
 *   lower ground stays as it lies, the floor standing over the slope.
 * - `pit` (a raised floor's crawl space): the ground inside the outline dug down to `y`; nothing
 *   outside it.
 * - `excavation` (a basement): the ground inside the outline, the basement walls' outside faces,
 *   dug out down to `y`, the underside of its slab, and cut plumb along the outline; the ground
 *   outside meets the walls as it lies, neither filled nor cut. The terrain's surface is drawn
 *   open over it (graded into the drawn field, the ground would slope down to the walls across a
 *   whole sample of the field), so the renderer grades without it (`isExcavation`).
 */
export type GradingPad = {
  /** The foundation's edge (a pit's: the stem walls' inside faces), world XZ, closed. */
  outline: P[]
  /** The finished grade along the edge (a pit's and an excavation's floor), world Y. */
  y: number
  kind?: 'pad' | 'cut' | 'pit' | 'excavation'
}

/** A basement's dig, which the ground's surface is drawn open over rather than graded down into. */
export const isExcavation = (pad: GradingPad): boolean => pad.kind === 'excavation'

/**
 * How the finished grade leaves a pad: it falls 6 in within the first 10 ft (IRC R401.3, water
 * drains away from the foundation), then meets the natural ground on a bank no steeper than 2:1,
 * filled where the ground is lower, cut where it is higher.
 */
export const FOUNDATION_GRADING = {
  apron: inches(120),
  fall: inches(6),
  /** Rise per run of the bank back to the natural ground. */
  bank: 0.5,
} as const

/** Distance from `p` to the closed outline: 0 inside it. */
function distanceToOutline(outline: readonly P[], [x, z]: readonly [number, number]): number {
  let inside = false
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, az] = outline[i]!
    const [bx, bz] = outline[j]!
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside
    const dx = bx - ax
    const dz = bz - az
    const length2 = dx * dx + dz * dz
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2)) : 0
    nearest = Math.min(nearest, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
  }
  return inside ? 0 : nearest
}

/**
 * The finished grade at a world point, the natural ground `natural` there graded to the nearest
 * pad: the pad's grade under and along it, falling over the apron, then a bank of fill or cut back
 * to the natural ground (a `cut` pad's bank only cuts). Past the bank the ground is as it was. A
 * crawl space (`pit`) or a basement (`excavation`) the point lies in digs it down further.
 */
export function finishedGradeAt(
  pads: readonly GradingPad[],
  x: number,
  z: number,
  natural: number,
): number {
  let pad: GradingPad | null = null
  let distance = Number.POSITIVE_INFINITY
  let pit = Number.POSITIVE_INFINITY
  for (const candidate of pads) {
    const d = distanceToOutline(candidate.outline, [x, z])
    if (candidate.kind === 'pit' || candidate.kind === 'excavation') {
      if (d === 0) pit = Math.min(pit, candidate.y)
      continue
    }
    if (d < distance) {
      distance = d
      pad = candidate
    }
  }
  return Math.min(pit, pad ? padGradeAt(pad, distance, natural) : natural)
}

/** The grade `distance` off `pad` (a `pad` or a `cut`), over ground lying at `natural`. */
function padGradeAt(pad: GradingPad, distance: number, natural: number): number {
  const { apron, fall, bank } = FOUNDATION_GRADING
  const cutOnly = pad.kind === 'cut'
  if (distance <= apron) {
    const grade = pad.y - (fall * distance) / apron
    return cutOnly ? Math.min(natural, grade) : grade
  }
  const toe = pad.y - fall
  const reach = (distance - apron) * bank
  return Math.min(toe + reach, cutOnly ? natural : Math.max(toe - reach, natural))
}

const graded = new WeakMap<TerrainField, { key: string; field: TerrainField }>()

/**
 * The terrain as the pads grade it (`finishedGradeAt` at every sample they reach), a new field;
 * the field itself where no pad is given. Worked out once per field and set of pads.
 */
export function gradeTerrainField(field: TerrainField, pads: readonly GradingPad[]): TerrainField {
  if (pads.length === 0) return field
  const key = JSON.stringify(pads)
  const hit = graded.get(field)
  if (hit?.key === key) return hit.field
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const value of field.heights) {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  const heights = new Int16Array(field.heights)
  const { apron, fall, bank } = FOUNDATION_GRADING
  for (const pad of pads) {
    // A bank reaches no further than the field's whole relief allows; a dig has none.
    const relief = Math.max(Math.abs(high * field.step - pad.y), Math.abs(low * field.step - pad.y))
    const dig = pad.kind === 'pit' || pad.kind === 'excavation'
    const grow = dig ? field.spacing : apron + (relief + fall) / bank + field.spacing
    const xs = pad.outline.map((p) => p[0])
    const zs = pad.outline.map((p) => p[1])
    const col0 = Math.max(0, Math.floor((Math.min(...xs) - grow - field.origin[0]) / field.spacing))
    const col1 = Math.min(
      field.cols - 1,
      Math.ceil((Math.max(...xs) + grow - field.origin[0]) / field.spacing),
    )
    const row0 = Math.max(0, Math.floor((Math.min(...zs) - grow - field.origin[1]) / field.spacing))
    const row1 = Math.min(
      field.rows - 1,
      Math.ceil((Math.max(...zs) + grow - field.origin[1]) / field.spacing),
    )
    for (let row = row0; row <= row1; row++)
      for (let col = col0; col <= col1; col++) {
        const index = row * field.cols + col
        const x = field.origin[0] + col * field.spacing
        const z = field.origin[1] + row * field.spacing
        const natural = (field.heights[index] ?? 0) * field.step
        heights[index] = quantize(field, finishedGradeAt(pads, x, z, natural))
      }
  }
  const result: TerrainField = { ...field, heights }
  graded.set(field, { key, field: result })
  return result
}

/**
 * The site's ground as built: its terrain (`terrainFieldOf`, a stroke in flight included) graded to
 * the buildings' foundations (`foundationGradingPads`: slab pads, the cut round a raised floor, its
 * crawl space, a basement's dig). What the ground is picked and walked on (the renderer draws it
 * open over a basement instead of dug); the foundation itself is designed against the natural
 * ground. `null` for flat ground.
 */
export function gradedTerrainFieldOf(
  nodes: Record<AnyNodeId, AnyNode>,
  site: (Pick<SiteNode, 'terrain'> & { id?: string }) | null | undefined,
): TerrainField | null {
  const field = terrainFieldOf(site)
  return field ? gradeTerrainField(field, foundationGradingPads(nodes)) : null
}
