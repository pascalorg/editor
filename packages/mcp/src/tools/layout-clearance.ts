/**
 * Shared plan-layout clearance for MCP tools.
 *
 * - Door keep-outs (re-exports / wraps door-clearance)
 * - Item–item AABB overlap (rotation-aware)
 * - Placement candidate search when primary pose is blocked
 *
 * Used by furnish_room, verify_scene, and check_collisions.
 */

import type { AnyNode } from '@pascal-app/core/schema'
import {
  aabbsOverlap,
  collectDoorKeepouts,
  findBlockedDoors,
  itemPlanAabb,
  type PlanAabb,
} from './door-clearance'

export {
  aabbsOverlap,
  collectDoorKeepouts,
  findBlockedDoors,
  itemPlanAabb,
  type PlanAabb,
} from './door-clearance'

/** Minimum gap (m) between item footprints (soft buffer). */
export const DEFAULT_ITEM_GAP = 0.08

export type OccupiedFootprint = {
  id: string
  name?: string
  aabb: PlanAabb
}

export type ItemCollision = {
  aId: string
  bId: string
  aName?: string
  bName?: string
  kind: 'item-aabb'
  message: string
}

export function nodeItemAabb(node: AnyNode): PlanAabb | null {
  if (node.type !== 'item') return null
  const dims = node.asset?.dimensions as number[] | undefined
  const rotY = Array.isArray(node.rotation) ? (node.rotation[1] ?? 0) : 0
  const pos = node.position as number[]
  return itemPlanAabb(pos, dims, rotY)
}

export function collectOccupiedFootprints(
  nodes: Iterable<AnyNode>,
  options?: { levelId?: string; excludeIds?: Set<string>; floorOnly?: boolean },
): OccupiedFootprint[] {
  const out: OccupiedFootprint[] = []
  for (const node of nodes) {
    if (node.type !== 'item') continue
    if (options?.excludeIds?.has(node.id)) continue
    const attach = node.asset?.attachTo
    if (
      options?.floorOnly &&
      (attach === 'wall' || attach === 'wall-side' || attach === 'ceiling')
    ) {
      continue
    }
    if (options?.levelId && node.parentId && node.parentId !== options.levelId) {
      // Floor packing only uses level-parented items (not wall children).
      if (options.floorOnly) continue
    }
    const aabb = nodeItemAabb(node)
    if (!aabb) continue
    const name = node.name ?? node.asset?.name
    out.push({
      id: node.id,
      name: typeof name === 'string' ? name : undefined,
      aabb,
    })
  }
  return out
}

export function findItemItemCollisions(args: {
  nodes: Iterable<AnyNode>
  levelId?: string
  gap?: number
}): ItemCollision[] {
  const gap = args.gap ?? DEFAULT_ITEM_GAP
  const footprints = collectOccupiedFootprints(args.nodes, { levelId: args.levelId })
  const collisions: ItemCollision[] = []
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i]!
      const b = footprints[j]!
      if (!aabbsOverlap(a.aabb, b.aabb, gap)) continue
      collisions.push({
        aId: a.id,
        bId: b.id,
        aName: a.name,
        bName: b.name,
        kind: 'item-aabb',
        message: `Items overlap: ${a.name ?? a.id} (${a.id}) and ${b.name ?? b.id} (${b.id})`,
      })
    }
  }
  return collisions
}

export type PlacementCandidate = {
  x: number
  z: number
  rotationDeg: number
}

export type PlacementRejectReason =
  | 'outside_bounds'
  | 'blocks_door_clearance'
  | 'overlaps_item'
  | 'ok'

export function classifyPlacement(args: {
  aabb: PlanAabb
  doorKeepouts: PlanAabb[]
  occupied: PlanAabb[]
  roomBounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  padding?: number
  itemGap?: number
  doorGap?: number
}): PlacementRejectReason {
  const padding = args.padding ?? 0.05
  const itemGap = args.itemGap ?? DEFAULT_ITEM_GAP
  const doorGap = args.doorGap ?? 0.02
  if (args.roomBounds) {
    const b = args.roomBounds
    if (
      args.aabb.minX < b.minX + padding ||
      args.aabb.maxX > b.maxX - padding ||
      args.aabb.minZ < b.minZ + padding ||
      args.aabb.maxZ > b.maxZ - padding
    ) {
      return 'outside_bounds'
    }
  }
  if (args.doorKeepouts.some((k) => aabbsOverlap(args.aabb, k, doorGap))) {
    return 'blocks_door_clearance'
  }
  if (args.occupied.some((o) => aabbsOverlap(args.aabb, o, itemGap))) {
    return 'overlaps_item'
  }
  return 'ok'
}

/**
 * Generate alternate poses around a primary placement (lateral + inset nudges).
 * Used when the first pose hits a door or another item.
 */
export function generatePlacementCandidates(
  primary: PlacementCandidate,
  options?: {
    lateralsM?: number[]
    insetsM?: number[]
    /** Unit vector "into room" for inset (away from back wall). */
    inward?: { x: number; z: number }
    /** Unit vector along the furniture wall. */
    along?: { x: number; z: number }
  },
): PlacementCandidate[] {
  const laterals = options?.lateralsM ?? [0, -0.4, 0.4, -0.8, 0.8, -1.2, 1.2]
  const insets = options?.insetsM ?? [0, 0.25, 0.5, 0.75]
  const along = options?.along ?? { x: 1, z: 0 }
  const inward = options?.inward ?? { x: 0, z: 1 }
  const out: PlacementCandidate[] = []
  const seen = new Set<string>()
  for (const lat of laterals) {
    for (const inset of insets) {
      const x = primary.x + along.x * lat + inward.x * inset
      const z = primary.z + along.z * lat + inward.z * inset
      const key = `${x.toFixed(3)},${z.toFixed(3)},${primary.rotationDeg}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ x, z, rotationDeg: primary.rotationDeg })
    }
  }
  return out
}

export function findValidPlacement(args: {
  primary: PlacementCandidate
  dimensions: [number, number, number] | number[] | undefined
  doorKeepouts: PlanAabb[]
  occupied: PlanAabb[]
  roomBounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  along?: { x: number; z: number }
  inward?: { x: number; z: number }
}): { candidate: PlacementCandidate; reason: PlacementRejectReason } | { candidate: null; reason: PlacementRejectReason } {
  const candidates = generatePlacementCandidates(args.primary, {
    along: args.along,
    inward: args.inward,
  })
  let lastReason: PlacementRejectReason = 'overlaps_item'
  for (const c of candidates) {
    const rot = (c.rotationDeg * Math.PI) / 180
    const aabb = itemPlanAabb([c.x, 0, c.z], args.dimensions, rot)
    const reason = classifyPlacement({
      aabb,
      doorKeepouts: args.doorKeepouts,
      occupied: args.occupied,
      roomBounds: args.roomBounds,
    })
    if (reason === 'ok') return { candidate: c, reason }
    lastReason = reason
  }
  return { candidate: null, reason: lastReason }
}

export function layoutIssuesFromScene(nodes: Iterable<AnyNode>): string[] {
  const list = [...nodes]
  const issues: string[] = []
  for (const b of findBlockedDoors({ nodes: list })) {
    issues.push(b.message)
  }
  for (const c of findItemItemCollisions({ nodes: list })) {
    issues.push(c.message)
  }
  return issues
}
