import { exteriorWallLoops } from '../../lib/exterior-wall-loops'
import type { SpaceBoundaryFace } from '../../lib/room-graph'
import type { AnyNode, AnyNodeId, WallNode } from '../../schema'

export type WallLoopScope = 'interior' | 'exterior'

/** Resolve the clicked perimeter; interior/exterior choose its inward/outward faces. */
export function resolveWallLoop(
  nodes: Record<AnyNodeId, AnyNode>,
  wallId: WallNode['id'],
  scope: WallLoopScope,
  joinTolerance?: number,
) {
  const seed = nodes[wallId]
  if (seed?.type !== 'wall' || !seed.parentId) throw Error('Select a wall on a closed loop.')
  const walls = Object.values(nodes).filter(
    (n): n is WallNode => n.type === 'wall' && n.parentId === seed.parentId && n.visible !== false,
  )
  const matches = exteriorWallLoops(walls, joinTolerance).filter((loop) =>
    loop.some((b) => b.wallId === wallId),
  )
  if (!matches.length) throw Error('This wall is not on a closed exterior perimeter.')
  if (matches.length !== 1) throw Error('The perimeter is ambiguous at this wall junction.')
  const boundary: SpaceBoundaryFace[] = matches[0]!.map((b) => ({
    ...b,
    face: scope === 'exterior' ? b.face : b.face === 'front' ? 'back' : 'front',
  }))
  const ids = [...new Set(boundary.map((b) => b.wallId))]
  return { walls: ids.map((id) => nodes[id] as WallNode), boundary, surface: scope }
}
