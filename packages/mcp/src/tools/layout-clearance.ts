/**
 * Shared plan-layout clearance for MCP tools.
 *
 * - Door keep-outs (level-scoped)
 * - Item–item AABB overlap (rotation + scale aware)
 * - Placement candidate search when primary pose is blocked
 *
 * See docs/layout-clearance-error-log.md for regression checklist.
 */

import type { AnyNode } from '@pascal-app/core/schema'
import {
  aabbsOverlap,
  collectDoorKeepouts,
  findBlockedDoors,
  itemNodePlanAabb,
  itemPlanAabb,
  resolveNodeLevelId,
  type PlanAabb,
} from './door-clearance'

export {
  aabbsOverlap,
  collectDoorKeepouts,
  findBlockedDoors,
  itemNodePlanAabb,
  itemPlanAabb,
  resolveNodeLevelId,
  type PlanAabb,
} from './door-clearance'

/** Minimum free space (m) required between item footprints. */
export const DEFAULT_ITEM_GAP = 0.08

export type OccupiedFootprint = {
  id: string
  name?: string
  levelId?: string | null
  aabb: PlanAabb
}

export type ItemCollision = {
  aId: string
  bId: string
  aName?: string
  bName?: string
  levelId?: string | null
  kind: 'item-aabb'
  message: string
}

export function nodeItemAabb(node: AnyNode): PlanAabb | null {
  return itemNodePlanAabb(node)
}

export function collectOccupiedFootprints(
  nodes: Iterable<AnyNode>,
  options?: { levelId?: string; excludeIds?: Set<string>; floorOnly?: boolean },
): OccupiedFootprint[] {
  const list = [...nodes]
  const byId = new Map(list.map((n) => [n.id, n] as const))
  const out: OccupiedFootprint[] = []
  for (const node of list) {
    if (node.type !== 'item') continue
    if (options?.excludeIds?.has(node.id)) continue
    const attach = node.asset?.attachTo
    if (
      options?.floorOnly &&
      (attach === 'wall' || attach === 'wall-side' || attach === 'ceiling')
    ) {
      continue
    }
    const levelId = resolveNodeLevelId(node.id, byId)
    if (options?.levelId && levelId !== options.levelId) continue
    // Floor packing: prefer level-parented items (not wall-hosted children).
    if (options?.floorOnly && node.parentId && levelId && node.parentId !== levelId) {
      if (attach === 'wall' || attach === 'wall-side' || attach === 'ceiling') continue
      // Wall-parented items without attachTo still skipped for floor packing.
      if (byId.get(node.parentId)?.type === 'wall') continue
    }
    const aabb = nodeItemAabb(node)
    if (!aabb) continue
    const name = node.name ?? node.asset?.name
    out.push({
      id: node.id,
      name: typeof name === 'string' ? name : undefined,
      levelId,
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
      if (a.levelId && b.levelId && a.levelId !== b.levelId) continue
      if (!aabbsOverlap(a.aabb, b.aabb, gap)) continue
      collisions.push({
        aId: a.id,
        bId: b.id,
        aName: a.name,
        bName: b.name,
        levelId: a.levelId ?? b.levelId,
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

export function generatePlacementCandidates(
  primary: PlacementCandidate,
  options?: {
    lateralsM?: number[]
    insetsM?: number[]
    inward?: { x: number; z: number }
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
}):
  | { candidate: PlacementCandidate; reason: PlacementRejectReason }
  | { candidate: null; reason: PlacementRejectReason } {
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

/**
 * Collect layout issues, scoped per level so stacked floors do not false-positive.
 */
export function layoutIssuesFromScene(nodes: Iterable<AnyNode>): string[] {
  const list = [...nodes]
  const byId = new Map(list.map((n) => [n.id, n] as const))
  const levelIds = new Set<string>()
  for (const n of list) {
    if (n.type === 'level') levelIds.add(n.id)
  }
  // Also collect levels referenced by walls/items (in case filter missed)
  for (const n of list) {
    const lid = resolveNodeLevelId(n.id, byId)
    if (lid) levelIds.add(lid)
  }

  const issues: string[] = []
  const levels = levelIds.size > 0 ? [...levelIds] : [undefined]

  for (const levelId of levels) {
    for (const b of findBlockedDoors({ nodes: list, levelId })) {
      issues.push(b.message)
    }
    for (const c of findItemItemCollisions({ nodes: list, levelId })) {
      issues.push(c.message)
    }
  }

  // Deduplicate (node may appear under multiple walks)
  return [...new Set(issues)]
}
