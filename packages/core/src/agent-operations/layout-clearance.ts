/**
 * Shared plan-layout clearance for agent tools.
 *
 * - Door keep-outs (level-scoped)
 * - Item–item AABB overlap (rotation + scale aware)
 * - Placement candidate search when primary pose is blocked
 *
 * See packages/mcp/docs/layout-clearance-error-log.md for regression checklist.
 */

import { floorConstructionLift, liftedManualSlab } from '../lib/floor-construction-lift'
import { selectSlabSupportForItem } from '../lib/item-slab-support'
import { getRenderableSlabPolygon } from '../lib/slab-polygon'
import { levelBaseElevationAt } from '../lib/terrain-support-query'
import {
  type Bounds,
  boundsOf,
  boxCorners,
  frame,
  rotateVector,
  transformPoint,
} from '../procedural-items/spatial'
import { type AnyNode, getScaledDimensions, type ItemNode } from '../schema'
import { resolveCeilingHeight } from '../services/level-height'
import { CEILING_DRAW_OFFSET } from '../services/storey'
import {
  aabbsOverlap,
  type BlockedDoorIssue,
  type DoorBlockReading,
  type DoorClearZone,
  type DoorSide,
  findBlockedDoors as findBlockedDoorsByBox,
  itemNodePlanAabb,
  itemNodePlanCorners,
  itemPlanAabb,
  type PlanAabb,
  resolveNodeLevelId,
} from './door-clearance'
import { designedTogether, isFloorUnderlay, isWallDressing, wallBoundWord } from './furniture-kind'
import { type ItemSolid, manifestSolids, relateSolids, type ToLevel } from './item-solids'
import { itemLevelHeightRange, itemLevelPose, itemPlanAabbInLevel } from './item-space'
import {
  axisOverlap,
  type ClearMove,
  clearingMoves,
  describeMoves,
  metres,
  roundBox,
  roundMm,
} from './plan-clearance'
import { distanceToSegment, pointInPolygon, type Vec2 } from './plan-geometry'

export {
  aabbsOverlap,
  collectDoorKeepouts,
  itemNodePlanAabb,
  itemPlanAabb,
  type PlanAabb,
  resolveNodeLevelId,
} from './door-clearance'

import { queryNodes } from './scene-queries'

/** Minimum free space (m) required between item footprints. */
export const DEFAULT_ITEM_GAP = 0.08

export type OccupiedFootprint = {
  id: string
  name?: string
  levelId?: string | null
  aabb: PlanAabb
}

/**
 * How far two items stand in or from each other. Boxes: the depth along the shallower axis and
 * along each, or the gap, with the moves of `a` that leave the clearance. Real shapes (wall
 * panelling): the area they share, or the plan gap between them, and no moves.
 */
export type ItemPairReading =
  | { overlapM: number; overlapAlongM: { x: number; z: number }; clearBy: ClearMove[] }
  | { gapM: number; clearBy: ClearMove[] }
  | { overlapAreaM2: number }
  | { gapM: number }

export type ItemCollision = {
  aId: string
  bId: string
  aName?: string
  bName?: string
  levelId?: string | null
  kind: 'item-aabb'
  violation: 'overlap' | 'clearance'
  minimumClearanceMeters: number
  /** Of a and of b: the boxes the check reads. */
  footprints: [PlanAabb, PlanAabb]
  reading: ItemPairReading
  message: string
}

function boxReading(a: PlanAabb, b: PlanAabb, gap: number): ItemPairReading {
  const shared = axisOverlap(a, b)
  const depth = Math.min(shared.x, shared.z)
  const clearBy = clearingMoves(a, b, gap)
  return depth > 0
    ? {
        overlapM: roundMm(depth),
        overlapAlongM: { x: roundMm(shared.x), z: roundMm(shared.z) },
        clearBy,
      }
    : { gapM: roundMm(-depth), clearBy }
}

