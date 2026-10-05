import type { WallNode } from '../schema'
import { getWallSurfacePolygon, isCurvedWall } from '../systems/wall/wall-curve'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { getWallFaceLine } from '../systems/wall/wall-frame'
import { getWallMiterBoundaryPoints, type WallMiterData } from '../systems/wall/wall-mitering'
import {
  area,
  containsPoint,
  difference,
  type MultiPolygon,
  type Ring,
  union,
} from './polygon-boolean'
import { WALL_JUNCTION_TOLERANCE } from './room-graph'
import type { LevelFootprintContext, TopologyRoom } from './room-topology-index'

const sharedPlateCache = new Map<string, MultiPolygon>()
const clearCache = new WeakMap<TopologyRoom, MultiPolygon>()
const plateCache = new WeakMap<LevelFootprintContext, Map<string, MultiPolygon>>()
const plateContexts = new WeakMap<MultiPolygon, LevelFootprintContext>()
const miterCache = new WeakMap<LevelFootprintContext, WallMiterData>()

type WallFootprint = { id: string; polygon: Ring; t0: number; t1: number }

function clipWallSpan(polygon: Ring, wall: WallNode, t0: number, t1: number): Ring {
  let result = polygon
  const dx = wall.end[0] - wall.start[0],
    dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  const tangent = { x: dx / length, y: dz / length }
  for (const [t, sign] of [
    [t0, 1],
    [t1, -1],
  ]) {
    // Spans use chord parameters, and topology can snap a junction up to 8 cm
    // from an endpoint. Keep the real miter at those terminal spans.
    if (
      (sign === 1 && t! * length <= WALL_JUNCTION_TOLERANCE) ||
      (sign === -1 && (1 - t!) * length <= WALL_JUNCTION_TOLERANCE)
    )
      continue
    const point = { x: wall.start[0] + dx * t!, y: wall.start[1] + dz * t! }
    const distance = ([x, z]: [number, number]) =>
      sign! * ((x - point.x) * tangent.x + (z - point.y) * tangent.y)
    const clipped: Ring = []
    for (const [i, end] of result.entries()) {
      const start = result[(i + result.length - 1) % result.length]!
      const a = distance(start),
        b = distance(end)
      if (a >= 0 !== b >= 0) {
        const u = a / (a - b)
        clipped.push([start[0] + u * (end[0] - start[0]), start[1] + u * (end[1] - start[1])])
      }
      if (b >= 0) clipped.push(end)
    }
    result = clipped
  }
  return result
}

function boundaryFootprints(rooms: readonly TopologyRoom[]): WallFootprint[] {
  const context = rooms[0]?.context
  if (!context) return []
  let miters = miterCache.get(context)
  if (!miters) {
    miters = calculateLevelMiters([...context.walls.values()])
    miterCache.set(context, miters)
  }
  const intervals = new Map<string, Array<{ t0: number; t1: number }>>()
  for (const room of rooms)
    for (const span of room.spans) {
      if (span.kind !== 'wall') continue
      const list = intervals.get(span.boundaryId) ?? []
      list.push(span)
      intervals.set(span.boundaryId, list)
    }
  return [...intervals].flatMap(([id, spans]) => {
    const wall = context?.walls.get(id),
      polygon = context?.wallFootprints.get(id)
    if (!(wall && polygon)) return []
    const merged: Array<{ t0: number; t1: number }> = []
    for (const span of spans.sort((a, b) => a.t0 - b.t0)) {
      const last = merged.at(-1)
      if (last && span.t0 <= last.t1 + 1e-8) last.t1 = Math.max(last.t1, span.t1)
      else merged.push({ t0: span.t0, t1: span.t1 })
    }
    const boundary = getWallMiterBoundaryPoints(wall, miters)
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1]
    const lengthSq = dx * dx + dz * dz
    const segments = isCurvedWall(wall) ? 24 : 1
    const surface = boundary ? getWallSurfacePolygon(wall, segments, boundary) : []
    const lines = [surface.slice(0, segments + 1), surface.slice(segments + 1).reverse()]
    const faceParameters = (t: number) =>
      boundary
        ? lines.map((line) => {
            const index = Math.min(Math.floor(t * segments), segments - 1)
            const fraction = t * segments - index
            const start = line[index]!,
              end = line[index + 1]!
            return (
              ((start.x + (end.x - start.x) * fraction - wall.start[0]) * dx +
                (start.y + (end.y - start.y) * fraction - wall.start[1]) * dz) /
              lengthSq
            )
          })
        : [t]
    return merged.map(({ t0, t1 }) => {
      // Mitered face endpoints can lie beyond the reference segment. Retain the
      // owned face interval as well as its perpendicular reference-line cut.
      const stations = [
        t0,
        t1,
        ...Array.from({ length: segments + 1 }, (_, i) => i / segments).filter(
          (t) => t > t0 && t < t1,
        ),
      ]
      const parameters = stations.flatMap(faceParameters)
      const from = Math.min(t0, ...parameters)
      const to = Math.max(t1, ...parameters)
      return { id, t0: from, t1: to, polygon: clipWallSpan(polygon, wall, from, to) }
    })
  })
}

