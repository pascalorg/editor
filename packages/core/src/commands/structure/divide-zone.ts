import { area, containsPoint, difference, union } from '../../lib/polygon-boolean'
import { segmentsIntersect } from '../../lib/polygon-relations'
import { extractRooms } from '../../lib/room-graph'
import { SeparatorNode, type WallNode } from '../../schema'
import { getWallCurveFrameAt } from '../../systems/wall/wall-curve'
import { calculateLevelMiters, getWallPlanFootprint } from '../../systems/wall/wall-footprint'
import {
  at,
  boundaries,
  type Point,
  project,
  requireZone,
  roomFace,
  type StructureMintId,
  type StructureNodes,
  type StructurePlan,
} from './shared'

export function createZoneDivisionContext(nodes: StructureNodes, zoneId: string) {
  const zone = requireZone(nodes, zoneId)
  const boundaryNodes = boundaries(nodes, zone.parentId!)
  const faces = extractRooms(boundaryNodes)
  return { zoneId, boundaryNodes, face: roomFace(nodes, zone, faces), roomCount: faces.length }
}
export type ZoneDivisionContext = ReturnType<typeof createZoneDivisionContext>

export function snapZoneBoundary(
  nodes: StructureNodes,
  zoneId: string,
  point: Point,
  gridStep = 0,
  context = createZoneDivisionContext(nodes, zoneId),
  // Set when the pointer landed on a boundary's own surface. The cut belongs on
  // that boundary however thick it is, so the proximity cap — which only exists
  // to reject pointers floating in the middle of the room — does not apply.
  boundaryId?: string,
) {
  const face = context.face
  if (!point.every(Number.isFinite)) throw Error('Invalid cut coordinates.')
  if (!face) throw Error('The room must be enclosed.')
  const named = boundaryId ? face.spans.filter((span) => span.boundaryId === boundaryId) : []
  const candidates = (named.length ? named : face.spans).flatMap((span) => {
    const node = nodes[span.boundaryId]
    if (node?.type !== 'wall' && node?.type !== 'separator') return []
    const pointAt = (t: number): Point => {
      if (node.type === 'separator') return at(node.start, node.end, t)
      const { point: p } = getWallCurveFrameAt(node, t)
      return [p.x, p.y]
    }
    const samples = node.type === 'wall' && node.curveOffset ? 64 : 1
    return Array.from({ length: samples }, (_, i) => {
      const a = pointAt(span.t0 + ((span.t1 - span.t0) * i) / samples)
      const b = pointAt(span.t0 + ((span.t1 - span.t0) * (i + 1)) / samples)
      const projected = project(point, a, b)
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      const t =
        gridStep > 0 && samples === 1
          ? Math.max(
              0,
              Math.min(1, (Math.round((projected.t * length) / gridStep) * gridStep) / length),
            )
          : projected.t
      return {
        ...projected,
        point: at(a, b, t),
        boundaryId: node.id,
        direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as Point,
      }
    })
  })
  const nearest = candidates.sort(
    (a, b) => a.distance - b.distance || a.boundaryId.localeCompare(b.boundaryId),
  )[0]
  if (!nearest || !Number.isFinite(nearest.distance)) return null
  if (!named.length && nearest.distance > 1) return null
  const distance = Math.hypot(nearest.point[0] - point[0], nearest.point[1] - point[1])
  return named.length || distance <= 1 ? { ...nearest, distance } : null
}

function overlapsSegment(a: Point, b: Point, c: Point, d: Point) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1]
  const length = Math.hypot(dx, dz)
  if ([c, d].some((p) => Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) > 1e-8 * length))
    return false
  const station = (p: Point) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length
  const t0 = station(c),
    t1 = station(d)
  return Math.min(length, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) > 1e-8
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    project(a, c, d).distance,
    project(b, c, d).distance,
    project(c, a, b).distance,
    project(d, a, b).distance,
  )
}