function collisionMessage(
  violation: ItemCollision['violation'],
  gap: number,
  [a, b]: [{ id: string; name?: string }, { id: string; name?: string }],
  reading: ItemPairReading,
): string {
  const [first, second] = [a.name ?? a.id, b.name ?? b.id]
  const pair = `${first} (${a.id}) and ${second} (${b.id})`
  const how =
    'overlapAreaM2' in reading
      ? `share ${metres(reading.overlapAreaM2)} m²`
      : 'overlapAlongM' in reading
        ? `by ${metres(reading.overlapAlongM.x)} m along x and ${metres(reading.overlapAlongM.z)} m along z`
        : `are ${metres(reading.gapM)} m apart`
  const lead =
    violation === 'overlap'
      ? `Items overlap: ${pair} ${how}`
      : `Items are closer than ${gap} m: ${pair} ${how}`
  const shapes = 'clearBy' in reading ? 'footprint boxes' : 'real shapes'
  const moves =
    'clearBy' in reading
      ? ` ${first} is ${gap} m clear of ${second}, the gap the check keeps, after ${describeMoves(reading.clearBy)}.`
      : ''
  return `${lead} (${shapes}).${moves}`
}

export function nodeItemAabb(node: AnyNode): PlanAabb | null {
  return itemNodePlanAabb(node)
}

export function collectOccupiedFootprints(
  nodes: Iterable<AnyNode>,
  options?: { levelId?: string; excludeIds?: Set<string>; floorOnly?: boolean },
): OccupiedFootprint[] {
  const list = [...nodes]
  const byId = new Map<string, AnyNode>(list.map((n) => [n.id, n]))
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
    if (levelId && node.parentId === levelId && isFloorUnderlay(node)) continue
    // A wall's children keep wall-local coordinates and are read by the wall observations.
    if (node.parentId && byId.get(node.parentId)?.type === 'wall') continue
    // Floor packing: prefer level-parented items (not ceiling-hosted children).
    if (options?.floorOnly && node.parentId && levelId && node.parentId !== levelId) {
      if (attach === 'wall' || attach === 'wall-side' || attach === 'ceiling') continue
    }
    const aabb = itemPlanAabbInLevel(node, byId)
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

type ItemVerticalInterval = { levelId: string; min: number; max: number }

function finiteVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    [value[0], value[1], value[2]].every(Number.isFinite)
  )
}

function planarRotation(value: unknown): value is [number, number, number] {
  return finiteVec3(value) && value[0] === 0 && value[2] === 0
}

function finiteNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(finiteNumbers)
  if (value && typeof value === 'object') return Object.values(value).every(finiteNumbers)
  return true
}

/** Snapshot counterpart of the item floorPlaced support election; never reads the live grid. */
function itemFloorLift(node: ItemNode, nodes: Record<string, AnyNode>): number {
  // The renderer's item floorPlaced.applies skips corrective surface attachments.
  if (node.asset.attachTo) return 0
  const levelId = node.parentId!
  const ground = () =>
    levelBaseElevationAt(nodes, levelId, node.position[0], node.position[2]) +
    floorConstructionLift(nodes, node)
  if (node.supportSlabId === 'ground') return ground()
  const list = queryNodes(nodes, { type: ['slab', 'wall'] })
  const slabs = list
    .filter(
      (other): other is Extract<AnyNode, { type: 'slab' }> =>
        other.type === 'slab' && other.parentId === levelId,
    )
    .map((slab) => liftedManualSlab(nodes, slab))
  const walls = list.filter((other): other is Extract<AnyNode, { type: 'wall' }> => {
    if (other.type !== 'wall') return false
    let parent = other.parentId ? nodes[other.parentId] : undefined
    for (let depth = 0; parent && parent.type !== 'level' && depth < 16; depth++) {
      parent = parent.parentId ? nodes[parent.parentId] : undefined
    }
    return parent?.type === 'level' && parent.id === levelId
  })
  const support = selectSlabSupportForItem(
    slabs,
    { position: node.position, dimensions: getScaledDimensions(node), rotation: node.rotation },
    (slab) =>
      getRenderableSlabPolygon(slab, {
        walls,
        siblingSlabs: slabs.filter((other) => other.id !== slab.id),
      }),
    { preferredSlabId: node.supportSlabId },
  )
  return support ? support.elevation : ground()
}

/**
 * Only script manifests supply raw bounds for the renderer's corrective asset pose.
 * Catalog dimensions describe a plan box, not proof of the raw model's Y origin.
 */
