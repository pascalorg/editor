import { extractRooms, WALL_JUNCTION_TOLERANCE } from '../../lib/room-graph'
import type { BoundaryNode } from '../../lib/room-topology-index'
import type { SceneNodes } from '../../lib/structure-kernel'
import type { WallNode } from '../../schema'
import { sampleWallCenterline } from './wall-curve'

/**
 * Metres along a wall's reference line at a station of its chord, as room spans give them: on a
 * curve the chord's stations crowd toward the ends, where a short stretch of chord is a long one
 * of wall.
 */
function metresAlong(wall: WallNode): (t: number) => number {
  const [x0, z0] = wall.start
  const [dx, dz] = [wall.end[0] - x0, wall.end[1] - z0]
  const chord2 = dx * dx + dz * dz
  const points = sampleWallCenterline(wall, 96)
  let run = 0
  const stations = points.map((point, index) => {
    const before = points[index - 1]
    if (before) run += Math.hypot(point.x - before.x, point.y - before.y)
    return { t: ((point.x - x0) * dx + (point.y - z0) * dz) / chord2, metres: run }
  })
  return (t) => {
    const next = stations.findIndex((station) => station.t >= t)
    if (next <= 0) return next === 0 ? 0 : run
    const [a, b] = [stations[next - 1]!, stations[next]!]
    return a.metres + ((b.metres - a.metres) * (t - a.t)) / (b.t - a.t || 1)
  }
}

/** How much of a wall face rooms stand on: none of it, part of it, or all of it. */
export type RoomFaceCover = 'none' | 'part' | 'whole'

/**
 * How much of each face of a wall its rooms stand on: one face for an outside wall, both for a
 * partition, part of a face where the wall runs on past its rooms (into a garden, say). A gap shorter
 * than the junction tolerance, measured along the wall, is no gap.
 */
export function roomFaceCover(nodes: SceneNodes, wallId: string): Record<'a' | 'b', RoomFaceCover> {
  const wall = nodes[wallId]
  if (wall?.type !== 'wall') throw Error('Select a wall.')
  const boundaries = Object.values(nodes).filter(
    (node): node is BoundaryNode =>
      node.parentId === wall.parentId && (node.type === 'wall' || node.type === 'separator'),
  )
  const spans = extractRooms(boundaries).flatMap((room) =>
    room.spans.filter((span) => span.boundaryId === wallId && span.t1 > span.t0),
  )
  const along = metresAlong(wall)
  const gap = (from: number, to: number) => along(to) - along(from) > WALL_JUNCTION_TOLERANCE
  const cover = (face: 'a' | 'b'): RoomFaceCover => {
    const onFace = spans.filter((span) => span.face === face).sort((p, q) => p.t0 - q.t0)
    if (!onFace.length) return 'none'
    let reach = 0
    for (const span of onFace) {
      if (gap(reach, span.t0)) return 'part'
      reach = Math.max(reach, span.t1)
    }
    return gap(reach, 1) ? 'part' : 'whole'
  }
  return { a: cover('a'), b: cover('b') }
}

export function roomSideFaces(
  nodes: SceneNodes,
  wallId: string,
): { inside: 'a' | 'b' | null; outside: 'a' | 'b' | null } {
  const cover = roomFaceCover(nodes, wallId)
  const sides = (['a', 'b'] as const).filter((face) => cover[face] !== 'none')
  if (sides.length !== 1) return { inside: null, outside: null }
  const inside = sides[0]!
  return { inside, outside: inside === 'a' ? 'b' : 'a' }
}
