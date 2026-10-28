import {
  type AnyNode,
  type BoundarySpan,
  getWallFaceOffsets,
  isCurvedWall,
  type Point,
  type SeparatorNode,
  type WallNode,
} from '@pascal-app/core'

/**
 * A live room dimension shown while a wall (or mezzanine edge) is pushed: from
 * the moving face to one facing parallel face of the same room, the clear
 * interior distance between the two, in level plan metres.
 */
export type RoomDimension = {
  key: string
  /** On the moving face. */
  from: Point
  /** On the facing face, `distance` from `from` along the push axis. */
  to: Point
  distance: number
  /** Level-frame height the 3D line runs at: just above that room's floor. */
  elevation: number
}

/** A straight boundary face and the unit normal pointing into the room it bounds. */
export type RoomFace = { start: Point; end: Point; inward: Point }

/** A room on one face of the pushed stretch, with its other boundary spans. */
export type PushDimensionRoom = {
  id: string
  /** The moving wall's face the room lies on. */
  face: 'a' | 'b'
  /** The part of the pushed stretch this room lies along. */
  t0: number
  t1: number
  others: BoundarySpan[]
  elevation: number
}

export const MAX_DIMENSIONS_PER_SIDE = 3
/** Lift of the 3D line over the room's floor, so it clears the floor surface. */
export const DIMENSION_FLOOR_LIFT = 0.06

const PARALLEL_SIN = Math.sin(Math.PI / 180)
const MIN_GAP = 1e-3
const MIN_OVERLAP = 1e-3
const SAME_DISTANCE = 1e-3

type Measured = { from: Point; to: Point; distance: number }

/**
 * Every face in `faces` parallel to `moving` (within 1°) that faces it across
 * the room — its inward normal opposes the moving face's and it lies in front
 * of it — and shares some of its length, measured face to face at the middle
 * of the shared stretch.
 */
export function facingDimensions(moving: RoomFace, faces: Iterable<RoomFace>): Measured[] {
  const dx = moving.end[0] - moving.start[0]
  const dz = moving.end[1] - moving.start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_OVERLAP) return []
  const dir: Point = [dx / length, dz / length]
  const [nx, nz] = moving.inward
  const along = (p: Point) => (p[0] - moving.start[0]) * dir[0] + (p[1] - moving.start[1]) * dir[1]
  const result: Measured[] = []
  for (const face of faces) {
    const fx = face.end[0] - face.start[0]
    const fz = face.end[1] - face.start[1]
    const faceLength = Math.hypot(fx, fz)
    if (faceLength < MIN_OVERLAP) continue
    if (Math.abs(dir[0] * fz - dir[1] * fx) / faceLength > PARALLEL_SIN) continue
    if (face.inward[0] * nx + face.inward[1] * nz >= 0) continue
    const distance = (face.start[0] - moving.start[0]) * nx + (face.start[1] - moving.start[1]) * nz
    if (distance <= MIN_GAP) continue
    const a = along(face.start)
    const b = along(face.end)
    const lo = Math.max(0, Math.min(a, b))
    const hi = Math.min(length, Math.max(a, b))
    if (hi - lo < MIN_OVERLAP) continue
    const u = (lo + hi) / 2
    const from: Point = [moving.start[0] + dir[0] * u, moving.start[1] + dir[1] * u]
    result.push({ from, to: [from[0] + nx * distance, from[1] + nz * distance], distance })
  }
  return result
}

/** Nearest first, one per distinct distance, at most `MAX_DIMENSIONS_PER_SIDE`. */
export function pickDimensions<T extends { distance: number }>(dimensions: T[]): T[] {
  const picked: T[] = []
  for (const dimension of [...dimensions].sort((p, q) => p.distance - q.distance)) {
    if (picked.length >= MAX_DIMENSIONS_PER_SIDE) break
    if (picked.some((kept) => Math.abs(kept.distance - dimension.distance) < SAME_DISTANCE))
      continue
    picked.push(dimension)
  }
  return picked
}

/**
 * The `face` side of `[t0, t1]` of a straight wall or separator, with its
 * room-ward normal (face `a` is the `+normal` side). Null for curved or
 * degenerate boundaries, which get no dimension.
 */