export function scriptItemBoundsInLevel(
  node: AnyNode | undefined,
  nodes: Record<string, AnyNode>,
): { levelId: string; bounds: Bounds; corners: [number, number, number][] } | undefined {
  if (node?.type !== 'item' || node.roofSegmentId || node.blockFaceId) return
  const bounds = node.source?.manifest?.bounds
  const assetScale = node.asset.scale ?? [1, 1, 1]
  if (
    !bounds ||
    node.source?.manifest?.animations?.length ||
    !finiteVec3(bounds.min) ||
    !finiteVec3(bounds.max) ||
    bounds.min.some((min, axis) => min > bounds.max[axis]!) ||
    !finiteVec3(node.position) ||
    !finiteVec3(node.rotation) ||
    !finiteVec3(node.scale) ||
    node.scale.some((scale) => scale <= 0) ||
    !finiteVec3(node.asset.offset) ||
    !finiteVec3(node.asset.rotation) ||
    !finiteVec3(assetScale) ||
    assetScale.some((scale) => scale <= 0) ||
    !finiteVec3(node.asset.dimensions) ||
    node.asset.dimensions.some((size) => size <= 0)
  )
    return
  const parent = node.parentId ? nodes[node.parentId] : undefined
  const level =
    parent?.type === 'level'
      ? parent
      : parent?.type === 'ceiling' && parent.parentId
        ? nodes[parent.parentId]
        : undefined
  if (level?.type !== 'level' || !finiteNumbers(level) || !finiteNumbers(parent)) return
  try {
    const hostY =
      parent?.type === 'ceiling'
        ? resolveCeilingHeight(parent, nodes) - CEILING_DRAW_OFFSET
        : itemFloorLift(node, nodes)
    const pose = frame(
      [node.position[0], hostY + node.position[1], node.position[2]],
      node.rotation,
    )
    // Match the model groups: corrective asset pose is inside the node-scale group.
    const corners = boxCorners(bounds.min, bounds.max).map((point) => {
      const rotated = rotateVector(
        point.map((value, axis) => value * assetScale[axis]!) as [number, number, number],
        node.asset.rotation,
      )
      return transformPoint(
        pose,
        rotated.map((value, axis) => (value + node.asset.offset[axis]!) * node.scale[axis]!) as [
          number,
          number,
          number,
        ],
      )
    })
    if (corners.every(finiteVec3)) return { levelId: level.id, bounds: boundsOf(corners), corners }
  } catch {
    // Malformed or unsupported support geometry is not evidence of separation.
  }
}

/**
 * Where a script item's own model space stands in its level: maps a point of its manifest (its
 * bounds, parts, surfaces) to the level's frame, through the corrective asset pose and the item's
 * node pose the renderer applies. Undefined where the bounds cannot be resolved.
 */
export function scriptItemToLevel(
  node: ItemNode,
  nodes: Record<string, AnyNode>,
): ((point: [number, number, number]) => [number, number, number]) | undefined {
  const resolved = scriptItemBoundsInLevel(node, nodes)
  const origin = node.source?.manifest.bounds.min
  const corner = resolved?.corners[0]
  if (!(origin && corner)) return
  const corrected = (point: [number, number, number]) => {
    const asset = rotateVector(
      point.map((value, axis) => value * (node.asset.scale?.[axis] ?? 1)) as [
        number,
        number,
        number,
      ],
      node.asset.rotation,
    )
    return rotateVector(
      asset.map(
        (value, axis) => (value + (node.asset.offset[axis] ?? 0)) * (node.scale[axis] ?? 1),
      ) as [number, number, number],
      node.rotation,
    )
  }
  // The elected attachment translation comes from the shared bounds resolver, not a guessed floor Y.
  const first = corrected(origin)
  const shift = corner.map((value, axis) => value - (first[axis] ?? 0))
  return (point) =>
    corrected(point).map((value, axis) => value + shift[axis]!) as [number, number, number]
}

function itemVerticalInterval(
  node: AnyNode | undefined,
  nodes: Record<string, AnyNode>,
): ItemVerticalInterval | undefined {
  // Keep the existing plan-layout evidence limited to yaw-only model poses.
  if (
    node?.type !== 'item' ||
    !planarRotation(node.rotation) ||
    !planarRotation(node.asset.rotation)
  )
    return
  const resolved = scriptItemBoundsInLevel(node, nodes)
  if (resolved)
    return {
      levelId: resolved.levelId,
      min: resolved.bounds.min[1],
      max: resolved.bounds.max[1],
    }
}

