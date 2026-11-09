import {
  area as areaOf,
  containsPoint,
  difference,
  distanceToBoundary,
  intersection,
  type MultiPolygon,
  type Polygon,
  type PolygonInput,
  type Ring,
  union,
} from '../lib/polygon-boolean'
import { polygonInteriorPoint } from '../lib/polygon-label'
import type { WallNode, ZoneNode } from '../schema'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'

/**
 * Do a level's zones tile the floor its walls enclose? Two findings, both measured on the clear floor (the wall bodies are not
 * floor, so a zone drawn on a wall's centre line or on its face is the same):
 *
 * - `zones_overlap`: two rooms of the house that both lie on the same clear floor, by `ZONE_OVERLAP_MIN_M2` or more, at least
 *   `COVERAGE_MIN_WIDTH_M` wide. A pair of rooms that `space_many_rooms` already names (both lie in one enclosed space) is not
 *   reported again.
 * - `floor_unclaimed`: floor inside a space the walls enclose that no zone and no stair claims, by `FLOOR_UNCLAIMED_MIN_M2` or
 *   more, at least `COVERAGE_MIN_WIDTH_M` wide. A space no zone covers past half is `space_no_room`, not repeated here. Any zone
 *   claims the floor it lies on (a room, an alfresco, a void, an analysis area), and a stair claims the floor under it.
 *
 * "At least 15 cm wide" is an opening: what is left when every point within 7.5 cm of the region's edge is taken out and the rest
 * grown back, so a gap under 15 cm, or a hairline along a wall that joins a real gap, does not count. The width said is the short
 * side of the rectangle with the piece's area and perimeter. All three tolerances are said in the message.
 *
 * A boolean that fails reads as an empty region (`polygon-boolean` swallows the error), which here would mean "nothing is claimed";
 * when what should be claimed is not empty and its union is, the level is not measured and says nothing.
 */
export const ZONE_OVERLAP_MIN_M2 = 0.1
export const FLOOR_UNCLAIMED_MIN_M2 = 0.3
export const COVERAGE_MIN_WIDTH_M = 0.15
/** A zone's nearest neighbours are named within this distance, m. */
const NEAR_M = 0.3

type Zone = ZoneNode
type Wall = WallNode
type Place = [number, number]

export type ZonesOverlapIssue = {
  type: 'zones_overlap'
  message: string
  severity: 'warning'
  levelId: string
  zoneIds: string[]
  nodeIds: string[]
  at: Place
  /** m² */
  area: number
  /** m, the short side of the rectangle with the piece's area and perimeter */
  width: number
}

export type FloorUnclaimedIssue = {
  type: 'floor_unclaimed'
  message: string
  severity: 'warning'
  levelId: string
  /** The zones within 30 cm of the unclaimed floor, nearest first. */
  zoneIds: string[]
  wallIds: string[]
  nodeIds: string[]
  at: Place
  /** m² */
  area: number
  /** m, the short side of the rectangle with the piece's area and perimeter */
  width: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

function perimeter(polygon: Polygon): number {
  return [polygon.outer, ...polygon.holes].reduce(
    (sum, ring) =>
      sum +
      ring.reduce((length, point, i) => {
        const next = ring[(i + 1) % ring.length]!
        return length + Math.hypot(next[0] - point[0], next[1] - point[1])
      }, 0),
    0,
  )
}

/** The short side of the rectangle with this area and perimeter: exact for a rectangle, a quarter of the perimeter for a fat shape. */
export function equivalentWidth(areaM2: number, perimeterM: number): number {
  return (perimeterM - Math.sqrt(Math.max(0, perimeterM * perimeterM - 16 * areaM2))) / 4
}

/** A union, or null when it failed: non-empty input whose union is empty. */
function unionOrNull(inputs: readonly PolygonInput[]): MultiPolygon | null {
  const parts = inputs.flatMap((input) =>
    !Array.isArray(input)
      ? [input]
      : Array.isArray(input[0])
        ? [{ outer: input as Ring, holes: [] }]
        : (input as MultiPolygon),
  )
  if (!parts.length) return []
  const joined = union(parts)
  return joined.length ? joined : null
}

/** The rectangles of half-width `r` along each edge of the rings, a little past each end: what is within `r` of the region's edge. */
function edgeBands(rings: readonly Ring[], r: number): Ring[] {
  return rings.flatMap((ring) =>
    ring.flatMap((a, i) => {
      const b = ring[(i + 1) % ring.length]!
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 1e-6) return []
      const ux = ((b[0] - a[0]) / length) * r
      const uz = ((b[1] - a[1]) / length) * r
      return [
        [
          [a[0] - ux - uz, a[1] - uz + ux],
          [b[0] + ux - uz, b[1] + uz + ux],
          [b[0] + ux + uz, b[1] + uz - ux],
          [a[0] - ux + uz, a[1] - uz - ux],
        ] as Ring,
      ]
    }),
  )
}

