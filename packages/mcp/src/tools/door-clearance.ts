/**
 * Door access keep-outs for MCP layout tools.
 *
 * Furniture that overlaps a door clear zone is reported as blocking the door.
 * Used by furnish_room (skip placements) and verify_scene (layout issues).
 */

import type { AnyNode, WallNode } from '@pascal-app/core/schema'
import { wallLength, type Vec2 } from './geometry'

export type PlanAabb = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type DoorKeepout = {
  doorId: string
  wallId: string
  /** World-space AABB on both sides of the wall opening. */
  aabb: PlanAabb
  width: number
  localX: number
}

/** Plan depth (m) cleared on each side of the wall face through the opening. */
export const DEFAULT_DOOR_CLEAR_DEPTH = 0.65
/** Extra half-width (m) beyond the door leaf along the wall. */
export const DEFAULT_DOOR_SIDE_PAD = 0.05

function aabbsOverlap(a: PlanAabb, b: PlanAabb, gap = 0): boolean {
  return (
    a.maxX - gap > b.minX &&
    a.minX + gap < b.maxX &&
    a.maxZ - gap > b.minZ &&
    a.minZ + gap < b.maxZ
  )
}

/**
 * Axis-aligned item footprint in plan (x/z), matching furnish_room rotation handling.
 */
export function itemPlanAabb(
  position: [number, number, number] | number[],
  dimensions: [number, number, number] | number[] | undefined,
  rotationYRad = 0,
): PlanAabb {
  const x = position[0] ?? 0
  const z = position[2] ?? 0
  const [w = 1, , d = 1] = dimensions ?? [1, 1, 1]
  const cos = Math.abs(Math.cos(rotationYRad))
  const sin = Math.abs(Math.sin(rotationYRad))
  const halfW = (w * cos + d * sin) / 2
  const halfD = (w * sin + d * cos) / 2
  return {
    minX: x - halfW,
    maxX: x + halfW,
    minZ: z - halfD,
    maxZ: z + halfD,
  }
}

/**
 * Build a rectangular keep-out around a wall door, extruded perpendicular to the wall
 * on both faces so either swing side is protected.
 */
export function doorKeepoutFromWall(
  wall: Pick<WallNode, 'id' | 'start' | 'end'>,
  door: Pick<AnyNode, 'id' | 'position' | 'width'> & { type?: string },
  options?: { clearDepth?: number; sidePad?: number },
): DoorKeepout | null {
  const clearDepth = options?.clearDepth ?? DEFAULT_DOOR_CLEAR_DEPTH
  const sidePad = options?.sidePad ?? DEFAULT_DOOR_SIDE_PAD
  const length = wallLength(wall)
  if (length <= 1e-6) return null

  const width = typeof door.width === 'number' && door.width > 0 ? door.width : 0.9
  const localX = Array.isArray(door.position) ? (door.position[0] ?? length / 2) : length / 2

  const [sx, sz] = wall.start
  const [ex, ez] = wall.end
  const dx = (ex - sx) / length
  const dz = (ez - sz) / length
  // Perpendicular in plan (rotate tangent 90°): (dx,dz) -> (-dz, dx)
  const nx = -dz
  const nz = dx

  const half = width / 2 + sidePad
  const corners: Vec2[] = []
  for (const along of [localX - half, localX + half]) {
    const cx = sx + dx * along
    const cz = sz + dz * along
    for (const side of [-clearDepth, clearDepth]) {
      corners.push([cx + nx * side, cz + nz * side])
    }
  }

  const xs = corners.map((c) => c[0])
  const zs = corners.map((c) => c[1])
  return {
    doorId: door.id,
    wallId: wall.id,
    width,
    localX,
    aabb: {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    },
  }
}

export function collectDoorKeepouts(
  nodes: Iterable<AnyNode>,
  options?: { clearDepth?: number; sidePad?: number },
): DoorKeepout[] {
  const byId = new Map<string, AnyNode>()
  for (const node of nodes) byId.set(node.id, node)

  const keepouts: DoorKeepout[] = []
  for (const node of byId.values()) {
    if (node.type !== 'door') continue
    const wallId = node.wallId ?? node.parentId
    if (!wallId) continue
    const wall = byId.get(wallId)
    if (!wall || wall.type !== 'wall') continue
    const keepout = doorKeepoutFromWall(wall, node, options)
    if (keepout) keepouts.push(keepout)
  }
  return keepouts
}

export function itemBlocksDoorKeepout(itemAabb: PlanAabb, keepout: DoorKeepout): boolean {
  return aabbsOverlap(itemAabb, keepout.aabb, 0.02)
}

export type BlockedDoorIssue = {
  doorId: string
  wallId: string
  itemId: string
  itemName?: string
  message: string
}

export function findBlockedDoors(args: {
  nodes: Iterable<AnyNode>
  clearDepth?: number
  sidePad?: number
}): BlockedDoorIssue[] {
  const nodes = [...args.nodes]
  const keepouts = collectDoorKeepouts(nodes, {
    clearDepth: args.clearDepth,
    sidePad: args.sidePad,
  })
  if (keepouts.length === 0) return []

  const issues: BlockedDoorIssue[] = []
  for (const node of nodes) {
    if (node.type !== 'item') continue
    const dims = node.asset?.dimensions as number[] | undefined
    const rotY = Array.isArray(node.rotation) ? (node.rotation[1] ?? 0) : 0
    const aabb = itemPlanAabb(node.position as number[], dims, rotY)
    for (const keepout of keepouts) {
      if (!itemBlocksDoorKeepout(aabb, keepout)) continue
      const itemName = node.name ?? node.asset?.name ?? node.id
      issues.push({
        doorId: keepout.doorId,
        wallId: keepout.wallId,
        itemId: node.id,
        itemName: typeof itemName === 'string' ? itemName : undefined,
        message: `Door ${keepout.doorId} on wall ${keepout.wallId} is blocked by item ${itemName} (${node.id})`,
      })
    }
  }
  return issues
}

/**
 * Synthetic keep-outs for a room polygon edge that will host a door (before doors exist).
 * Used by furnish_room when doorWallIndex is known.
 */
export function keepoutForPolygonEdge(
  polygon: Vec2[],
  edgeIndex: number,
  options?: { t?: number; width?: number; clearDepth?: number; sidePad?: number },
): PlanAabb | null {
  if (polygon.length < 3) return null
  const i = ((edgeIndex % polygon.length) + polygon.length) % polygon.length
  const start = polygon[i]!
  const end = polygon[(i + 1) % polygon.length]!
  const wall = {
    id: `edge-${i}`,
    start,
    end,
  }
  const length = wallLength(wall)
  if (length <= 1e-6) return null
  const width = options?.width ?? 0.9
  const t = options?.t ?? 0.5
  const localX = Math.min(Math.max(t * length, width / 2), length - width / 2)
  const keepout = doorKeepoutFromWall(
    wall,
    {
      id: `planned-door-${i}`,
      position: [localX, 1.05, 0],
      width,
    },
    { clearDepth: options?.clearDepth, sidePad: options?.sidePad },
  )
  return keepout?.aabb ?? null
}

export function aabbFromPlan(a: PlanAabb): PlanAabb {
  return a
}

export { aabbsOverlap }
