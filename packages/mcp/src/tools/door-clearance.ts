/**
 * Door access keep-outs for MCP layout tools.
 *
 * Furniture that overlaps a door clear zone is reported as blocking the door.
 * Used by furnish_room (skip placements) and verify_scene (layout issues).
 *
 * See docs/layout-clearance-error-log.md for pitfalls (levels, gap sign, scale).
 */

import type { AnyNode, WallNode } from '@pascal-app/core/schema'
import { getScaledDimensions } from '@pascal-app/core/schema'
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
  levelId: string | null
  /** World-space AABB on both sides of the wall opening. */
  aabb: PlanAabb
  width: number
  localX: number
}

/** Plan depth (m) cleared on each side of the wall face through the opening. */
export const DEFAULT_DOOR_CLEAR_DEPTH = 0.65
/** Extra half-width (m) beyond the door leaf along the wall. */
export const DEFAULT_DOOR_SIDE_PAD = 0.05

/**
 * True when A and B come closer than `gap` meters (including penetration).
 * `gap` is the **minimum free space required** between boxes:
 * expand each box by gap/2, then test intersection.
 */
export function aabbsOverlap(a: PlanAabb, b: PlanAabb, gap = 0): boolean {
  const g = gap
  return (
    a.maxX + g > b.minX &&
    a.minX - g < b.maxX &&
    a.maxZ + g > b.minZ &&
    a.minZ - g < b.maxZ
  )
}

/**
 * Walk parentId chain to the enclosing level id (pure; no bridge required).
 */
export function resolveNodeLevelId(
  nodeId: string,
  byId: Map<string, AnyNode>,
): string | null {
  let current: AnyNode | undefined = byId.get(nodeId)
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) return null
    seen.add(current.id)
    if (current.type === 'level') return current.id
    const parentId = current.parentId
    if (!parentId) return null
    current = byId.get(parentId)
  }
  return null
}

/**
 * Axis-aligned item footprint in plan (x/z), rotation-aware.
 * Prefer scaled dimensions when the node is available.
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

/** Footprint for a scene item node (uses getScaledDimensions). */
export function itemNodePlanAabb(node: AnyNode): PlanAabb | null {
  if (node.type !== 'item') return null
  const [w, , d] = getScaledDimensions(node)
  const rotY = Array.isArray(node.rotation) ? (node.rotation[1] ?? 0) : 0
  return itemPlanAabb(node.position as number[], [w, 0, d], rotY)
}

/**
 * Build a rectangular keep-out around a wall door, extruded perpendicular to the wall
 * on both faces so either swing side is protected.
 */
export function doorKeepoutFromWall(
  wall: Pick<WallNode, 'id' | 'start' | 'end'>,
  door: Pick<AnyNode, 'id' | 'position' | 'width'> & { type?: string },
  options?: { clearDepth?: number; sidePad?: number; levelId?: string | null },
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
    levelId: options?.levelId ?? null,
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
  options?: { clearDepth?: number; sidePad?: number; levelId?: string },
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
    const levelId = resolveNodeLevelId(wall.id, byId) ?? resolveNodeLevelId(node.id, byId)
    if (options?.levelId && levelId !== options.levelId) continue
    const keepout = doorKeepoutFromWall(wall, node, {
      clearDepth: options?.clearDepth,
      sidePad: options?.sidePad,
      levelId,
    })
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
  levelId?: string | null
  itemName?: string
  message: string
}

export function findBlockedDoors(args: {
  nodes: Iterable<AnyNode>
  clearDepth?: number
  sidePad?: number
  /** When set, only doors and items on this level are considered. */
  levelId?: string
}): BlockedDoorIssue[] {
  const nodes = [...args.nodes]
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const keepouts = collectDoorKeepouts(nodes, {
    clearDepth: args.clearDepth,
    sidePad: args.sidePad,
    levelId: args.levelId,
  })
  if (keepouts.length === 0) return []

  const issues: BlockedDoorIssue[] = []
  for (const node of nodes) {
    if (node.type !== 'item') continue
    const itemLevel = resolveNodeLevelId(node.id, byId)
    if (args.levelId && itemLevel !== args.levelId) continue

    const aabb = itemNodePlanAabb(node)
    if (!aabb) continue

    for (const keepout of keepouts) {
      // Same-level only (multi-story safety).
      if (keepout.levelId && itemLevel && keepout.levelId !== itemLevel) continue
      if (args.levelId && keepout.levelId && keepout.levelId !== args.levelId) continue
      if (!itemBlocksDoorKeepout(aabb, keepout)) continue
      const itemName = node.name ?? node.asset?.name ?? node.id
      issues.push({
        doorId: keepout.doorId,
        wallId: keepout.wallId,
        itemId: node.id,
        levelId: itemLevel,
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

/**
 * Whether an existing keep-out already covers this room-edge planned zone
 * (so we do not double-count a real door on that edge).
 *
 * Requires the planned keep-out **center** to lie inside the existing keep-out,
 * and the existing box to cover a large fraction of the planned area.
 * Plain AABB overlap is not enough (nearby hallway doors must not suppress
 * this room's entrance keep-out).
 */
export function keepoutCoversPlanned(existing: PlanAabb, planned: PlanAabb): boolean {
  const cx = (planned.minX + planned.maxX) / 2
  const cz = (planned.minZ + planned.maxZ) / 2
  const centerInside =
    cx >= existing.minX &&
    cx <= existing.maxX &&
    cz >= existing.minZ &&
    cz <= existing.maxZ
  if (!centerInside) return false

  // Intersection area / planned area must be substantial (same opening, not a glancing touch).
  const ix0 = Math.max(existing.minX, planned.minX)
  const ix1 = Math.min(existing.maxX, planned.maxX)
  const iz0 = Math.max(existing.minZ, planned.minZ)
  const iz1 = Math.min(existing.maxZ, planned.maxZ)
  if (ix1 <= ix0 || iz1 <= iz0) return false
  const inter = (ix1 - ix0) * (iz1 - iz0)
  const plannedArea = Math.max(
    1e-9,
    (planned.maxX - planned.minX) * (planned.maxZ - planned.minZ),
  )
  return inter / plannedArea >= 0.5
}

export function aabbFromPlan(a: PlanAabb): PlanAabb {
  return a
}
