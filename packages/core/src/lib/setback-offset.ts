import { type Point2D, pointInPolygon, polygonSignedArea } from './polygon-relations'

export type BuildableAreaOptions = {
  /**
   * How far a mitred corner may run past the vertex, as a multiple of the
   * larger of the two setbacks meeting there. Beyond it the corner is bevelled.
   * Without a limit a nearly-parallel pair of edges throws the corner to
   * infinity.
   */
  miterLimit?: number
}

const DEFAULT_MITER_LIMIT = 4
const EPSILON = 1e-9
/** Anything below this is a numerical artefact of the walk, not a plot. */
const MIN_RING_AREA = 1e-6

function cross(ax: number, az: number, bx: number, bz: number) {
  return ax * bz - az * bx
}

function pointSegmentDistance(point: Point2D, start: Point2D, end: Point2D) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  )
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dz))
}

/**
 * Drops repeated points and forces positive winding, carrying the per-edge
 * distances along. Edge `i` runs `points[i] → points[i + 1]`, so reversing the
 * ring re-indexes the distances too — getting that remap wrong silently swaps
 * the front setback with a side one.
 */
function normalizeRing(
  polygon: readonly Point2D[],
  distances: readonly number[],
): { points: Point2D[]; distances: number[] } | null {
  const kept: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const point = polygon[i]
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null
    const previous = kept.length > 0 ? polygon[kept[kept.length - 1]!]! : undefined
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 1e-9) continue
    kept.push(i)
  }

  // A closed GeoJSON-style ring repeats its first point last.
  if (kept.length > 1) {
    const first = polygon[kept[0]!]!
    const last = polygon[kept[kept.length - 1]!]!
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) kept.pop()
  }

  if (kept.length < 3) return null

  const points = kept.map((index) => [polygon[index]![0], polygon[index]![1]] as Point2D)
  const edgeDistances = kept.map((index) => {
    const distance = distances[index]
    return typeof distance === 'number' && Number.isFinite(distance) ? Math.max(0, distance) : 0
  })

  if (polygonSignedArea(points) < 0) {
    points.reverse()
    const count = points.length
    const reversed = edgeDistances.map(
      (_, index) => edgeDistances[(count - 2 - index + count) % count]!,
    )
    return { points, distances: reversed }
  }

  return { points, distances: edgeDistances }
}

/**
 * Walks the ring one edge at a time, pushing each edge inward by its own
 * distance and intersecting neighbours to find the new corner.
 *
 * This is the whole reason the offset is hand-written: uniform offsetters
 * (Clipper's `ClipperOffset` and friends) take a single delta, and Turkish
 * zoning practice asks for a different one per edge — 5 m to the road, 3 m to
 * each neighbour. It also produces the sharp corner a zoning drawing expects
 * rather than the rounded one a buffer would give.
 */