export function boundaryFace(
  boundary: AnyNode | undefined,
  t0: number,
  t1: number,
  face: 'a' | 'b',
): RoomFace | null {
  if (boundary?.type !== 'wall' && boundary?.type !== 'separator') return null
  if (boundary.type === 'wall' && isCurvedWall(boundary)) return null
  const [sx, sz] = boundary.start
  const dx = boundary.end[0] - sx
  const dz = boundary.end[1] - sz
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null
  const nx = -dz / length
  const nz = dx / length
  const offset = boundary.type === 'wall' ? getWallFaceOffsets(boundary)[face] : 0
  const at = (t: number): Point => [sx + dx * t + nx * offset, sz + dz * t + nz * offset]
  const sign = face === 'a' ? 1 : -1
  return { start: at(t0), end: at(t1), inward: [nx * sign, nz * sign] }
}

/**
 * The rooms along a pushed stretch `[t0, t1]` of `wallId`, on either face, each
 * clipped to the part of the stretch it lies along. Read once when the drag
 * starts: the topology is the scene's, not the preview's.
 */
export function wallPushDimensionRooms(
  rooms: ReadonlyArray<{ id: string; spans: readonly BoundarySpan[] }>,
  span: { wallId: string; t0: number; t1: number },
  elevationOf: (roomId: string) => number,
): PushDimensionRoom[] {
  return rooms.flatMap((room) =>
    room.spans.flatMap((own): PushDimensionRoom[] => {
      if (own.boundaryId !== span.wallId) return []
      const t0 = Math.max(span.t0, own.t0)
      const t1 = Math.min(span.t1, own.t1)
      if (t1 - t0 < 1e-4) return []
      return [
        {
          id: room.id,
          face: own.face,
          t0,
          t1,
          others: room.spans.filter((other) => other.boundaryId !== span.wallId),
          elevation: elevationOf(room.id),
        },
      ]
    }),
  )
}

/**
 * The rooms along a pushed edge of invisible walls, as `wallPushDimensionRooms`
 * reads them along a wall: each room's stretch of the edge's separators, put
 * on the edge's one `line` (`[0, 1]` its length), faced as that line runs.
 */
export function separatorEdgeDimensionRooms(
  rooms: ReadonlyArray<{ id: string; spans: readonly BoundarySpan[] }>,
  edge: {
    line: Pick<SeparatorNode, 'start' | 'end'>
    separators: ReadonlyArray<{ separatorId: string; t0: number; t1: number }>
  },
  resolve: (id: string) => AnyNode | undefined,
  elevationOf: (roomId: string) => number,
): PushDimensionRoom[] {
  const { start, end } = edge.line
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq < 1e-12) return []
  const members = new Set(edge.separators.map((member) => member.separatorId))
  const along = ([x, z]: Point) => ((x - start[0]) * dx + (z - start[1]) * dz) / lengthSq
  return rooms.flatMap((room) =>
    room.spans.flatMap((own): PushDimensionRoom[] => {
      const member = edge.separators.find((entry) => entry.separatorId === own.boundaryId)
      const separator = resolve(own.boundaryId)
      if (!member || separator?.type !== 'separator') return []
      const t0 = Math.max(member.t0, own.t0)
      const t1 = Math.min(member.t1, own.t1)
      if (t1 - t0 < 1e-4) return []
      const sx = separator.end[0] - separator.start[0]
      const sz = separator.end[1] - separator.start[1]
      const point = (t: number): Point => [separator.start[0] + sx * t, separator.start[1] + sz * t]
      const [u0, u1] = [along(point(t0)), along(point(t1))]
      // A separator drawn against the edge's line has its faces the other way round.
      const same = sx * dx + sz * dz > 0
      return [
        {
          id: room.id,
          face: same ? own.face : own.face === 'a' ? 'b' : 'a',
          t0: Math.min(u0, u1),
          t1: Math.max(u0, u1),
          others: room.spans.filter((other) => !members.has(other.boundaryId)),
          elevation: elevationOf(room.id),
        },
      ]
    }),
  )
}

/**
 * The live dimensions of a wall push: for every room along the pushed stretch,
 * the moving face (the resting face moved `distance` along `outward` — a push
 * is a pure translation) to each facing parallel boundary of that room, read
 * through `resolve` so the preview's geometry counts. Per side of the wall:
 * nearest first, one per distinct distance, at most three. An edge of
 * invisible walls is measured as its one line.
 */
