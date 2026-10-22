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
  findBlockedDoors,
  itemNodePlanAabb,
  itemPlanAabb,
  type PlanAabb,
  resolveNodeLevelId,
} from './door-clearance'
import { furnitureKind, isFloorUnderlay } from './furniture-kind'
import { itemHosts, itemLevelHeightRange, itemPlanAabbInLevel } from './item-space'
import { pointInPolygon, type Vec2 } from './plan-geometry'

export {
  aabbsOverlap,
  collectDoorKeepouts,
  findBlockedDoors,
  itemNodePlanAabb,
  itemPlanAabb,
  type PlanAabb,
  resolveNodeLevelId,
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
  violation: 'overlap' | 'clearance'
  minimumClearanceMeters: number
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
  const list = Object.values(nodes)
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
  // The measured interval when the model's bounds allow it, else the node's own height above its
  // floor. A measured contact stays a collision (roundoff); a lamp standing on a table top by its
  // own height is stacked.
  const intervals = new Map(
    footprints.map(({ id }) => {
      const node = nodes[id] as ItemNode
      const measured = finiteContext ? itemVerticalInterval(node, nodes) : undefined
      if (measured) return [id, { ...measured, measured: true }]
      const range = itemLevelHeightRange(node, byId)
      return [
        id,
        range
          ? {
              levelId: resolveNodeLevelId(id, byId) ?? '',
              min: range.min,
              max: range.max,
              measured: false,
            }
          : undefined,
      ]
    }),
  )
  const hosts = new Map(footprints.map(({ id }) => [id, itemHosts(nodes[id]!, byId)]))
  const collisions: ItemCollision[] = []
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i]!
      const b = footprints[j]!
      if (a.levelId && b.levelId && a.levelId !== b.levelId) continue
      // A thing resting on top of its host is stacked by design: its bottom at the host's top. A
      // child sunk into its host, or one whose height is unknown, is still a collision.
      const [child, host] = hosts.get(a.id)?.has(b.id)
        ? [a, b]
        : hosts.get(b.id)?.has(a.id)
          ? [b, a]
          : []
      if (child && host) {
        const cY = intervals.get(child.id)
        const hY = intervals.get(host.id)
        if (cY && hY && cY.min >= hY.max - 0.02) continue
      }
      if (!aabbsOverlap(a.aabb, b.aabb, gap)) continue
      const aY = intervals.get(a.id)
      const bY = intervals.get(b.id)
      // Contact and sub-micrometre separation remain conservative against roundoff.
      if (aY && bY && aY.levelId === bY.levelId) {
        const touch = aY.measured && bY.measured ? 1e-6 : -1e-6
        if (bY.min - aY.max > touch || aY.min - bY.max > touch) continue
      }
      collisions.push({
        aId: a.id,
        bId: b.id,
        aName: a.name,
        bName: b.name,
        levelId: a.levelId ?? b.levelId,
        kind: 'item-aabb',
        violation: aabbsOverlap(a.aabb, b.aabb, 0) ? 'overlap' : 'clearance',
        minimumClearanceMeters: gap,
        message: aabbsOverlap(a.aabb, b.aabb, 0)
          ? `Items overlap: ${a.name ?? a.id} (${a.id}) and ${b.name ?? b.id} (${b.id})`
          : `Items are closer than ${gap} m: ${a.name ?? a.id} (${a.id}) and ${b.name ?? b.id} (${b.id})`,
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

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const length2 = dx * dx + dz * dz
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length2))
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dz))
}

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

/** The walls of a level (resolved through `byId`), as the mid-room check reads them. */
export function wallFacesOn(
  nodes: Iterable<AnyNode>,
  levelId: string | undefined,
  byId: Map<string, AnyNode> = new Map([...nodes].map((node) => [node.id, node])),
): WallFace[] {
  const walls: WallFace[] = []
  for (const node of nodes) {
    if (node.type !== 'wall' || resolveNodeLevelId(node.id, byId) !== levelId) continue
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
 * wall: further than {@link MID_ROOM_DISTANCE_M} from the face of each wall of their level. Pieces
 * outside every room, free-standing kinds, and levels with no walls are not judged.
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
    if (node?.type !== 'item' || furnitureKind(node.asset) !== 'wall') continue
    const room = zones.find((zone) =>
      pointInPolygon([node.position[0], node.position[2]], zone.polygon as Vec2[], true),
    )
    if (!room) continue
    const gap = gapToWalls(footprint.aabb, walls)
    if (gap <= MID_ROOM_DISTANCE_M) continue
    found.push({
      id: node.id,
      message: `${footprint.name ?? node.asset.id} (${node.id}) stands in the middle of ${room.name || room.id}, ${gap.toFixed(1)} m from the nearest wall: a ${node.asset.id} belongs against a wall (place_in_room puts it there).`,
    })
  }
  return found
}

/**
 * Collect layout issues, scoped per level so stacked floors do not false-positive.
 */
export function layoutIssuesFromScene(nodes: Iterable<AnyNode>): {
  type: 'door_blocked' | 'item_overlap' | 'item_too_close' | 'item_mid_room'
  message: string
}[] {
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

  const issues = new Map<
    string,
    'door_blocked' | 'item_overlap' | 'item_too_close' | 'item_mid_room'
  >()
  const levels = levelIds.size > 0 ? [...levelIds] : [undefined]

  for (const levelId of levels) {
    for (const b of findBlockedDoors({ nodes: list, levelId })) {
      issues.set(b.message, 'door_blocked')
    }
    for (const c of findItemItemCollisions({ nodes: list, levelId })) {
      issues.set(c.message, c.violation === 'overlap' ? 'item_overlap' : 'item_too_close')
    }
    for (const m of findItemsMidRoom({ nodes: list, levelId })) {
      issues.set(m.message, 'item_mid_room')
    }
  }

  // Deduplicate (node may appear under multiple walks)
  return [...issues].map(([message, type]) => ({ type, message }))
}