export function divideZone(
  nodes: StructureNodes,
  input: {
    zoneId: string
    path?: Point[]
    cut?: [Point, Point]
    closed?: boolean
    startBoundaryId?: string
    endBoundaryId?: string
    mintId: StructureMintId
  },
  context = createZoneDivisionContext(nodes, input.zoneId),
): StructurePlan & { separatorIds: string[]; separatorId?: string } {
  const zone = requireZone(nodes, input.zoneId)
  const reject = (code: string, message: string) => ({
    changes: [],
    separatorIds: [],
    conflicts: [{ code, nodeIds: [zone.id], message }],
  })
  const source = input.path ?? input.cut
  const closed = input.closed ?? false
  if ((input.path && input.cut) || !source || source.length < (closed ? 3 : 2))
    return reject(
      'invalid-path',
      'Supply one path with at least two points, or three for an island.',
    )
  if (source.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
    throw Error('Invalid cut coordinates.')
  const face = context.face
  if (!face) return reject('open-room', 'The room must be enclosed.')
  const rings = [face.referencePolygon, ...face.holes].map((ring) => [...ring])
  const points: Point[] = source.map(([x, z]) => [x, z])
  if (!closed) {
    const first = snapZoneBoundary(nodes, zone.id, points[0]!, 0, context, input.startBoundaryId)
    const last = snapZoneBoundary(nodes, zone.id, points.at(-1)!, 0, context, input.endBoundaryId)
    if (!first || !last) return reject('snap-distance', 'Move within 1 m of a room boundary.')
    points[0] = first.point
    points[points.length - 1] = last.point
    // The graph's adaptive curve samples are coarser than endpoint snapping.
    // Include the snapped station so its tiny chord deviation is not an exit.
    for (const snapped of [first, last]) {
      const boundary = nodes[snapped.boundaryId]
      if (boundary?.type !== 'wall' || !boundary.curveOffset) continue
      const closest = rings
        .flatMap((ring) =>
          ring.map((a, i) => ({
            ring,
            i,
            ...project(snapped.point, a, ring[(i + 1) % ring.length]!),
          })),
        )
        .sort((a, b) => a.distance - b.distance)[0]
      if (closest && closest.t > 1e-8 && closest.t < 1 - 1e-8)
        closest.ring.splice(closest.i + 1, 0, snapped.point)
    }
  }
  const segments: [Point, Point][] = points
    .slice(0, closed ? points.length : -1)
    .map((start, i) => [start, points[(i + 1) % points.length]!])
  if (segments.some(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05 - 1e-9))
    return reject('short-cut', 'Each segment must be at least 5 cm long.')
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i]!
    for (let j = i + 1; j < segments.length; j++) {
      const [c, d] = segments[j]!
      const adjacent = j === i + 1 || (closed && i === 0 && j === segments.length - 1)
      if (overlapsSegment(a, b, c, d) || (!adjacent && segmentsIntersect(a, b, c, d)))
        return reject('self-intersection', 'The path must not cross or retrace itself.')
    }
  }
  if (closed && area([{ outer: points, holes: [] }]) < 0.25 - 1e-9)
    return reject('small-island', 'An island must cover at least 0.25 m².')
  const footprint = { outer: rings[0]!, holes: rings.slice(1) }
  const boundarySegments: [Point, Point][] = [footprint.outer, ...footprint.holes].flatMap((ring) =>
    ring.map((a, i): [Point, Point] => [a, ring[(i + 1) % ring.length]!]),
  )
  for (const [index, [start, end]] of segments.entries()) {
    if (boundarySegments.some(([a, b]) => overlapsSegment(start, end, a, b)))
      return reject('boundary-overlap', 'The path must not run along an existing boundary.')
    for (const [a, b] of boundarySegments) {
      if (!segmentsIntersect(start, end, a, b)) continue
      const dx = end[0] - start[0],
        dz = end[1] - start[1]
      const sx = b[0] - a[0],
        sz = b[1] - a[1]
      const denominator = dx * sz - dz * sx
      const t =
        Math.abs(denominator) > 1e-9
          ? ((a[0] - start[0]) * sz - (a[1] - start[1]) * sx) / denominator
          : project(a, start, end).t
      const endpoint =
        !closed &&
        ((index === 0 && Math.abs(t) < 1e-6) ||
          (index === segments.length - 1 && Math.abs(t - 1) < 1e-6))
      if (!endpoint)
        return reject('outside-room', 'Only the ends of an open path may touch the room boundary.')
    }
    if (!containsPoint([footprint], at(start, end, 0.5)))
      return reject('outside-room', 'The entire path must stay inside the room, outside its holes.')
  }
  if (closed) {
    const walls = context.boundaryNodes.filter((node): node is WallNode => node.type === 'wall')
    const miters = calculateLevelMiters(walls)
    const wallPolygons = walls.map((wall) =>
      getWallPlanFootprint(wall, miters).map(({ x, y }): Point => [x, y]),
    )
    const clear = difference(footprint, union(wallPolygons))
    if (area(difference(points, clear)) > 1e-8)
      return reject('outside-room', 'The island must fit entirely inside the clear room polygon.')
    const wallSegments = wallPolygons.flatMap((ring) =>
      ring.map((a, i): [Point, Point] => [a, ring[(i + 1) % ring.length]!]),
    )
    if (
      segments.some(([a, b]) =>
        wallSegments.some(([c, d]) => segmentDistance(a, b, c, d) < 0.05 - 1e-8),
      )
    )
      return reject('wall-clearance', 'Keep the island at least 5 cm from wall faces.')
  }
  const ids = new Set<string>()
  const separators = segments.map(([start, end]) => {
    const separator = SeparatorNode.parse({
      id: input.mintId('separator'),
      parentId: zone.parentId,
      start,
      end,
    })
    if (nodes[separator.id] || ids.has(separator.id))
      throw Error(`Duplicate separator id: ${separator.id}`)
    ids.add(separator.id)
    return separator
  })
  if (extractRooms([...context.boundaryNodes, ...separators]).length !== context.roomCount + 1)
    return reject('invalid-cut', 'The path must divide this room into exactly two rooms.')
  return {
    changes: separators.map((node) => ({ op: 'create', node })),
    separatorIds: separators.map((node) => node.id),
    separatorId: separators[0]!.id,
  }
}