/**
 * An item's real shape in its level's frame (see `item-solids`), or null where there is none to read:
 * a script with no faces, a catalogue model, a tilted or animated one. A thing hosted by another item
 * stands at its host chain's pose, on the floor construction under the item at the chain's root.
 */
export function itemSolidsInLevel(
  node: ItemNode,
  nodes: Record<string, AnyNode>,
): ItemSolid[] | null {
  const manifest = node.source?.manifest
  if (
    !manifest ||
    manifest.animations?.length ||
    !planarRotation(node.rotation) ||
    !planarRotation(node.asset.rotation)
  )
    return null
  const direct = scriptItemToLevel(node, nodes)
  const toLevel = direct ?? hostedToLevel(node, nodes)
  if (!toLevel) return null
  try {
    const solids = manifestSolids(manifest, toLevel)
    return solids?.every((solid) => Number.isFinite(solid.y0) && Number.isFinite(solid.y1))
      ? solids
      : null
  } catch {
    // A malformed outline is not evidence of separation: the box reads instead.
    return null
  }
}

/** The map of a manifest point to the level for an item hosted by other items, or undefined. */
function hostedToLevel(node: ItemNode, nodes: Record<string, AnyNode>): ToLevel | undefined {
  // biome-ignore lint/plugin: an item hosted by other items resolves each parent through the whole scene
  const byId = new Map(Object.entries(nodes))
  const pose = itemLevelPose(node, byId)
  if (
    !pose ||
    !node.scale.every((value) => value > 0) ||
    !(node.asset.scale ?? [1, 1, 1]).every((value) => value > 0)
  )
    return
  let root: ItemNode = node
  for (let depth = 0; depth < 16; depth++) {
    const parent = root.parentId ? nodes[root.parentId] : undefined
    if (parent?.type !== 'item') break
    root = parent
  }
  const rootParent = root.parentId ? nodes[root.parentId] : undefined
  if (rootParent?.type !== 'level') return
  const lift = itemFloorLift(root, nodes)
  if (!Number.isFinite(lift)) return
  const assetScale = node.asset.scale ?? [1, 1, 1]
  const turn: [number, number, number] = [node.rotation[0], pose.yawDeg, node.rotation[2]]
  return (point) => {
    const asset = rotateVector(
      point.map((value, axis) => value * assetScale[axis]!) as [number, number, number],
      node.asset.rotation,
    )
    const placed = rotateVector(
      asset.map((value, axis) => (value + node.asset.offset[axis]!) * node.scale[axis]!) as [
        number,
        number,
        number,
      ],
      turn,
    )
    return [
      placed[0] + pose.position[0],
      placed[1] + pose.position[1] + lift,
      placed[2] + pose.position[2],
    ]
  }
}

/**
 * Doors blocked by furniture. An item is its box, as tall as its heights say (a pendant over the door
 * is above its leaf); wall panelling alone is its real strips (see `findItemItemCollisions`).
 */
export function findBlockedDoors(
  args: Parameters<typeof findBlockedDoorsByBox>[0],
): BlockedDoorIssue[] {
  const list = [...args.nodes]
  const nodes = Object.fromEntries(list.map((node) => [node.id, node]))
  const byId = new Map(list.map((node) => [node.id, node]))
  const finite = list.every((node) => node.type === 'item' || finiteNumbers(node))
  return findBlockedDoorsByBox({
    ...args,
    nodes: list,
    solidsOf: (node) => (finite && isWallDressing(node) ? itemSolidsInLevel(node, nodes) : null),
    heightsOf: (node) => itemHeightsInLevel(node, nodes, byId, finite) ?? null,
  })
}

/** Plan overlap, in square metres, from which two real shapes are overlapping: a touching edge or a boolean's sliver is not. */
export const MIN_OVERLAP_AREA = 0.001

/**
 * An item's bottom and top in the level's frame, as the renderer stands it: the model's own bounds
 * through the floor construction under it (measured) or, where it has none, its pose and its height
 * above its host, lifted by the floor construction under the item at the root of its host chain. A
 * thing hosted by a ceiling or a wall, or one whose heights are unknown, has none.
 */
