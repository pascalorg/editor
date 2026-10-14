import { extractRooms } from '../../lib/room-graph'
import type { BoundaryNode } from '../../lib/room-topology-index'
import type { SceneNodes } from '../../lib/structure-kernel'

/** The faces of a wall a room stands on: one for an outside wall, both for a partition. */
export function roomFaces(nodes: SceneNodes, wallId: string): Set<'a' | 'b'> {
  const wall = nodes[wallId]
  if (wall?.type !== 'wall') throw Error('Select a wall.')
  const boundaries = Object.values(nodes).filter(
    (node): node is BoundaryNode =>
      node.parentId === wall.parentId && (node.type === 'wall' || node.type === 'separator'),
  )
  return new Set(
    extractRooms(boundaries).flatMap((room) =>
      room.spans
        .filter((span) => span.boundaryId === wallId && span.t1 > span.t0)
        .map((span) => span.face),
    ),
  )
}

export function roomSideFaces(
  nodes: SceneNodes,
  wallId: string,
): { inside: 'a' | 'b' | null; outside: 'a' | 'b' | null } {
  const sides = roomFaces(nodes, wallId)
  if (sides.size !== 1) return { inside: null, outside: null }
  const inside = [...sides][0]!
  return { inside, outside: inside === 'a' ? 'b' : 'a' }
}
