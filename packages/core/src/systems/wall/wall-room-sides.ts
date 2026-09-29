import { extractRooms } from '../../lib/room-graph'
import type { BoundaryNode } from '../../lib/room-topology-index'
import type { SceneNodes } from '../../lib/structure-kernel'

export function roomSideFaces(
  nodes: SceneNodes,
  wallId: string,
): { inside: 'a' | 'b' | null; outside: 'a' | 'b' | null } {
  const wall = nodes[wallId]
  if (wall?.type !== 'wall') throw Error('Select a wall.')
  const boundaries = Object.values(nodes).filter(
    (node): node is BoundaryNode =>
      node.parentId === wall.parentId && (node.type === 'wall' || node.type === 'separator'),
  )
  const sides = new Set(
    extractRooms(boundaries).flatMap((room) =>
      room.spans
        .filter((span) => span.boundaryId === wallId && span.t1 > span.t0)
        .map((span) => span.face),
    ),
  )
  if (sides.size !== 1) return { inside: null, outside: null }
  const inside = [...sides][0]!
  return { inside, outside: inside === 'a' ? 'b' : 'a' }
}