function mitreWalk(points: Point2D[], distances: number[], miterLimit: number): Point2D[] {
  const count = points.length
  const directions: Point2D[] = []
  const normals: Point2D[] = []
  const origins: Point2D[] = []

  for (let i = 0; i < count; i++) {
    const start = points[i]!
    const end = points[(i + 1) % count]!
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    const direction: Point2D =
      length < EPSILON ? [1, 0] : [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
    // Left of travel is the interior for a positively-wound ring.
    const normal: Point2D = [-direction[1], direction[0]]
    directions.push(direction)
    normals.push(normal)
    origins.push([start[0] + normal[0] * distances[i]!, start[1] + normal[1] * distances[i]!])
  }

  const walked: Point2D[] = []

  for (let i = 0; i < count; i++) {
    const previous = (i - 1 + count) % count
    const vertex = points[i]!
    const previousDistance = distances[previous]!
    const currentDistance = distances[i]!
    const footPrevious: Point2D = [
      vertex[0] + normals[previous]![0] * previousDistance,
      vertex[1] + normals[previous]![1] * previousDistance,
    ]
    const footCurrent: Point2D = [
      vertex[0] + normals[i]![0] * currentDistance,
      vertex[1] + normals[i]![1] * currentDistance,
    ]

    const denominator = cross(
      directions[previous]![0],
      directions[previous]![1],
      directions[i]![0],
      directions[i]![1],
    )

    if (Math.abs(denominator) < 1e-12) {
      const sameDirection =
        directions[previous]![0] * directions[i]![0] +
          directions[previous]![1] * directions[i]![1] >
        0
      if (sameDirection && Math.abs(previousDistance - currentDistance) < 1e-9) {
        walked.push(footCurrent)
      } else {
        // Collinear edges with different setbacks step; a 180° spike bevels.
        walked.push(footPrevious, footCurrent)
      }
      continue
    }

    const t =
      cross(
        origins[i]![0] - origins[previous]![0],
        origins[i]![1] - origins[previous]![1],
        directions[i]![0],
        directions[i]![1],
      ) / denominator
    const corner: Point2D = [
      origins[previous]![0] + directions[previous]![0] * t,
      origins[previous]![1] + directions[previous]![1] * t,
    ]

    const reference = Math.max(previousDistance, currentDistance)
    const mitreLength = Math.hypot(corner[0] - vertex[0], corner[1] - vertex[1])

    // The limit only applies where the corner runs *outward* — a reflex vertex
    // of the parcel, whose exact setback boundary is an arc the mitre
    // overshoots. At a convex vertex the mitre is the intersection of two
    // half-planes and therefore the buildable region's own corner, however far
    // inside it lands; clamping it there would hand back land the setbacks
    // forbid, which is the one failure mode this whole file exists to prevent.
    const reflex = denominator < 0
    if (reflex && reference > EPSILON && mitreLength > miterLimit * reference) {
      walked.push(footPrevious, footCurrent)
    } else {
      walked.push(corner)
    }
  }

  return walked
}

/**
 * Where two edges of the walk cross, if they do.
 *
 * Handles the collinear overlap as well as the transversal crossing, because
 * the overlap is not an exotic case here: a parcel with a narrow neck — the
 * access strip of a flag lot, most obviously — closes under its setbacks by
 * having two parallel offset edges slide *through* each other, never crossing
 * at an angle. Missing it leaves one pinched ring that the region test then
 * rejects wholesale, turning "the rear lot is buildable, the strip is not" into
 * "nothing is buildable".
 */
function segmentIntersection(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): Point2D | null {
  const rx = a2[0] - a1[0]
  const rz = a2[1] - a1[1]
  const sx = b2[0] - b1[0]
  const sz = b2[1] - b1[1]
  const denominator = cross(rx, rz, sx, sz)
  const tolerance = 1e-9
  const qpx = b1[0] - a1[0]
  const qpz = b1[1] - a1[1]

  if (Math.abs(denominator) >= 1e-12) {
    const t = cross(qpx, qpz, sx, sz) / denominator
    const u = cross(qpx, qpz, rx, rz) / denominator
    if (t <= tolerance || t >= 1 - tolerance || u <= tolerance || u >= 1 - tolerance) return null
    return [a1[0] + rx * t, a1[1] + rz * t]
  }

  const lengthSquared = rx * rx + rz * rz
  if (lengthSquared < EPSILON) return null
  // Parallel is not enough; the two edges have to sit on the same line.
  if (Math.abs(cross(qpx, qpz, rx, rz)) / Math.sqrt(lengthSquared) > 1e-7) return null

  const tStart = (qpx * rx + qpz * rz) / lengthSquared
  const tEnd = ((b2[0] - a1[0]) * rx + (b2[1] - a1[1]) * rz) / lengthSquared
  const overlapStart = Math.max(0, Math.min(tStart, tEnd))
  const overlapEnd = Math.min(1, Math.max(tStart, tEnd))
  if (overlapEnd - overlapStart < 1e-7) return null

  const t = (overlapStart + overlapEnd) / 2
  const u = (t - tStart) / (tEnd - tStart)
  if (!Number.isFinite(u)) return null
  if (t <= tolerance || t >= 1 - tolerance || u <= tolerance || u >= 1 - tolerance) return null
  return [a1[0] + rx * t, a1[1] + rz * t]
}

function findSplit(ring: Point2D[]): [Point2D[], Point2D[]] | null {
  const count = ring.length
  for (let i = 0; i < count; i++) {
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue
      const point = segmentIntersection(
        ring[i]!,
        ring[(i + 1) % count]!,
        ring[j]!,
        ring[(j + 1) % count]!,
      )
      if (!point) continue
      return [
        [point, ...ring.slice(i + 1, j + 1)],
        [point, ...ring.slice(j + 1), ...ring.slice(0, i + 1)],
      ]
    }
  }
  return null
}

