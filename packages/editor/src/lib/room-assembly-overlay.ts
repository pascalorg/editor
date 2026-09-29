import {
  type AnyNode,
  type AnyNodeId,
  area,
  getWallArcData,
  getWallBaseElevationForNodes,
  getWallCurveFrameAt,
  getWallFaceOffsets,
  getWallPlaneTop,
  resolveCeilingHeight,
  resolveWallTop,
  roomDrawnFloor,
  type WallNode,
} from '@pascal-app/core'
import { ShapeUtils, Vector2 } from 'three'
import type { RoomSelectionGeometry, RoomSelectionRecord } from './room-selection'

type Point = readonly [number, number]
type Ring = readonly Point[]

/** Everything the assembly depends on besides the room's topology geometry. */
export type RoomAssemblyHeights = {
  /** Level-local Y of the room's plate top (the level plane without a plate). */
  floorY: number
  /** Level-local Y of each boundary wall's top. */
  wallTops: ReadonlyMap<string, number>
  ceiling: { polygon: Ring; holes: readonly Ring[]; y: number } | null
}

export type RoomWallFacePortion = { wallId: string; face: 'a' | 'b'; from: Point; to: Point }

/** Flat level-local position buffers; the renderer only wraps them. */
export type RoomAssembly = {
  floor: Float32Array
  surfaces: Float32Array
  outline: Float32Array
  faces: RoomWallFacePortion[]
}

const ON_FACE = 1e-3
const FLOOR_LIFT = 0.005
const CEILING_DROP = 0.02
const CURVE_SAMPLES = 24
const MIN_PIECE_AREA = 0.01

/**
 * Curved boundaries leave hairline slivers between the sampled room face and
 * the sampled wall footprint; they would add stray face runs.
 */
function clearPieces(geometry: RoomSelectionGeometry) {
  return geometry.clearPolygon.filter((piece) => area([piece]) >= MIN_PIECE_AREA)
}

export function resolveRoomAssemblyHeights(
  room: RoomSelectionRecord,
  nodes: Readonly<Record<string, AnyNode>>,
): RoomAssemblyHeights {
  const sceneNodes = nodes as Record<AnyNodeId, AnyNode>
  const { levelId } = room.key
  const zone = nodes[room.zoneId]
  let floorY = 0
  // A drawn slab floors the room even with its floor switched off.
  if (zone?.type === 'zone' && (zone.hasFloor !== false || roomDrawnFloor(nodes, zone.id))) {
    const level = nodes[levelId]
    const plate =
      level?.type === 'level'
        ? level.children
            .map((id) => nodes[id])
            .find((node) => node?.type === 'slab' && node.zoneIds?.includes(room.zoneId))
        : undefined
    const drawn = plate ? null : roomDrawnFloor(nodes, room.zoneId)
    const linked =
      plate ?? (drawn ? nodes[drawn.slabId] : room.slabId ? nodes[room.slabId] : undefined)
    floorY = (linked?.type === 'slab' ? linked.elevation : zone.floor?.elevation) ?? 0
  }
  const wallTops = new Map<string, number>()
  for (const id of room.boundaryWallIds) {
    const wall = nodes[id]
    if (wall?.type !== 'wall') continue
    const base = getWallBaseElevationForNodes(wall, sceneNodes)
    wallTops.set(id, resolveWallTop(wall, getWallPlaneTop(wall, levelId, sceneNodes), base))
  }
  const ceilingNode = room.ceilingId ? nodes[room.ceilingId] : undefined
  const ceiling =
    ceilingNode?.type === 'ceiling'
      ? {
          polygon: ceilingNode.polygon,
          holes: ceilingNode.holes,
          y: resolveCeilingHeight(ceilingNode, sceneNodes),
        }
      : null
  return { floorY, wallTops, ceiling }
}

function heightsKey({ floorY, wallTops, ceiling }: RoomAssemblyHeights) {
  const rings = ceiling ? [ceiling.polygon, ...ceiling.holes].map((ring) => ring.join(' ')) : []
  return [floorY, ...wallTops, ceiling?.y, ...rings].join('|')
}

const cache = new WeakMap<RoomSelectionGeometry, { key: string; assembly: RoomAssembly }>()

/**
 * The room geometry object is reused for as long as the level topology
 * revision stands, so it keys the cache; heights and the ceiling outline are
 * compared by value. Hover changes and pointer moves only ever hit.
 */
export function getRoomAssembly(
  geometry: RoomSelectionGeometry,
  heights: RoomAssemblyHeights,
): RoomAssembly {
  const key = heightsKey(heights)
  const cached = cache.get(geometry)
  if (cached?.key === key) return cached.assembly
  const assembly = buildRoomAssembly(geometry, heights)
  cache.set(geometry, { key, assembly })
  return assembly
}

function faceTest(wall: WallNode, face: 'a' | 'b') {
  const offset = getWallFaceOffsets(wall)[face]
  const arc = getWallArcData(wall)
  if (arc) {
    const radius = arc.radius - arc.direction * offset
    return ([x, z]: Point) =>
      Math.abs(Math.hypot(x - arc.center.x, z - arc.center.y) - radius) < ON_FACE
  }
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return () => false
  return ([x, z]: Point) =>
    Math.abs(((x - wall.start[0]) * -dz + (z - wall.start[1]) * dx) / length - offset) < ON_FACE
}

function* ringEdges(ring: Ring) {
  for (let i = 0; i < ring.length; i++) yield [ring[i]!, ring[(i + 1) % ring.length]!] as const
}