export function itemHeightsInLevel(
  node: ItemNode,
  nodes: Record<string, AnyNode>,
  byId: Map<string, AnyNode>,
  finiteContext = true,
): ItemVerticalInterval | undefined {
  const measured = finiteContext ? itemVerticalInterval(node, nodes) : undefined
  if (measured) return measured
  const range = itemLevelHeightRange(node, byId)
  let root: ItemNode = node
  for (let depth = 0; depth < 16; depth++) {
    const parent = root.parentId ? nodes[root.parentId] : undefined
    if (parent?.type !== 'item') break
    root = parent
  }
  const rootParent = root.parentId ? nodes[root.parentId] : undefined
  const levelId = resolveNodeLevelId(node.id, byId)
  if (!(range && levelId && finiteContext && rootParent?.type === 'level')) return undefined
  const lift = itemFloorLift(root, nodes)
  return Number.isFinite(lift)
    ? { levelId, min: range.min + lift, max: range.max + lift }
    : undefined
}

/** How far an item may sink into what it stands on and still be resting on it, in metres. */
export const STACK_TOLERANCE = 0.02

export function findItemItemCollisions(args: {
  nodes: Iterable<AnyNode>
  levelId?: string
  gap?: number
}): ItemCollision[] {
  const gap = args.gap ?? DEFAULT_ITEM_GAP
  const list = [...args.nodes]
  const nodes = Object.fromEntries(list.map((node) => [node.id, node]))
  const footprints = collectOccupiedFootprints(list, { levelId: args.levelId })
  // Drawing fallbacks on invalid support heights cannot prove collision separation.
  const finiteContext = list.every((node) => node.type === 'item' || finiteNumbers(node))
  const byId = new Map(list.map((node) => [node.id, node]))
  const heights = new Map<string, ItemVerticalInterval | undefined>()
  for (const { id } of footprints)
    heights.set(id, itemHeightsInLevel(nodes[id] as ItemNode, nodes, byId, finiteContext))
  // A box is as tall as its heights say; a real shape is read for wall panelling only.
  const solids = new Map<string, readonly ItemSolid[] | null>()
  const solidsOf = (id: string): readonly ItemSolid[] | null => {
    if (!solids.has(id))
      solids.set(id, finiteContext ? itemSolidsInLevel(nodes[id] as ItemNode, nodes) : null)
    return solids.get(id) ?? null
  }
  const boxSolid = (id: string): readonly ItemSolid[] | null => {
    const node = nodes[id] as ItemNode
    const pose = itemLevelPose(node, byId)
    if (!pose) return null
    const corners = itemNodePlanCorners({
      ...node,
      position: pose.position,
      rotation: [node.rotation[0], pose.yawDeg, node.rotation[2]],
    })
    if (!corners.every((corner) => corner.every(Number.isFinite))) return null
    const interval = heights.get(id)
    return [
      {
        polygons: [{ outer: corners.map(([x, z]) => [x, z] as [number, number]), holes: [] }],
        y0: interval?.min ?? Number.NEGATIVE_INFINITY,
        y1: interval?.max ?? Number.POSITIVE_INFINITY,
      },
    ]
  }
  const collisions: ItemCollision[] = []
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i]!
      const b = footprints[j]!
      if (a.levelId && b.levelId && a.levelId !== b.levelId) continue
      if (!aabbsOverlap(a.aabb, b.aabb, gap)) continue
      const aY = heights.get(a.id)
      const bY = heights.get(b.id)
      let violation: ItemCollision['violation']
      let reading: ItemPairReading
      if (isWallDressing(nodes[a.id] as ItemNode) || isWallDressing(nodes[b.id] as ItemNode)) {
        // Wall panelling is thin strips along the walls, and its box is the room's: it is read by its
        // strips, a piece beside it by its footprint. Nothing else is: a script's horizontal faces leave
        // out its rails, backs and foliage, so the box stays the shape of the rest.
        const left = solidsOf(a.id) ?? boxSolid(a.id)
        const right = solidsOf(b.id) ?? boxSolid(b.id)
        if (!(left && right)) continue
        const relation = relateSolids(left, right, {
          stack: STACK_TOLERANCE,
          minArea: MIN_OVERLAP_AREA,
        })
        if (relation.overlapArea > 0) {
          violation = 'overlap'
          reading = { overlapAreaM2: roundMm(relation.overlapArea) }
        } else if (relation.gap < gap) {
          violation = 'clearance'
          reading = { gapM: roundMm(relation.gap) }
        } else continue
      } else {
        // Two boxes. One standing on the other (a lamp on a table, a vase on a console) is stacked,
        // whether it is the other's child or a sibling in the scene: its bottom is at or above the
        // other's top, to within what a model sinks into it. Unknown heights waive nothing.
        if (
          aY &&
          bY &&
          aY.levelId === bY.levelId &&
          (aY.min >= bY.max - STACK_TOLERANCE - 1e-9 || bY.min >= aY.max - STACK_TOLERANCE - 1e-9)
        )
          continue
        violation = aabbsOverlap(a.aabb, b.aabb, 0) ? 'overlap' : 'clearance'
        reading = boxReading(a.aabb, b.aabb, gap)
      }
      collisions.push({
        aId: a.id,
        bId: b.id,
        aName: a.name,
        bName: b.name,
        levelId: a.levelId ?? b.levelId,
        kind: 'item-aabb',
        violation,
        minimumClearanceMeters: gap,
        footprints: [roundBox(a.aabb), roundBox(b.aabb)],
        reading,
        message: collisionMessage(violation, gap, [a, b], reading),
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
  | 'off_wall'
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

/** How far a placement may step a piece off its spot, into the room, to clear doors and other pieces. */
export const PLACEMENT_INSETS_M = [0, 0.25, 0.5, 0.75]

/**
 * Slides along a wall between `min` and `max`, nearest first: the nearest to none at all, then
 * every 0.4 m (0, -0.4, 0.4, … when the range holds 0).
 */
export function lateralSteps(min: number, max: number): number[] {
  const nearest = Math.min(Math.max(0, min), max)
  const steps = [nearest]
  for (let k = Math.ceil(min / 0.4 - 1e-9); k * 0.4 <= max + 1e-9; k++)
    if (Math.abs(k * 0.4 - nearest) > 1e-9) steps.push(k * 0.4)
  return steps.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
}

/** Whether segment a–b passes through the open box |u| < halfU, |v| < halfV (Liang–Barsky). */
function segmentEntersBox(a: Vec2, b: Vec2, halfU: number, halfV: number): boolean {
  const [du, dv] = [b[0] - a[0], b[1] - a[1]]
  let [enter, exit] = [0, 1]
  for (const [p, q] of [
    [-du, a[0] + halfU],
    [du, halfU - a[0]],
    [-dv, a[1] + halfV],
    [dv, halfV - a[1]],
  ] as const) {
    if (p === 0) {
      if (q <= 0) return false
      continue
    }
    const t = q / p
    if (p < 0) enter = Math.max(enter, t)
    else exit = Math.min(exit, t)
    if (enter >= exit) return false
  }
  return true
}

/**
 * Whether a piece's turned footprint stands inside a room's outline, a notch or an L's missing
 * corner included: its middle is inside and no edge of the outline passes through it. A piece may
 * touch the outline, and overlap it by up to {@link OUTLINE_CONTACT_M}.
 */
function insideOutline(
  { x, z, rotationDeg }: PlacementCandidate,
  dimensions: [number, number, number] | number[] | undefined,
  outline: readonly Vec2[],
): boolean {
  if (!pointInPolygon([x, z], outline as Vec2[], false)) return false
  const [width = 1, , depth = 1] = dimensions ?? [1, 1, 1]
  const yaw = (rotationDeg * Math.PI) / 180
  const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)]
  // In the piece's own frame (the inverse of itemNodePlanCorners' turn): u across, v deep.
  const local = ([px, pz]: Vec2): Vec2 => [
    (px - x) * cos - (pz - z) * sin,
    (px - x) * sin + (pz - z) * cos,
  ]
  // A piece a few millimetres thin keeps half its own thickness, so its box is never empty.
  const inset = (half: number) => Math.max(half - OUTLINE_CONTACT_M, half / 2)
  const [halfU, halfV] = [inset(width / 2), inset(depth / 2)]
  return !outline.some((point, i) =>
    segmentEntersBox(local(point), local(outline[(i + 1) % outline.length]!), halfU, halfV),
  )
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
  const laterals = options?.lateralsM ?? lateralSteps(-1.2, 1.2)
  const insets = options?.insetsM ?? PLACEMENT_INSETS_M
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
  roomOutline?: readonly Vec2[]
  along?: { x: number; z: number }
  inward?: { x: number; z: number }
  lateralsM?: number[]
  insetsM?: number[]
  /** For a wall-bound piece: a spot is taken only against one of these walls, as verify_scene reads it. */
  againstWalls?: readonly WallFace[]
}):
  | { candidate: PlacementCandidate; reason: PlacementRejectReason }
  | {
      candidate: null
      reason: PlacementRejectReason
      /** The spot the reason is about, when one had a wall. */
      refused: PlacementCandidate | null
    } {
  const candidates = generatePlacementCandidates(args.primary, {
    along: args.along,
    inward: args.inward,
    lateralsM: args.lateralsM,
    insetsM: args.insetsM,
  })

  // Why the first spot that stands against a wall failed (a door, a piece), not the last nudge
  // tried (often outside the room after large ones); off_wall when no spot had a wall.
  let refused: { at: PlacementCandidate; reason: PlacementRejectReason } | null = null
  for (const c of candidates) {
    const aabb = itemPlanAabb([c.x, 0, c.z], args.dimensions, (c.rotationDeg * Math.PI) / 180)
    if (args.againstWalls && gapToWalls(aabb, args.againstWalls) > MID_ROOM_DISTANCE_M) continue
    let reason = classifyPlacement({
      aabb,
      doorKeepouts: args.doorKeepouts,
      occupied: args.occupied,
      roomBounds: args.roomBounds,
    })
    if (reason === 'ok' && args.roomOutline && !insideOutline(c, args.dimensions, args.roomOutline))
      reason = 'outside_bounds'
    if (reason === 'ok') return { candidate: c, reason }
    refused ??= { at: c, reason }
  }
  return { candidate: null, reason: refused?.reason ?? 'off_wall', refused: refused?.at ?? null }
}

