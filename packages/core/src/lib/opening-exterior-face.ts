import type { AnyNode, WallFace, WindowNode } from '../schema'
import { roomSideFaces } from '../systems/wall/wall-room-sides'

type Opening = Pick<
  WindowNode,
  'parentId' | 'wallId' | 'roofSegmentId' | 'dormerId' | 'side' | 'rotation'
>

/** The unoccupied face; ambiguous walls retain the placement face. Generated roof faces face out on a. */
export function openingExteriorFace(
  opening: Opening,
  nodes: Readonly<Record<string, AnyNode>>,
): WallFace {
  if (opening.roofSegmentId || opening.dormerId) return 'a'
  const wallId = opening.wallId ?? opening.parentId
  if (wallId && nodes[wallId]?.type === 'wall') {
    const outside = roomSideFaces(nodes, wallId).outside
    if (outside) return outside
  }
  if (opening.side) return opening.side === 'front' ? 'a' : 'b'
  return Math.cos(opening.rotation?.[1] ?? 0) >= 0 ? 'a' : 'b'
}