/**
 * Splits a self-intersecting walk into simple loops.
 *
 * A large setback, or any concave corner, folds the walk back through itself.
 * Without this an L-shaped parcel comes out with a bow-tie where the inner
 * corner should be — and an hourglass parcel silently loses one of its two real
 * halves. Each split strictly shrinks both loops, so the recursion terminates.
 */
function splitSelfIntersections(ring: Point2D[]): Point2D[][] {
  const simple: Point2D[][] = []
  const pending: Point2D[][] = [ring]
  let guard = 0

  while (pending.length > 0 && guard++ < 1024) {
    const candidate = pending.pop()!
    if (candidate.length < 3) continue
    const split = findSplit(candidate)
    if (split) {
      pending.push(split[0], split[1])
    } else {
      simple.push(candidate)
    }
  }

  return simple
}

function areaCentroid(ring: Point2D[]): Point2D | null {
  let area = 0
  let x = 0
  let z = 0
  for (let i = 0; i < ring.length; i++) {
    const current = ring[i]!
    const next = ring[(i + 1) % ring.length]!
    const term = cross(current[0], current[1], next[0], next[1])
    area += term
    x += (current[0] + next[0]) * term
    z += (current[1] + next[1]) * term
  }
  if (Math.abs(area) < EPSILON) return null
  return [x / (3 * area), z / (3 * area)]
}

/** A point known to be strictly inside the ring, for the validity test below. */
function representativePoint(ring: Point2D[]): Point2D | null {
  const centroid = areaCentroid(ring)
  if (centroid && pointInPolygon(centroid, ring, { includeBoundary: false })) return centroid

  // Concave rings can put their centroid outside; an ear's centroid cannot be.
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const c = ring[(i + 2) % ring.length]!
    const candidate: Point2D = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]
    if (pointInPolygon(candidate, ring, { includeBoundary: false })) return candidate
  }

  return null
}

/**
 * Whether a loop the walk produced is really buildable ground.
 *
 * Positive winding alone is not enough: a fold can hand back a positively-wound
 * loop that sits outside the parcel, or inside a setback strip. Testing one
 * interior point against the source polygon and every edge's own distance
 * rejects both, and costs one pass.
 */
function isBuildableRegion(ring: Point2D[], polygon: Point2D[], distances: number[]): boolean {
  if (polygonSignedArea(ring) <= MIN_RING_AREA) return false
  const probe = representativePoint(ring)
  if (!probe) return false
  if (!pointInPolygon(probe, polygon, { includeBoundary: false })) return false

  for (let i = 0; i < polygon.length; i++) {
    const distance = distances[i]!
    if (distance <= 0) continue
    const tolerance = Math.max(1e-6, distance * 1e-4)
    if (
      pointSegmentDistance(probe, polygon[i]!, polygon[(i + 1) % polygon.length]!) <
      distance - tolerance
    ) {
      return false
    }
  }

  return true
}

/**
 * The ground left after each parcel edge is pushed in by its own setback.
 *
 * Returns zero, one or several rings — zero is a real answer ("a small plot
 * with generous setbacks has nowhere to build"), not a failure, and several
 * happens when the setbacks pinch a waisted parcel into separate pieces.
 *
 * The result is deliberately derived rather than stored: the parcel polygon
 * moves under a vertex drag, and a persisted buildable ring would go stale
 * behind it.
 */