export function wallPushDimensions({
  rooms,
  wall,
  outward,
  distance,
  resolve,
}: {
  rooms: readonly PushDimensionRoom[]
  wall: WallNode | SeparatorNode
  outward: Point
  distance: number
  resolve: (id: string) => AnyNode | undefined
}): RoomDimension[] {
  type Placed = Measured & { elevation: number }
  const sides: Record<'a' | 'b', Placed[]> = { a: [], b: [] }
  const shift = ([x, z]: Point): Point => [x + outward[0] * distance, z + outward[1] * distance]
  for (const room of rooms) {
    const rest = boundaryFace(wall, room.t0, room.t1, room.face)
    if (!rest) return []
    const moving = { start: shift(rest.start), end: shift(rest.end), inward: rest.inward }
    const faces = room.others.flatMap((span) => {
      const face = boundaryFace(resolve(span.boundaryId), span.t0, span.t1, span.face)
      return face ? [face] : []
    })
    for (const measured of facingDimensions(moving, faces))
      sides[room.face].push({ ...measured, elevation: room.elevation + DIMENSION_FLOOR_LIFT })
  }
  return (['a', 'b'] as const).flatMap((side) =>
    pickDimensions(sides[side]).map((dimension, index) => ({
      ...dimension,
      key: `${side}:${index}`,
    })),
  )
}

/** A selected wall's temporary dimension: a room width (ID) or the outside size (OD). */
export type WallSelectionDimension = RoomDimension & { faces: 'interior' | 'exterior' }

/** Which faces a selected wall's temporary dimensions measure to. */
export type WallDimensionFaces = 'interior' | 'exterior' | 'both'

const CONNECTION_TOLERANCE = 0.03
/** Where along the shared stretch the outside size is drawn, clear of the room widths at its middle. */
const EXTERIOR_DIMENSION_AT = 0.25

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSq = dx * dx + dz * dz
  const t =
    lengthSq < 1e-12
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq))
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t))
}

function wallsTouch(left: WallNode, right: WallNode): boolean {
  return (
    [left.start, left.end].some(
      (p) => pointSegmentDistance(p, right.start, right.end) <= CONNECTION_TOLERANCE,
    ) ||
    [right.start, right.end].some(
      (p) => pointSegmentDistance(p, left.start, left.end) <= CONNECTION_TOLERANCE,
    )
  )
}

/** The walls joined to `wall` through shared corners and T junctions, itself included. */
function connectedWalls(wall: WallNode, walls: readonly WallNode[]): WallNode[] {
  const found = new Map<string, WallNode>([[wall.id, wall]])
  const queue = [wall]
  for (let current = queue.pop(); current; current = queue.pop()) {
    for (const candidate of walls) {
      if (found.has(candidate.id) || !wallsTouch(current, candidate)) continue
      found.set(candidate.id, candidate)
      queue.push(candidate)
    }
  }
  return [...found.values()]
}

/**
 * The outside size across the building from a wall's exterior face: to the
 * far face of the farthest parallel wall of the same connected building that
 * shares some of its length — the opposite exterior wall. Null when nothing
 * is across (a lone wall, a curved one).
 */
function overallExteriorDimension(
  wall: WallNode,
  exteriorFace: 'a' | 'b',
  walls: readonly WallNode[],
): Measured | null {
  const own = boundaryFace(wall, 0, 1, exteriorFace)
  if (!own) return null
  const dx = own.end[0] - own.start[0]
  const dz = own.end[1] - own.start[1]
  const length = Math.hypot(dx, dz)
  const dir: Point = [dx / length, dz / length]
  // The face's room-ward normal points out of the building here: across is its opposite.
  const across: Point = [-own.inward[0], -own.inward[1]]
  const along = (p: Point) => (p[0] - own.start[0]) * dir[0] + (p[1] - own.start[1]) * dir[1]
  let best: { distance: number; lo: number; hi: number } | null = null
  for (const other of connectedWalls(wall, walls)) {
    if (other.id === wall.id) continue
    for (const face of ['a', 'b'] as const) {
      const candidate = boundaryFace(other, 0, 1, face)
      if (!candidate) continue
      const fx = candidate.end[0] - candidate.start[0]
      const fz = candidate.end[1] - candidate.start[1]
      const faceLength = Math.hypot(fx, fz)
      if (Math.abs(dir[0] * fz - dir[1] * fx) / faceLength > PARALLEL_SIN) continue
      const distance =
        (candidate.start[0] - own.start[0]) * across[0] +
        (candidate.start[1] - own.start[1]) * across[1]
      if (distance <= MIN_GAP) continue
      const a = along(candidate.start)
      const b = along(candidate.end)
      const lo = Math.max(0, Math.min(a, b))
      const hi = Math.min(length, Math.max(a, b))
      if (hi - lo < MIN_OVERLAP) continue
      if (!best || distance > best.distance + SAME_DISTANCE) best = { distance, lo, hi }
    }
  }
  if (!best) return null
  const u = best.lo + (best.hi - best.lo) * EXTERIOR_DIMENSION_AT
  const from: Point = [own.start[0] + dir[0] * u, own.start[1] + dir[1] * u]
  return {
    from,
    to: [from[0] + across[0] * best.distance, from[1] + across[1] * best.distance],
    distance: best.distance,
  }
}

