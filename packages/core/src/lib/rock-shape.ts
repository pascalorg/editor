import type { RockShapeInput } from './rock-form'
import { rockSectionsV2 } from './rock-form-v2'
import type { RockSpan } from './rock-ground'

export { outlineProblem } from './rock-outline'

type Point = [number, number]

/** Rings stacked from the foot (0) to the top (`ROCK_RINGS`). */
export const ROCK_RINGS = 10
/** Angular samples beside the outline's own corners, so a round outline is not a polygon of its corners. */
const UNIFORM_ANGLES = 32
/** The top ring's size against the foot's. */
const TOP_SCALE = 0.3
/** How far a point may fall inside the outline, as a share of its radius: a rock never spreads past it. */
const MAX_INSET = 0.22
/** Consecutive angular samples that share one facet. */
const FACET_SPAN = 2

function mean(points: readonly Point[]): Point {
  const sum = points.reduce<Point>((total, [x, z]) => [total[0] + x, total[1] + z], [0, 0])
  return [sum[0] / points.length, sum[1] / points.length]
}

/** The area centroid, or the mean of the corners for an outline with no area. */
export function rockCentre(outline: readonly Point[]): Point {
  let area = 0
  let cx = 0
  let cz = 0
  outline.forEach(([x, z], i) => {
    const [nx, nz] = outline[(i + 1) % outline.length] ?? [x, z]
    const cross = x * nz - nx * z
    area += cross
    cx += (x + nx) * cross
    cz += (z + nz) * cross
  })
  if (Math.abs(area) < 1e-9) return mean(outline)
  return [cx / (3 * area), cz / (3 * area)]
}

/** The farthest the outline reaches from `centre` along `angle`; null where the ray misses it. */
function reachAlong(outline: readonly Point[], centre: Point, angle: number): number | null {
  const [dx, dz] = [Math.cos(angle), Math.sin(angle)]
  let farthest: number | null = null
  outline.forEach(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length] ?? [ax, az]
    const [ex, ez] = [bx - ax, bz - az]
    const denominator = dx * ez - dz * ex
    if (Math.abs(denominator) < 1e-12) return
    const along = ((ax - centre[0]) * ez - (az - centre[1]) * ex) / denominator
    const across = ((ax - centre[0]) * dz - (az - centre[1]) * dx) / denominator
    if (along > 1e-9 && across >= -1e-9 && across <= 1 + 1e-9)
      farthest = Math.max(farthest ?? 0, along)
  })
  return farthest
}

function sampleAngles(outline: readonly Point[], centre: Point): number[] {
  const own = outline.map(([x, z]) => Math.atan2(z - centre[1], x - centre[0]))
  const even = Array.from(
    { length: UNIFORM_ANGLES },
    (_, i) => (i / UNIFORM_ANGLES) * 2 * Math.PI - Math.PI,
  )
  const sorted = [...own, ...even].sort((a, b) => a - b)
  return sorted.filter((angle, i) => i === 0 || angle - (sorted[i - 1] ?? 0) > 1e-9)
}

/** A repeatable number in [0, 1) for a seed and two integers. */
function noise(seed: number, a: number, b: number): number {
  let h =
    (Math.imul(seed | 0, 0x27d4eb2d) ^
      Math.imul(a | 0, 0x165667b1) ^
      Math.imul(b | 0, 0x9e3779b1)) >>>
    0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000
}

/** How far inside the outline a sample falls on a ring: one value a facet, or blended across facets. */
function inset(shape: RockShapeInput, sample: number, count: number, ring: number): number {
  if (ring === 0) return 0
  const group = sample / FACET_SPAN
  const here = Math.floor(group)
  const groups = Math.ceil(count / FACET_SPAN)
  const value = (g: number) => noise(shape.seed, ((g % groups) + groups) % groups, ring)
  const blend = shape.form === 'weathered' ? group - here : 0
  const facet = value(here) * (1 - blend) + value(here + 1) * blend
  return MAX_INSET * facet * Math.sqrt(ring / ROCK_RINGS)
}

function scaleAt(fraction: number): number {
  return 1 - (1 - TOP_SCALE) * fraction ** 1.35
}

/**
 * The rock's rings from its foot (the outline, exactly) to its top, as plan points in the outline's
 * frame. Each ring has the same samples, so consecutive rings join into a mesh.
 */
export function rockRings(shape: RockShapeInput): Point[][] {
  const centre = rockCentre(shape.polygon)
  const angles = sampleAngles(shape.polygon, centre)
  const reach = angles.map((angle) => reachAlong(shape.polygon, centre, angle) ?? 0)
  return Array.from({ length: ROCK_RINGS + 1 }, (_, ring) => {
    const scale = scaleAt(ring / ROCK_RINGS)
    return angles.map((angle, sample): Point => {
      const radius = (reach[sample] ?? 0) * scale * (1 - inset(shape, sample, angles.length, ring))
      return [centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]
    })
  })
}

const lerpPoint = ([ax, az]: Point, [bx, bz]: Point, t: number): Point => [
  ax + (bx - ax) * t,
  az + (bz - az) * t,
]

/**
 * The rock's cross-section at `fraction` of its height (0 the foot, 1 the top); null off its span.
 * Between rings it is the slice of the mesh itself, which joins two rings with quads cut into the
 * triangles (a, c, b) and (b, c, d): the slice runs along each vertical edge and across the
 * diagonal b–c, so every sample contributes two points. A quad is not planar, and a slice that
 * skipped the diagonal would miss the mesh by millimetres.
 */
export function rockSection(shape: RockShapeInput, fraction: number): Point[] | null {
  if (shape.gen === 2) return rockSectionsV2(shape, fraction)[0] ?? null
  if (!(fraction >= 0 && fraction <= 1)) return null
  const rings = rockRings(shape)
  const position = fraction * ROCK_RINGS
  const lower = Math.min(Math.floor(position), ROCK_RINGS - 1)
  const blend = position - lower
  const [below, above] = [rings[lower], rings[lower + 1]]
  if (!(below && above)) return null
  if (blend === 0) return below
  if (blend === 1) return above
  return below.flatMap((a, i): Point[] => {
    const b = below[(i + 1) % below.length] ?? a
    const c = above[i] ?? a
    return [lerpPoint(a, c, blend), lerpPoint(b, c, blend)]
  })
}

/** All masses at a height; use this for cuts of arbitrary, possibly concave footprints. */
export function rockSections(shape: RockShapeInput, fraction: number, span?: RockSpan): Point[][] {
  if (shape.gen === 2) return rockSectionsV2(shape, fraction, span)
  const section = rockSection(shape, fraction)
  return section ? [section] : []
}