/** A wall-bound piece whose nearest edge is further than this from every wall face is not against a wall. */
export const MID_ROOM_DISTANCE_M = 0.4
/** How far a piece may overlap a room's outline (m): touching it, give or take a millimetre. */
const OUTLINE_CONTACT_M = 1e-3
const DEFAULT_WALL_THICKNESS_M = 0.1

const cross = (o: Vec2, p: Vec2, q: Vec2) =>
  (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])

/** The shortest distance from a footprint box to a wall's centre line (0 when the line passes through it). */
function boxToSegment(box: PlanAabb, a: Vec2, b: Vec2) {
  const corners: Vec2[] = [
    [box.minX, box.minZ],
    [box.maxX, box.minZ],
    [box.maxX, box.maxZ],
    [box.minX, box.maxZ],
  ]
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 4; i++) {
    const c = corners[i]!
    const d = corners[(i + 1) % 4]!
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0
    nearest = Math.min(
      nearest,
      distanceToSegment(a, c, d),
      distanceToSegment(b, c, d),
      distanceToSegment(c, a, b),
      distanceToSegment(d, a, b),
    )
  }
  return nearest
}

/** A wall as the mid-room check reads it: its centre line and half its thickness. */
export type WallFace = { a: Vec2; b: Vec2; halfThickness: number }