/**
 * The temporary dimensions of a selected wall at rest, in 2D and 3D: the room
 * widths a push of it shows (its face to each facing wall, both sides — ID),
 * and for an exterior wall the outside size across the building (OD). `faces`
 * picks which; a wall with no outside (rooms on both faces) shows its room
 * widths whatever the choice. Each dimension runs `from` the selected wall,
 * so typing a value moves that wall (`commitDimensionValue`).
 */
export function wallSelectionDimensions({
  rooms,
  wall,
  walls,
  faces,
  resolve,
  baseElevation,
}: {
  rooms: readonly PushDimensionRoom[]
  wall: WallNode
  /** The level's walls, for the opposite exterior wall. */
  walls: readonly WallNode[]
  faces: WallDimensionFaces
  resolve: (id: string) => AnyNode | undefined
  /** The wall's base, for a dimension with no room floor to stand on. */
  baseElevation: number
}): WallSelectionDimension[] {
  const interior = wallPushDimensions({ rooms, wall, outward: [0, 0], distance: 0, resolve }).map(
    (dimension): WallSelectionDimension => ({ ...dimension, faces: 'interior' }),
  )
  const roomFaces = new Set(rooms.map((room) => room.face))
  const exteriorFace = roomFaces.size === 1 ? (roomFaces.has('a') ? 'b' : 'a') : null
  if (!exteriorFace || faces === 'interior') return interior
  const overall = overallExteriorDimension(wall, exteriorFace, walls)
  const exterior: WallSelectionDimension[] = overall
    ? [
        {
          ...overall,
          key: 'exterior',
          faces: 'exterior',
          elevation: (rooms[0]?.elevation ?? baseElevation) + DIMENSION_FLOOR_LIFT,
        },
      ]
    : []
  return faces === 'exterior' ? exterior : [...interior, ...exterior]
}

/**
 * The live dimensions of a mezzanine edge push: the resting edge moved
 * `distance` along `outward`, to each facing parallel edge of the outline the
 * push would leave. Nearest first, one per distinct distance, at most three.
 */
export function mezzanineEdgeDimensions({
  rest,
  outline,
  edgeIndex,
  outward,
  distance,
  elevation,
}: {
  /** The mezzanine outline before the drag. */
  rest: readonly Point[]
  /** The outline the push would leave. */
  outline: readonly Point[]
  edgeIndex: number
  outward: Point
  distance: number
  elevation: number
}): RoomDimension[] {
  const start = rest[edgeIndex]
  const end = rest[(edgeIndex + 1) % rest.length]
  if (!(start && end) || outline.length < 3) return []
  const inward: Point = [-outward[0], -outward[1]]
  const shift = ([x, z]: Point): Point => [x + outward[0] * distance, z + outward[1] * distance]
  const moving = { start: shift(start), end: shift(end), inward }
  const winding = Math.sign(signedArea(outline))
  const faces = outline.map((p, i): RoomFace => {
    const q = outline[(i + 1) % outline.length]!
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    // Core's outward normal is (winding·dz, −winding·dx); into the plate is its opposite.
    return {
      start: p,
      end: q,
      inward: [(-winding * (q[1] - p[1])) / length, (winding * (q[0] - p[0])) / length],
    }
  })
  return pickDimensions(facingDimensions(moving, faces)).map((dimension, index) => ({
    ...dimension,
    elevation: elevation + DIMENSION_FLOOR_LIFT,
    key: `edge:${index}`,
  }))
}

function signedArea(polygon: readonly Point[]) {
  let sum = 0
  for (const [i, p] of polygon.entries()) {
    const q = polygon[(i + 1) % polygon.length]!
    sum += p[0] * q[1] - q[0] * p[1]
  }
  return sum
}
