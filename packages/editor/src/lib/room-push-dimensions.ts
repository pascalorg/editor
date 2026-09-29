import {
  type AnyNode,
  type BoundarySpan,
  getWallFaceOffsets,
  isCurvedWall,
  type Point,
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
 * The live dimensions of a wall push: for every room along the pushed stretch,
 * the moving face (the resting face moved `distance` along `outward` — a push
 * is a pure translation) to each facing parallel boundary of that room, read
 * through `resolve` so the preview's geometry counts. Per side of the wall:
 * nearest first, one per distinct distance, at most three.
 */
export function wallPushDimensions({
  rooms,
  wall,
  outward,
  distance,
  resolve,
}: {
  rooms: readonly PushDimensionRoom[]
  wall: WallNode
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