export function buildableArea(
  polygon: readonly Point2D[],
  distances: readonly number[],
  options?: BuildableAreaOptions,
): Point2D[][] {
  const normalized = normalizeRing(polygon, distances)
  if (!normalized) return []

  if (normalized.distances.every((distance) => distance <= 0)) return [normalized.points]

  const miterLimit = Math.max(1, options?.miterLimit ?? DEFAULT_MITER_LIMIT)
  const walked = mitreWalk(normalized.points, normalized.distances, miterLimit)
  if (walked.length < 3) return []

  return splitSelfIntersections(walked).filter((ring) =>
    isBuildableRegion(ring, normalized.points, normalized.distances),
  )
}

/** Total area of the rings `buildableArea` returned. */
export function sumRingAreas(rings: readonly Point2D[][]): number {
  return rings.reduce((total, ring) => total + Math.abs(polygonSignedArea(ring)), 0)
}

export type SetbackRoleRule = { role?: string; distance?: number }

/**
 * Expands the sparse per-edge record the site node stores into the dense array
 * the offset wants. Edges nobody has touched fall back to the site default.
 */
export function resolveSetbackDistances(
  edgeCount: number,
  setbacks: Readonly<Record<string, SetbackRoleRule>> | undefined,
  defaultSetback = 0,
): number[] {
  const fallback = Number.isFinite(defaultSetback) ? Math.max(0, defaultSetback) : 0
  return Array.from({ length: Math.max(0, edgeCount) }, (_, index) => {
    const rule = setbacks?.[String(index)]
    const distance = rule?.distance
    return typeof distance === 'number' && Number.isFinite(distance)
      ? Math.max(0, distance)
      : fallback
  })
}

/**
 * Re-keys the setback record after a vertex is inserted into edge `edgeIndex`.
 *
 * The record is keyed by edge index, which the polygon editor renumbers under
 * it every time a vertex appears or disappears. Left alone, every rule past the
 * edit slides onto the wrong edge — the front-yard setback quietly becomes a
 * side one. The split edge's rule applies to both of its halves.
 */
export function remapSetbacksForVertexInsert<T>(
  setbacks: Readonly<Record<string, T>> | undefined,
  edgeIndex: number,
): Record<string, T> {
  const remapped: Record<string, T> = {}
  if (!setbacks) return remapped

  for (const [key, rule] of Object.entries(setbacks)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0) continue
    if (index < edgeIndex) remapped[String(index)] = rule
    else if (index === edgeIndex) {
      remapped[String(index)] = rule
      remapped[String(index + 1)] = rule
    } else remapped[String(index + 1)] = rule
  }

  return remapped
}

/**
 * Re-keys the setback record after `vertexIndex` is removed from a ring that
 * had `pointCount` points. The two edges the vertex joined become one, and it
 * keeps the rule of the earlier of them.
 */
export function remapSetbacksForVertexRemove<T>(
  setbacks: Readonly<Record<string, T>> | undefined,
  vertexIndex: number,
  pointCount: number,
): Record<string, T> {
  const remapped: Record<string, T> = {}
  if (!setbacks || pointCount < 2) return remapped

  const incoming = (vertexIndex - 1 + pointCount) % pointCount
  // Removing the first vertex wraps the merge onto the ring's last edge.
  const mergedKey = vertexIndex === 0 ? pointCount - 2 : incoming
  const mergedRule = setbacks[String(incoming)] ?? setbacks[String(vertexIndex)]

  for (const [key, rule] of Object.entries(setbacks)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= pointCount) continue
    if (index === vertexIndex || index === incoming) continue
    remapped[String(index > vertexIndex ? index - 1 : index)] = rule
  }

  if (mergedRule !== undefined) remapped[String(mergedKey)] = mergedRule
  return remapped
}
