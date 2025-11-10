import { type ClassValue, clsx } from 'clsx'
import { customAlphabet } from 'nanoid'
import { twMerge } from 'tailwind-merge'
import type { WallNode } from './nodes/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)
export const createId = (prefix?: string) => `${prefix ? `${prefix}_` : ''}${nanoid()}`

export function worldPositionToGrid(
  position: [number, number, number],
  {
    gridSize,
    tileSize,
  }: {
    gridSize: number
    tileSize: number
  },
): [number, number] {
  const localX = position[0] + gridSize / 2
  const localZ = position[2] + gridSize / 2

  // Round to nearest intersection
  const x = Math.round(localX / tileSize)
  const y = Math.round(localZ / tileSize)
  return [x, y]
}

/**
 * Check if a grid item (door, window, etc.) can be placed on a wall
 * @param wall - The wall node to place the item on
 * @param item - The grid item to place (must have position and rotation)
 * @param itemWidth - Width of the item in grid cells (e.g., 2 for doors/windows)
 * @returns true if the item can be placed, false otherwise
 */
export function canPlaceGridItemOnWall(
  wall: WallNode,
  item: { position: [number, number]; rotation: number; preview?: boolean },
  itemWidth = 2,
): boolean {
  // Items are now positioned in wall's LOCAL coordinate system
  // In wall-local space, the wall runs from (0, 0) to (length, 0) along the X-axis
  const wallLength = wall.size[0]
  const itemLocalPos = item.position

  // In wall-local space, the wall direction is always along X-axis
  const wallDirX = 1
  const wallDirZ = 0

  // Check if item's X position (distance along wall) is within wall bounds
  // Item needs at least 1 cell on each side of center
  if (itemLocalPos[0] < 1 || itemLocalPos[0] > wallLength - 1) {
    return false
  }

  // Calculate item's 3 grid points: center + 2 endpoints (in wall-local space)
  const itemCenter = itemLocalPos
  const itemEndpoint1: [number, number] = [
    itemCenter[0] + Math.round(wallDirX),
    itemCenter[1] + Math.round(wallDirZ),
  ]
  const itemEndpoint2: [number, number] = [
    itemCenter[0] - Math.round(wallDirX),
    itemCenter[1] - Math.round(wallDirZ),
  ]

  const itemPoints = [itemEndpoint1, itemEndpoint2, itemCenter]

  // Check for overlaps with existing doors/windows on the wall
  for (const child of wall.children) {
    // Skip preview nodes
    if (child.preview) continue

    // Children are also in wall-local coordinates
    const childCenter = child.position
    const childEndpoint1: [number, number] = [
      childCenter[0] + Math.round(wallDirX),
      childCenter[1] + Math.round(wallDirZ),
    ]
    const childEndpoint2: [number, number] = [
      childCenter[0] - Math.round(wallDirX),
      childCenter[1] - Math.round(wallDirZ),
    ]

    const childPoints = [childEndpoint1, childEndpoint2, childCenter]

    // Count overlapping points
    let overlapCount = 0
    for (const itemPoint of itemPoints) {
      for (const childPoint of childPoints) {
        if (
          Math.abs(itemPoint[0] - childPoint[0]) < 0.01 &&
          Math.abs(itemPoint[1] - childPoint[1]) < 0.01
        ) {
          overlapCount++
        }
      }
    }

    // If 2 or more points overlap, it's a collision
    if (overlapCount >= 2) {
      return false
    }
  }

  return true
}