/**
 * The walls of a level (resolved through `byId`), as the mid-room check reads them: its wall nodes.
 */
export function wallFacesOn(
  nodes: Iterable<AnyNode>,
  levelId: string | undefined,
  byId: Map<string, AnyNode> = new Map([...nodes].map((node) => [node.id, node])),
): WallFace[] {
  const walls: WallFace[] = []
  for (const node of nodes) {
    if (resolveNodeLevelId(node.id, byId) !== levelId) continue
    if (node.type === 'wall')
      walls.push({
        a: [node.start[0], node.start[1]],
        b: [node.end[0], node.end[1]],
        halfThickness: (node.thickness ?? DEFAULT_WALL_THICKNESS_M) / 2,
      })
  }
  return walls
}

/** How far a footprint stands from the nearest wall's face (m); Infinity with no wall. */
export function gapToWalls(box: PlanAabb, walls: readonly WallFace[]): number {
  return Math.min(
    Number.POSITIVE_INFINITY,
    ...walls.map((wall) => Math.max(0, boxToSegment(box, wall.a, wall.b) - wall.halfThickness)),
  )
}

/**
 * Wall-bound pieces (a fridge, a counter, a bed, a sofa) that stand in a room but away from every
 * wall: further than {@link MID_ROOM_DISTANCE_M} from the face of each wall of their level. A roof
 * on the level stands walls of its own (knee walls, gable ends) where no wall node does, so a loft
 * bounded by its roof is measured to them. Pieces outside every room, free-standing kinds, and
 * levels with neither walls nor a roof shell are not judged.
 */