/**
 * The part of a piece that is wide enough: its edge taken in by `COVERAGE_MIN_WIDTH_M / 2` on every side, then given back where
 * something is left. Nothing if a boolean fails on the way.
 */
function wideEnough(piece: Polygon): MultiPolygon {
  const r = COVERAGE_MIN_WIDTH_M / 2
  const rims = unionOrNull(edgeBands([piece.outer, ...piece.holes], r))
  if (!rims) return []
  const core = difference(piece, rims)
  if (!core.length) return []
  const back = unionOrNull([
    ...core,
    ...edgeBands(
      core.flatMap((p) => [p.outer, ...p.holes]),
      r,
    ),
  ])
  return back ? intersection(back, piece) : []
}

/** The pieces of a region at least `COVERAGE_MIN_WIDTH_M` wide and `minM2` big, each with its area and width. */
function strips(region: MultiPolygon, minM2: number) {
  return region
    .flatMap((piece) => wideEnough(piece))
    .flatMap((piece) => {
      const area = areaOf([piece])
      const width = equivalentWidth(area, perimeter(piece))
      return area >= minM2 && width >= COVERAGE_MIN_WIDTH_M - 1e-6 ? [{ piece, area, width }] : []
    })
}

/**
 * The wall bodies of a level as one region: where there is wall there is no floor. Detected spaces run to the walls' centre lines, so
 * both rules take them out. Null when the walls have footprints and their union failed.
 */
export function wallBodies(walls: readonly Wall[]): MultiPolygon | null {
  const miters = calculateLevelMiters([...walls])
  const rings = walls.flatMap((wall) => {
    const points = getWallPlanFootprint(wall, miters)
    return points.length >= 3 ? [points.map((point) => [point.x, point.y] as [number, number])] : []
  })
  return unionOrNull(rings)
}

const shapeOf = (zone: Pick<Zone, 'polygon' | 'holes'>): Polygon => ({
  outer: zone.polygon as Ring,
  holes: (zone.holes ?? []) as Ring[],
})

const where = (piece: Polygon): Place => {
  const [x, z] = polygonInteriorPoint({ polygon: piece.outer, holes: piece.holes }, true)
  return [round2(x), round2(z)]
}

/** "a strip 0.45 m wide", or for a shape as fat as it is long "a region about 3 m across". */
function shapeWords(area: number, width: number): string {
  return area / width >= 2 * width
    ? `a strip ${round2(width)} m wide`
    : `a region about ${round2(width)} m across`
}

const RULE_TAIL = (minM2: number) =>
  `(not reported under ${minM2} m² or narrower than ${Math.round(COVERAGE_MIN_WIDTH_M * 100)} cm; wall bodies are not floor)`