const coverageCache = new WeakMap<MultiPolygon, WeakMap<Ring, boolean>>()
function coversFootprint(plate: MultiPolygon, footprint: Ring) {
  const cache = coverageCache.get(plate) ?? new WeakMap<Ring, boolean>()
  const cached = cache.get(footprint)
  if (cached !== undefined) return cached
  try {
    const covered = area(difference(footprint, plate, { throwOnError: true })) < 1e-6
    cache.set(footprint, covered)
    coverageCache.set(plate, cache)
    return covered
  } catch {
    return false
  }
}

function rawWallRectangle(wall: WallNode): Ring {
  const a = getWallFaceLine(wall, 'a')
  const b = getWallFaceLine(wall, 'b')
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  const tx = dx / length
  const tz = dz / length
  // Two clipping-grid steps keep re-quantized intersections inside the fallback.
  const padding = 0.0002
  return [
    [a.start.x + padding * (-tx - tz), a.start.y + padding * (-tz + tx)],
    [b.start.x + padding * (-tx + tz), b.start.y + padding * (-tz - tx)],
    [b.end.x + padding * (tx + tz), b.end.y + padding * (tz - tx)],
    [a.end.x + padding * (tx - tz), a.end.y + padding * (tz + tx)],
  ]
}

function recoverWallFootprint(
  plate: MultiPolygon,
  footprint: WallFootprint,
  context: LevelFootprintContext,
): MultiPolygon {
  const wall = context.walls.get(footprint.id)
  const diagnostic = { levelId: wall?.parentId, wallId: footprint.id }
  const cleaned = union([footprint.polygon])
  if (cleaned.length) {
    const combined = union([plate, cleaned])
    if (combined.length && coversFootprint(combined, footprint.polygon)) return combined
  }
  if (wall) {
    const combined = union([
      plate,
      clipWallSpan(rawWallRectangle(wall), wall, footprint.t0, footprint.t1),
    ])
    if (combined.length && coversFootprint(combined, footprint.polygon)) return combined
    if (combined.length && cleaned.length) {
      const joined = union([combined, cleaned])
      if (joined.length && coversFootprint(joined, footprint.polygon)) return joined
    }
  }
  const padded = union(
    [-0.0002, 0, 0.0002].flatMap((dx) =>
      [-0.0002, 0, 0.0002].map((dz) =>
        footprint.polygon.map(([x, z]): [number, number] => [x + dx, z + dz]),
      ),
    ),
  )
  const combined = union([plate, padded])
  if (combined.length && coversFootprint(combined, footprint.polygon)) return combined
  throw new Error(`Cannot cover boundary wall ${diagnostic.wallId} on level ${diagnostic.levelId}`)
}

export function roomWallFootprints(rooms: readonly TopologyRoom[]): MultiPolygon {
  return union(boundaryFootprints(rooms).map(({ polygon }) => polygon))
}

export function roomClearPolygon(room: TopologyRoom): MultiPolygon {
  const cached = clearCache.get(room)
  if (cached) return cached
  const result = difference(
    { outer: room.polygon, holes: room.holes },
    union(boundaryFootprints([room]).map(({ polygon }) => polygon)),
  )
  clearCache.set(room, result)
  return result
}

