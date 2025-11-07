import { type ClassValue, clsx } from 'clsx';
import { customAlphabet } from 'nanoid';
import { twMerge } from 'tailwind-merge';
import type { WallNode } from './nodes/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)
export const createId = (prefix?: string) => `${prefix ? `${prefix}_` : ''}${nanoid()}`


export function worldPositionToGrid(position: [number, number, number], { gridSize, tileSize }: {
  gridSize: number
  tileSize: number
}): [number, number] {
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
  itemWidth: number = 2
): boolean {
  const itemPosition = item.position

  // Calculate wall direction
  const [x1, y1] = wall.position
  const length = wall.size[0]
  const x2 = x1 + Math.cos(wall.rotation) * length
  const y2 = y1 - Math.sin(wall.rotation) * length

  const dx = x2 - x1
  const dz = y2 - y1
  const wallLength = Math.sqrt(dx * dx + dz * dz)
  const wallDirX = dx / wallLength
  const wallDirZ = dz / wallLength

  // Calculate item's 3 grid points: center + 2 endpoints
  const itemCenter = itemPosition
  const itemEndpoint1: [number, number] = [
    itemCenter[0] + Math.round(wallDirX),
    itemCenter[1] + Math.round(wallDirZ),
  ]
  const itemEndpoint2: [number, number] = [
    itemCenter[0] - Math.round(wallDirX),
    itemCenter[1] - Math.round(wallDirZ),
  ]

  // Check if item fits within wall bounds
  // Calculate distance from wall start to item center along wall direction
  const toItemX = itemCenter[0] - x1
  const toItemZ = itemCenter[1] - y1
  const distanceAlongWall = toItemX * wallDirX + toItemZ * wallDirZ

  // Item needs at least 1 cell on each side of center
  if (distanceAlongWall < 1 || distanceAlongWall > wallLength - 1) {
    return false
  }

  // Check for overlaps with existing doors/windows on the wall
  const itemPoints = [itemEndpoint1, itemEndpoint2, itemCenter]

  for (const child of wall.children) {
    // Skip preview nodes
    if (child.preview) continue

    // Calculate the 3 grid points for existing element
    const childRotation = child.rotation
    const childWallDirX = Math.cos(-childRotation)
    const childWallDirZ = Math.sin(-childRotation)

    const childCenter = child.position
    const childEndpoint1: [number, number] = [
      childCenter[0] + Math.round(childWallDirX),
      childCenter[1] + Math.round(childWallDirZ),
    ]
    const childEndpoint2: [number, number] = [
      childCenter[0] - Math.round(childWallDirX),
      childCenter[1] - Math.round(childWallDirZ),
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
