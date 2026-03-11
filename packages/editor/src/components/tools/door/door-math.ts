import { type AnyNodeId, type DoorNode, getScaledDimensions, type ItemNode, useScene, type WallNode, type WindowNode } from '@pascal-app/core'

/**
 * Converts wall-local (X along wall, Y = height above wall base) to world XYZ.
 */
export function wallLocalToWorld(
  wallNode: WallNode,
  localX: number,
  localY: number,
  levelYOffset = 0,
  slabElevation = 0,
): [number, number, number] {
  const wallAngle = Math.atan2(
    wallNode.end[1] - wallNode.start[1],
    wallNode.end[0] - wallNode.start[0],
  )
  return [
    wallNode.start[0] + localX * Math.cos(wallAngle),
    slabElevation + localY + levelYOffset,
    wallNode.start[1] + localX * Math.sin(wallAngle),
  ]
}

/**
 * Clamps door center X so it stays fully within wall bounds.
 * Y is always height/2 — doors sit at floor level.
 */
export function clampToWall(
  wallNode: WallNode,
  localX: number,
  width: number,
  height: number,
): { clampedX: number; clampedY: number } {
  const dx = wallNode.end[0] - wallNode.start[0]
  const dz = wallNode.end[1] - wallNode.start[1]
  const wallLength = Math.sqrt(dx * dx + dz * dz)

  const clampedX = Math.max(width / 2, Math.min(wallLength - width / 2, localX))
  const clampedY = height / 2  // Doors always sit at floor level
  return { clampedX, clampedY }
}

/**
 * Checks if a proposed door position overlaps any existing wall children.
 * Handles item, window, and door types.
 */
export function hasWallChildOverlap(
  wallId: string,
  clampedX: number,
  clampedY: number,
  width: number,
  height: number,
  ignoreId?: string,
): boolean {
  const nodes = useScene.getState().nodes
  const wallNode = nodes[wallId as AnyNodeId] as WallNode | undefined
  if (!wallNode) return true
  const halfW = width / 2
  const halfH = height / 2
  const newBottom = clampedY - halfH
  const newTop = clampedY + halfH
  const newLeft = clampedX - halfW
  const newRight = clampedX + halfW

  for (const childId of wallNode.children) {
    if (childId === ignoreId) continue
    const child = nodes[childId as AnyNodeId]
    if (!child) continue

    let childLeft: number, childRight: number, childBottom: number, childTop: number

    if (child.type === 'item') {
      const item = child as ItemNode
      if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') continue
      const [w, h] = getScaledDimensions(item)
      childLeft = item.position[0] - w / 2
      childRight = item.position[0] + w / 2
      childBottom = item.position[1]
      childTop = item.position[1] + h
    } else if (child.type === 'window') {
      const win = child as WindowNode
      childLeft = win.position[0] - win.width / 2
      childRight = win.position[0] + win.width / 2
      childBottom = win.position[1] - win.height / 2
      childTop = win.position[1] + win.height / 2
    } else if (child.type === 'door') {
      const door = child as DoorNode
      childLeft = door.position[0] - door.width / 2
      childRight = door.position[0] + door.width / 2
      childBottom = door.position[1] - door.height / 2
      childTop = door.position[1] + door.height / 2
    } else {
      continue
    }

    const xOverlap = newLeft < childRight && newRight > childLeft
    const yOverlap = newBottom < childTop && newTop > childBottom
    if (xOverlap && yOverlap) return true
  }

  return false
}