/** Rooms must belong to the same immutable level topology revision. */
export function plateFootprint(rooms: readonly TopologyRoom[]): MultiPolygon {
  const context = rooms[0]?.context
  if (!context) return []
  if (rooms.some((room) => room.context !== context))
    throw new Error('Plate rooms must share a level topology revision')
  const key = JSON.stringify([...new Set(rooms.map((room) => room.id))].sort())
  const cache = plateCache.get(context) ?? new Map<string, MultiPolygon>()
  const cached = cache.get(key)
  if (cached) return cached
  const signature = JSON.stringify([
    rooms
      .map(({ id, polygon, holes, spans }) => [id, polygon, holes, spans])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [...context.wallFootprints],
    [...context.walls.values()].map(({ id, start, end, thickness, justification, curveOffset }) => [
      id,
      start,
      end,
      thickness,
      justification,
      curveOffset,
    ]),
  ])
  const shared = sharedPlateCache.get(signature)
  if (shared) {
    cache.set(key, shared)
    plateCache.set(context, cache)
    plateContexts.set(shared, context)
    return shared
  }
  // Only half-edges in closed faces contribute: dangling T-stems are not room boundaries.
  const faces = rooms.map((room) => ({ outer: room.polygon, holes: room.holes }))
  const footprints = boundaryFootprints(rooms)
  let result = union([...faces, ...footprints.map(({ polygon }) => polygon)])
  if (!result.length) {
    // A combined sweep can fail even when both sets union separately. Preserve
    // the room surface while isolating additions that the clipper cannot handle.
    result = union(faces)
    if (!result.length) {
      result = faces.flatMap((face) => {
        const cleaned = union([face])
        return cleaned.length ? cleaned : [face]
      })
    }
    for (const footprint of footprints) {
      const combined = union([result, footprint.polygon])
      result = combined.length ? combined : recoverWallFootprint(result, footprint, context)
    }
  }
  for (const footprint of footprints) {
    if (!coversFootprint(result, footprint.polygon))
      result = recoverWallFootprint(result, footprint, context)
  }
  if (result.length > 1) {
    const rectangles = footprints.flatMap(({ id, t0, t1 }) => {
      const wall = context.walls.get(id)
      return wall && !wall.curveOffset ? [clipWallSpan(rawWallRectangle(wall), wall, t0, t1)] : []
    })
    const joined = union([result, ...rectangles])
    if (joined.length) result = joined
  }
  // Quantization in a later union can reopen a sliver at an earlier wall.
  for (let pass = 0; pass < 3; pass++) {
    const missing = footprints.filter((footprint) => !coversFootprint(result, footprint.polygon))
    if (!missing.length) break
    for (const footprint of missing) result = recoverWallFootprint(result, footprint, context)
  }
  if (footprints.some((footprint) => !coversFootprint(result, footprint.polygon))) {
    // Recover all seams together: repairing one wall at a time can repeatedly
    // reopen the preceding wall's intersection on the clipping grid.
    const padded = footprints.flatMap(({ polygon }) =>
      [-0.0002, 0, 0.0002].flatMap((dx) =>
        [-0.0002, 0, 0.0002].map((dz) =>
          polygon.map(([x, z]): [number, number] => [x + dx, z + dz]),
        ),
      ),
    )
    const covered = union([result, ...padded])
    if (covered.length) result = covered
  }
  // Later unions re-quantize earlier intersections; never cache a plate that
  // lost coverage during a subsequent recovery.
  for (const footprint of footprints) {
    if (!coversFootprint(result, footprint.polygon)) {
      const levelId = context.walls.get(footprint.id)?.parentId
      throw new Error(`Cannot cover boundary wall ${footprint.id} on level ${levelId}`)
    }
  }
  sharedPlateCache.set(signature, result)
  if (sharedPlateCache.size > 64) sharedPlateCache.delete(sharedPlateCache.keys().next().value!)
  plateContexts.set(result, context)
  cache.set(key, result)
  plateCache.set(context, cache)
  return result
}

export type ExposedInterval = {
  covered?: boolean
  polygonIndex: number
  edgeIndex: number
  t0: number
  t1: number
  start: [number, number]
  end: [number, number]
}

type Edge = { start: [number, number]; end: [number, number]; dx: number; dz: number }
type PreparedFootprints = { polygons: MultiPolygon; edges: Edge[] }
const exposureCache = new WeakMap<LevelFootprintContext, PreparedFootprints>()
const wallExposureCache = new WeakMap<
  readonly WallNode[],
  { signature: string; prepared: PreparedFootprints }
>()
const plateEdgeCache = new WeakMap<
  MultiPolygon,
  Array<Edge & { polygonIndex: number; edgeIndex: number }>
>()

function edges(ring: Ring): Edge[] {
  return ring.map((start, i) => {
    const end = ring[(i + 1) % ring.length]!
    return { start, end, dx: end[0] - start[0], dz: end[1] - start[1] }
  })
}

function prepareFootprints(rings: Ring[]): PreparedFootprints {
  const polygons = union(rings)
  return {
    polygons,
    edges: polygons.flatMap(({ outer, holes }) => [outer, ...holes].flatMap(edges)),
  }
}

