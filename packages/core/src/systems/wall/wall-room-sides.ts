import { extractRooms, WALL_JUNCTION_TOLERANCE } from '../../lib/room-graph'
import type { BoundaryNode } from '../../lib/room-topology-index'
import type { SceneNodes } from '../../lib/structure-kernel'

/** How much of a wall face rooms stand on: none of it, part of it, or all of it. */
export type RoomFaceCover = 'none' | 'part' | 'whole'

/**
 * How much of each face of a wall its rooms stand on: one face for an outside wall, both for a
 * partition, part of a face where the wall runs on past its rooms (into a garden, say). A gap under
 * the junction tolerance is no gap.
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
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const slack = length > 0 ? WALL_JUNCTION_TOLERANCE / length : 1
  const cover = (face: 'a' | 'b'): RoomFaceCover => {
    const onFace = spans.filter((span) => span.face === face).sort((p, q) => p.t0 - q.t0)
    if (!onFace.length) return 'none'
    let reach = 0
    for (const span of onFace) {
      if (span.t0 > reach + slack) return 'part'
      reach = Math.max(reach, span.t1)
    }
    return reach >= 1 - slack ? 'whole' : 'part'
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
