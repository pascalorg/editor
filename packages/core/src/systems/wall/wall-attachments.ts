import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  getScaledDimensions,
  type ItemNode,
  type WallNode,
  type WindowNode,
} from '../../schema'
import { getWallArcData, getWallCurveFrameAt, getWallCurveLength, isCurvedWall } from './wall-curve'
import type { WallPlanPoint } from './wall-move'

const WALL_INTERSECTION_EPSILON = 1e-6

export function wallLength(wall: WallNode) {
  return isCurvedWall(wall)
    ? getWallCurveLength(wall)
    : Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

export function wallPointAt(wall: WallNode, wallT: number): WallPlanPoint {
  if (wallT <= WALL_INTERSECTION_EPSILON) return wall.start
  if (wallT >= 1 - WALL_INTERSECTION_EPSILON) return wall.end
  const frame = getWallCurveFrameAt(wall, wallT)
  return [frame.point.x, frame.point.y]
}

export function segmentCurveOffset(wall: WallNode, startT: number, endT: number) {
  const arc = getWallArcData(wall)
  if (!arc) return wall.curveOffset
  const angle = Math.abs(arc.delta) * (endT - startT)
  return arc.direction * arc.radius * (1 - Math.cos(angle / 2))
}

export function getWallAttachmentSpan(
  node: AnyNode,
): { min: number; max: number; center: number } | null {
  if (node.type === 'door') {
    const door = node as DoorNode
    return {
      min: door.position[0] - door.width / 2,
      max: door.position[0] + door.width / 2,
      center: door.position[0],
    }
  }
  if (node.type === 'window') {
    const window = node as WindowNode
    return {
      min: window.position[0] - window.width / 2,
      max: window.position[0] + window.width / 2,
      center: window.position[0],
    }
  }
  if (node.type === 'item') {
    const item = node as ItemNode
    if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') return null
    const [width] = getScaledDimensions(item)
    return {
      min: item.position[0] - width / 2,
      max: item.position[0] + width / 2,
      center: item.position[0],
    }
  }
  return null
}

export function getWallAttachments(wall: WallNode, nodes: Record<AnyNodeId, AnyNode>) {
  const ids = new Set<AnyNodeId>((wall.children ?? []) as AnyNodeId[])
  for (const node of Object.values(nodes)) {
    if (
      node.parentId === wall.id ||
      ('wallId' in node && typeof node.wallId === 'string' && node.wallId === wall.id)
    ) {
      ids.add(node.id)
    }
  }
  return [...ids].flatMap((id) => {
    const node = nodes[id]
    return node ? [node] : []
  })
}

export function remapWallAttachment(
  node: AnyNode,
  wall: WallNode,
  nextLocalX: number,
): Partial<AnyNode> | null {
  if (!(node.type === 'door' || node.type === 'window' || node.type === 'item')) return null
  const nextLength = wallLength(wall)
  const clampedX = Math.max(0, Math.min(nextLength, nextLocalX))
  return {
    parentId: wall.id,
    wallId: wall.id,
    position: [clampedX, node.position[1], node.position[2]],
    ...(node.type === 'item' ? { wallT: nextLength > 1e-6 ? clampedX / nextLength : 0 } : {}),
  } as Partial<AnyNode>
}