export function findItemsMidRoom(args: { nodes: Iterable<AnyNode>; levelId?: string }): {
  id: string
  message: string
}[] {
  const list = [...args.nodes]
  const byId = new Map<string, AnyNode>(list.map((node) => [node.id, node]))
  const walls = wallFacesOn(list, args.levelId, byId)
  const zones = list.filter(
    (node): node is Extract<AnyNode, { type: 'zone' }> =>
      node.type === 'zone' && resolveNodeLevelId(node.id, byId) === args.levelId,
  )
  if (walls.length === 0 || zones.length === 0) return []

  const found: { id: string; message: string }[] = []
  for (const footprint of collectOccupiedFootprints(list, {
    floorOnly: true,
    ...(args.levelId === undefined ? {} : { levelId: args.levelId }),
  })) {
    const node = byId.get(footprint.id)
    const word = node?.type === 'item' ? wallBoundWord(node.asset) : null
    if (node?.type !== 'item' || !word) continue
    const room = zones.find((zone) =>
      pointInPolygon([node.position[0], node.position[2]], zone.polygon as Vec2[], true),
    )
    if (!room) continue
    const gap = gapToWalls(footprint.aabb, walls)
    if (gap <= MID_ROOM_DISTANCE_M) continue
    found.push({
      id: node.id,
      message: `${footprint.name ?? node.asset.id} (${node.id}) stands in the middle of ${room.name || room.id}, ${gap.toFixed(1)} m from the nearest wall: a ${word} belongs against a wall (place_in_room puts it there).`,
    })
  }
  return found
}

type LayoutFinding = { message: string; nodeIds: string[] }

export type LayoutIssue =
  | (LayoutFinding &
      DoorBlockReading & {
        type: 'door_blocked'
        obstacle: { nodeId: string; name?: string; footprint: PlanAabb; side: DoorSide }
        clearZone: DoorClearZone
      })
  | (LayoutFinding &
      ItemPairReading & {
        type: 'item_overlap' | 'item_too_close'
        footprints: [PlanAabb, PlanAabb]
        minimumClearanceMeters: number
      })
  | (LayoutFinding & { type: 'item_mid_room' })

/**
 * Collect layout issues, scoped per level so stacked floors do not false-positive. A blocked door and
 * a pair of items carry the numbers of the finding: what stands where, how deep, and the way clear.
 */
export function layoutIssuesFromScene(nodes: Iterable<AnyNode>): LayoutIssue[] {
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

  const issues = new Map<string, LayoutIssue>()
  const levels = levelIds.size > 0 ? [...levelIds] : [undefined]
  const itemById = new Map<string, AnyNode>(list.map((n) => [n.id, n]))

  for (const levelId of levels) {
    for (const b of findBlockedDoors({ nodes: list, levelId })) {
      issues.set(b.message, {
        type: 'door_blocked',
        message: b.message,
        nodeIds: [b.doorId, b.itemId, b.wallId],
        obstacle: { nodeId: b.itemId, name: b.itemName, footprint: b.footprint, side: b.side },
        clearZone: b.clearZone,
        ...b.reading,
      })
    }
    for (const c of findItemItemCollisions({ nodes: list, levelId })) {
      // Close is the design for a nightstand beside its bed, a chair at its table: not a finding.
      const [a, b] = [itemById.get(c.aId), itemById.get(c.bId)]
      if (
        c.violation === 'clearance' &&
        a?.type === 'item' &&
        b?.type === 'item' &&
        designedTogether(a, b)
      )
        continue
      issues.set(c.message, {
        type: c.violation === 'overlap' ? 'item_overlap' : 'item_too_close',
        message: c.message,
        nodeIds: [c.aId, c.bId],
        footprints: c.footprints,
        minimumClearanceMeters: c.minimumClearanceMeters,
        ...c.reading,
      })
    }
    for (const m of findItemsMidRoom({ nodes: list, levelId })) {
      issues.set(m.message, { type: 'item_mid_room', message: m.message, nodeIds: [m.id] })
    }
  }

  // Deduplicate (node may appear under multiple walks)
  return [...issues.values()]
}