function exposureFootprints(
  plate: MultiPolygon,
  source: readonly WallNode[] | LevelFootprintContext,
) {
  let context: LevelFootprintContext | undefined
  if ('wallFootprints' in source) context = source
  else {
    const candidate = plateContexts.get(plate)
    if (
      candidate &&
      candidate.walls.size === source.length &&
      source.every((wall) => candidate.walls.get(wall.id) === wall)
    )
      context = candidate
  }
  if (context) {
    let prepared = exposureCache.get(context)
    if (!prepared) {
      prepared = prepareFootprints([...context.wallFootprints.values()])
      exposureCache.set(context, prepared)
    }
    return prepared
  }
  const walls = source as readonly WallNode[]
  const signature = JSON.stringify(
    walls.map(({ id, start, end, thickness, justification, curveOffset }) => [
      id,
      start,
      end,
      thickness,
      justification,
      curveOffset,
    ]),
  )
  const cached = wallExposureCache.get(walls)
  if (cached?.signature === signature) return cached.prepared
  const miters = calculateLevelMiters([...walls])
  const prepared = prepareFootprints(
    walls.map((wall) =>
      getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
    ),
  )
  wallExposureCache.set(walls, { signature, prepared })
  return prepared
}

/** Passing a topology context reuses its joined footprints across every plate in that revision. */
export function exposedIntervals(
  plate: MultiPolygon,
  walls: readonly WallNode[] | LevelFootprintContext,
  cover?: MultiPolygon,
  options?: { includeCovered?: boolean; splitAt?: MultiPolygon },
): ExposedInterval[] {
  if (!plate.length) return []
  const footprints = cover
    ? {
        polygons: cover,
        edges: cover.flatMap(({ outer, holes }) => [outer, ...holes].flatMap(edges)),
      }
    : exposureFootprints(plate, walls)
  const cuttingEdges = [
    ...footprints.edges,
    ...(options?.splitAt ?? []).flatMap(({ outer, holes }) => [outer, ...holes].flatMap(edges)),
  ]
  let plateEdges = plateEdgeCache.get(plate)
  if (!plateEdges) {
    plateEdges = plate.flatMap(({ outer, holes }, polygonIndex) =>
      [outer, ...holes]
        .flatMap(edges)
        .map((edge, edgeIndex) => ({ ...edge, polygonIndex, edgeIndex })),
    )
    plateEdgeCache.set(plate, plateEdges)
  }
  const result: ExposedInterval[] = []
  for (const { start, dx, dz, polygonIndex, edgeIndex } of plateEdges) {
    const lengthSq = dx * dx + dz * dz
    if (!lengthSq) continue
    const at = (t: number): [number, number] => [start[0] + t * dx, start[1] + t * dz]
    const cuts = [0, 1]
    for (const { start: a, end: b, dx: ex, dz: ez } of cuttingEdges) {
      const ax = a[0] - start[0],
        az = a[1] - start[1]
      const cross = dx * ez - dz * ex
      if (Math.abs(cross) < 1e-12) {
        if (Math.abs(ax * dz - az * dx) < 1e-12) {
          for (const p of [a, b])
            cuts.push(
              Math.max(
                0,
                Math.min(1, ((p[0] - start[0]) * dx + (p[1] - start[1]) * dz) / lengthSq),
              ),
            )
        }
        continue
      }
      const t = (ax * ez - az * ex) / cross
      const u = (ax * dz - az * dx) / cross
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t)
    }
    const ordered = [...new Set(cuts)].sort((a, b) => a - b)
    for (let i = 0; i < ordered.length - 1; i++) {
      const t0 = ordered[i]!,
        t1 = ordered[i + 1]!
      const covered = containsPoint(footprints.polygons, at((t0 + t1) / 2))
      if (t1 - t0 <= 1e-12 || (covered && !options?.includeCovered)) continue
      const previous = result.at(-1)
      if (
        previous?.polygonIndex === polygonIndex &&
        previous.edgeIndex === edgeIndex &&
        previous.t1 === t0 &&
        !options?.includeCovered
      ) {
        previous.t1 = t1
        previous.end = at(t1)
      } else
        result.push({
          polygonIndex,
          edgeIndex,
          t0,
          t1,
          start: at(t0),
          end: at(t1),
          ...(options?.includeCovered ? { covered } : {}),
        })
    }
  }
  return result
}

export function clearLevelFootprintCaches(): void {
  sharedPlateCache.clear()
}