/** Pairs of rooms that lie on the same clear floor. `skip(a, b)` leaves a pair out (rooms of one space, which space_many_rooms names). */
export function zonesOverlapIssues(input: {
  levelId: string
  levelName: string
  rooms: readonly Zone[]
  bodies: MultiPolygon
  skip?: (a: Zone, b: Zone) => boolean
}): ZonesOverlapIssue[] {
  const { levelId, levelName, rooms, bodies, skip } = input
  const issues: ZonesOverlapIssue[] = []
  if (rooms.length < 2) return issues
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!
      const b = rooms[j]!
      if (skip?.(a, b)) continue
      const shared = intersection(shapeOf(a), shapeOf(b))
      if (!shared.length) continue
      const clear = bodies.length ? difference(shared, bodies) : shared
      for (const strip of strips(clear, ZONE_OVERLAP_MIN_M2)) {
        const at = where(strip.piece)
        issues.push({
          type: 'zones_overlap',
          message: `On ${levelName}, "${a.name || a.id}" and "${b.name || b.id}" overlap on ${round2(strip.area)} m² of floor (${shapeWords(strip.area, strip.width)}) around (${at[0]}, ${at[1]}) ${RULE_TAIL(ZONE_OVERLAP_MIN_M2)}.`,
          severity: 'warning',
          levelId,
          zoneIds: [a.id, b.id],
          nodeIds: [a.id, b.id],
          at,
          area: round2(strip.area),
          width: round2(strip.width),
        })
      }
    }
  }
  return issues
}

/** How far a zone lies from a piece, m: 0 when a vertex or the piece's place is inside it. */
function distanceTo(zone: Zone, samples: readonly Place[]): number {
  const shape = [shapeOf(zone)]
  return Math.min(
    ...samples.map((point) => (containsPoint(shape, point) ? 0 : distanceToBoundary(shape, point))),
  )
}

/** Floor inside the given spaces that no zone and no stair claims and no wall stands on. */
export function floorUnclaimedIssues(input: {
  levelId: string
  levelName: string
  /** The spaces to look in: the ones the walls enclose and the zones cover past half. */
  spaces: readonly { polygon: Ring; holes?: Ring[]; wallIds: string[] }[]
  zones: readonly Zone[]
  stairs: readonly Ring[]
  bodies: MultiPolygon
}): FloorUnclaimedIssue[] {
  const { levelId, levelName, spaces, zones, stairs, bodies } = input
  const placed = zones.filter((zone) => zone.polygon.length >= 3)
  const claimed = unionOrNull([
    ...placed.map((zone) => shapeOf(zone)),
    ...stairs.filter((ring) => ring.length >= 3).map((ring) => ({ outer: ring, holes: [] })),
    ...bodies,
  ])
  if (!claimed) return []
  const issues: FloorUnclaimedIssue[] = []
  for (const space of spaces) {
    const whole: Polygon = { outer: space.polygon, holes: space.holes ?? [] }
    const left = claimed.length ? difference(whole, claimed) : [whole]
    for (const strip of strips(left, FLOOR_UNCLAIMED_MIN_M2)) {
      const at = where(strip.piece)
      const samples: Place[] = [at, ...strip.piece.outer]
      const near = placed
        .map((zone) => ({ zone, distance: distanceTo(zone, samples) }))
        .filter((x) => x.distance <= NEAR_M)
        .sort((x, y) => x.distance - y.distance)
        .map((x) => x.zone)
      const zoneIds = near.map((zone) => zone.id)
      issues.push({
        type: 'floor_unclaimed',
        message: `On ${levelName}, ${round2(strip.area)} m² of floor inside the walls (${shapeWords(strip.area, strip.width)}) around (${at[0]}, ${at[1]}) is claimed by no zone or stair${
          near.length
            ? `; nearest ${near
                .slice(0, 3)
                .map((zone) => `"${zone.name || zone.id}"`)
                .join(', ')}`
            : ''
        } ${RULE_TAIL(FLOOR_UNCLAIMED_MIN_M2)}.`,
        severity: 'warning',
        levelId,
        zoneIds,
        wallIds: space.wallIds,
        nodeIds: [...zoneIds, ...space.wallIds],
        at,
        area: round2(strip.area),
        width: round2(strip.width),
      })
    }
  }
  return issues
}
