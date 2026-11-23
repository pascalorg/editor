import {
  area,
  difference,
  intersection,
  type MultiPolygon,
  type Ring,
  union,
} from '../lib/polygon-boolean'
import type { GeometryArtifactManifest } from '../schema'
import { distanceToSegment, type Vec2 } from './plan-geometry'

/**
 * The real shape of an item, for the plan checks that read wall panelling: the solids its script says
 * it is made of, each a plan polygon between two heights, instead of the one box round its bounds.
 * Other items stay their box, since the faces of a script leave out its rails, backs and foliage. A script reports its
 * upward faces (`surfaces`, a height and an outline) and its downward faces (`undersides`); every
 * upward face is the top of a solid that goes down to the highest downward face below it that
 * overlaps it in plan, else to the bottom of the bounds, and a thing with only downward faces (a
 * pendant's shade) hangs from the face to the top of its bounds. Legs without a face of their own
 * are not modelled, which only ever leaves out matter, and a script with no faces has no solids.
 */

export type ItemSolid = { polygons: MultiPolygon; y0: number; y1: number }

/** A manifest point, mapped to the level's frame. */
export type ToLevel = (point: [number, number, number]) => [number, number, number]

/** A polygon thinner than this, on average (twice its area over its perimeter), is a sliver, not matter (m). */
const MIN_MEAN_THICKNESS = 0.003
/** A solid shorter than this is a face, not matter (m). */
const MIN_HEIGHT = 1e-6

const close = (ring: Ring): Ring => (ring.length >= 3 ? ring : [])

function ringArea(ring: Ring): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i]!
    const [x1, z1] = ring[(i + 1) % ring.length]!
    sum += x0 * z1 - x1 * z0
  }
  return Math.abs(sum) / 2
}

function ringPerimeter(ring: Ring): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i]!
    const [x1, z1] = ring[(i + 1) % ring.length]!
    sum += Math.hypot(x1 - x0, z1 - z0)
  }
  return sum
}

/** Whether a polygon is thick enough, on average, to be a solid and not a sliver of a boolean. */
function solidEnough(polygon: MultiPolygon[number]): boolean {
  const matter = ringArea(polygon.outer) - polygon.holes.reduce((t, ring) => t + ringArea(ring), 0)
  const perimeter =
    ringPerimeter(polygon.outer) + polygon.holes.reduce((t, r) => t + ringPerimeter(r), 0)
  return perimeter > 0 && (2 * matter) / perimeter >= MIN_MEAN_THICKNESS
}

/** The solids a manifest's faces describe, in the level's frame, or null when it reports none. */
export function manifestSolids(
  manifest: Pick<GeometryArtifactManifest, 'bounds' | 'surfaces' | 'undersides'>,
  toLevel: ToLevel,
): ItemSolid[] | null {
  const ups = manifest.surfaces
    .filter((face) => face.polygon.length >= 3)
    .map((face) => ({ y: face.y, ring: face.polygon as Ring }))
  // A downward face carries its plane [0, -1, 0, d]: -y + d = 0, so its height is d. A sloped one is not read.
  const downs = manifest.undersides
    .filter((face) => face.polygon.length >= 3 && Math.abs(face.plane[1] + 1) < 1e-6)
    .map((face) => ({ y: face.plane[3], ring: face.polygon as Ring }))
  if (!(ups.length || downs.length)) return null
  const bottom = manifest.bounds.min[1]
  const raw: { polygons: MultiPolygon; y0: number; y1: number }[] = []
  const solid = (polygons: MultiPolygon, y0: number, y1: number) => {
    const kept = polygons.filter(solidEnough)
    if (kept.length && y1 - y0 > MIN_HEIGHT) raw.push({ polygons: kept, y0, y1 })
  }
  if (!ups.length) {
    for (const down of downs) solid(union([close(down.ring)]), down.y, manifest.bounds.max[1])
  }
  const byHeight = new Map<number, Ring[]>()
  for (const up of ups) {
    const key = Math.round(up.y * 1e4) / 1e4
    byHeight.set(key, [...(byHeight.get(key) ?? []), up.ring])
  }
  for (const [top, rings] of byHeight) {
    let remaining = union(rings.map(close).filter((ring) => ring.length))
    const below = downs.filter((down) => down.y < top - 1e-6).sort((p, q) => q.y - p.y)
    for (const down of below) {
      if (!remaining.length) break
      const piece = intersection(remaining, close(down.ring))
      if (area(piece) > 1e-8) {
        solid(piece, down.y, top)
        remaining = difference(remaining, close(down.ring))
      }
    }
    solid(remaining, bottom, top)
  }
  if (!raw.length) return null
  const lift = (y: number) => toLevel([0, y, 0])[1]
  return raw.map(({ polygons, y0, y1 }) => ({
    polygons: polygons.map(({ outer, holes }) => ({
      outer: outer.map(([x, z]) => planOf(toLevel([x, 0, z]))),
      holes: holes.map((hole) => hole.map(([x, z]) => planOf(toLevel([x, 0, z])))),
    })),
    y0: lift(y0),
    y1: lift(y1),
  }))
}

const planOf = (point: [number, number, number]): [number, number] => [point[0], point[2]]

/** The least distance between two plan regions' outlines, 0 where they touch or cross. */
function outlineDistance(a: MultiPolygon, b: MultiPolygon): number {
  const rings = (region: MultiPolygon) => region.flatMap(({ outer, holes }) => [outer, ...holes])
  let least = Number.POSITIVE_INFINITY
  const against = (from: Ring[], to: Ring[]) => {
    for (const ring of from)
      for (const point of ring)
        for (const other of to)
          for (let i = 0; i < other.length; i++)
            least = Math.min(
              least,
              distanceToSegment(
                point as Vec2,
                other[i] as Vec2,
                other[(i + 1) % other.length] as Vec2,
              ),
            )
  }
  against(rings(a), rings(b))
  against(rings(b), rings(a))
  return least
}

export type SolidsRelation = {
  /** How deep the two reach into each other where they share height and plan, 0 when they do not. */
  overlapArea: number
  /** The least plan distance between solids that share height; infinity when none do. */
  gap: number
}

/**
 * How two items' solids stand to each other. Two solids share height when they reach into each
 * other by more than `stack` (a thing resting on another sinks a little into it): one that only
 * rests on the other, or lies clear above or below it, is neither overlapping nor close. Plan
 * overlap counts from `minArea` (square metres), which leaves a touching edge or a boolean's
 * sliver out.
 */
export function relateSolids(
  a: readonly ItemSolid[],
  b: readonly ItemSolid[],
  options: { stack: number; minArea: number },
): SolidsRelation {
  let overlapArea = 0
  let gap = Number.POSITIVE_INFINITY
  for (const sa of a) {
    for (const sb of b) {
      if (Math.min(sa.y1, sb.y1) - Math.max(sa.y0, sb.y0) <= options.stack + 1e-9) continue
      const shared = intersection(sa.polygons, sb.polygons)
      const sharedArea = area(shared)
      const enough = shared.some(solidEnough) && sharedArea >= options.minArea
      if (enough) {
        overlapArea += sharedArea
        gap = 0
      } else {
        gap = Math.min(gap, outlineDistance(sa.polygons, sb.polygons))
      }
    }
  }
  return { overlapArea, gap }
}