function overlap(p: Point, q: Point, a: Point, b: Point): [Point, Point] | null {
  const ex = b[0] - a[0]
  const ez = b[1] - a[1]
  const lengthSq = ex * ex + ez * ez
  if (lengthSq < 1e-12) return null
  const length = Math.sqrt(lengthSq)
  const offLine = ([x, z]: Point) => Math.abs((x - a[0]) * ez - (z - a[1]) * ex) / length
  if (offLine(p) > ON_FACE || offLine(q) > ON_FACE) return null
  const up = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / lengthSq
  const uq = ((q[0] - a[0]) * ex + (q[1] - a[1]) * ez) / lengthSq
  const lo = Math.max(0, Math.min(up, uq))
  const hi = Math.min(1, Math.max(up, uq))
  if ((hi - lo) * length < 1e-4) return null
  return [
    [a[0] + ex * lo, a[1] + ez * lo],
    [a[0] + ex * hi, a[1] + ez * hi],
  ]
}

/**
 * The room-facing part of each boundary wall face. The clear polygon's
 * boundary is exactly the mitered faces the room sees, clipped by T-stems
 * and separators, so its edges are matched against each wall's footprint
 * face edges; that also keeps collinear walls apart.
 */
export function roomWallFaces(geometry: RoomSelectionGeometry): RoomWallFacePortion[] {
  const rings = clearPieces(geometry).flatMap(({ outer, holes }) => [outer, ...holes])
  const faces: RoomWallFacePortion[] = []
  const seen = new Set<string>()
  for (const span of geometry.spans) {
    if (span.kind !== 'wall') continue
    const wallId = span.boundaryId
    const wall = geometry.context.walls.get(wallId)
    if (!wall) continue
    if (!rings.length) {
      faces.push(...sampledFace(wall, span.face, span.t0, span.t1))
      continue
    }
    const key = `${wallId}:${span.face}`
    const footprint = geometry.context.wallFootprints.get(wallId)
    if (seen.has(key) || !footprint) continue
    seen.add(key)
    const onFace = faceTest(wall, span.face)
    const faceEdges = [...ringEdges(footprint)].filter(([a, b]) => onFace(a) && onFace(b))
    for (const ring of rings) {
      for (const [p, q] of ringEdges(ring)) {
        if (!(onFace(p) && onFace(q))) continue
        for (const [a, b] of faceEdges) {
          const portion = overlap(p, q, a, b)
          if (portion) faces.push({ wallId, face: span.face, from: portion[0], to: portion[1] })
        }
      }
    }
  }
  return faces
}

// Only used when the clear polygon could not be computed for the room.
function sampledFace(wall: WallNode, face: 'a' | 'b', t0: number, t1: number) {
  const offset = getWallFaceOffsets(wall)[face]
  const steps = getWallArcData(wall) ? CURVE_SAMPLES : 1
  const points = Array.from({ length: steps + 1 }, (_, i): Point => {
    const { point, normal } = getWallCurveFrameAt(wall, t0 + ((t1 - t0) * i) / steps)
    return [point.x + normal.x * offset, point.y + normal.y * offset]
  })
  return points
    .slice(1)
    .map((to, i): RoomWallFacePortion => ({ wallId: wall.id, face, from: points[i]!, to }))
}

function pushTriangles(target: number[], outer: Ring, holes: readonly Ring[], y: number) {
  const contour = outer.map(([x, z]) => new Vector2(x, z))
  const holePoints = holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)))
  const points = [...contour, ...holePoints.flat()]
  for (const triangle of ShapeUtils.triangulateShape(contour, holePoints)) {
    for (const index of triangle) target.push(points[index]!.x, y, points[index]!.y)
  }
}

function pushRing(target: number[], ring: Ring, y: number) {
  for (const [[ax, az], [bx, bz]] of ringEdges(ring)) target.push(ax, y, az, bx, y, bz)
}

export function buildRoomAssembly(
  geometry: RoomSelectionGeometry,
  heights: RoomAssemblyHeights,
): RoomAssembly {
  const floor: number[] = []
  const surfaces: number[] = []
  const outline: number[] = []
  const floorY = heights.floorY + FLOOR_LIFT
  for (const { outer, holes } of clearPieces(geometry)) {
    pushTriangles(floor, outer, holes, floorY)
    for (const ring of [outer, ...holes]) pushRing(outline, ring, floorY)
  }
  const faces = roomWallFaces(geometry)
  const ends = new Map<string, { point: Point; top: number; count: number }>()
  for (const { wallId, from, to } of faces) {
    const top = heights.wallTops.get(wallId)
    if (top === undefined || top <= floorY) continue
    const [ax, az] = from
    const [bx, bz] = to
    surfaces.push(ax, floorY, az, bx, floorY, bz, bx, top, bz)
    surfaces.push(ax, floorY, az, bx, top, bz, ax, top, az)
    outline.push(ax, top, az, bx, top, bz)
    for (const point of [from, to]) {
      const key = `${wallId}:${point[0].toFixed(4)},${point[1].toFixed(4)}`
      const end = ends.get(key)
      if (end) end.count++
      else ends.set(key, { point, top, count: 1 })
    }
  }
  // Verticals only where a face run starts or stops, not between curve chords.
  for (const { point, top, count } of ends.values()) {
    if (count === 1) outline.push(point[0], floorY, point[1], point[0], top, point[1])
  }
  if (heights.ceiling) {
    const { polygon, holes, y } = heights.ceiling
    pushTriangles(surfaces, polygon, holes, y - CEILING_DROP)
    for (const ring of [polygon, ...holes]) pushRing(outline, ring, y - CEILING_DROP)
  }
  return {
    floor: new Float32Array(floor),
    surfaces: new Float32Array(surfaces),
    outline: new Float32Array(outline),
    faces,
  }
}
