import { levelBaseElevationAt, terrainSupportLift } from '../../lib/terrain-support'
import { nodeRegistry } from '../../registry'
import type { AnyNode, AnyNodeId, FenceNode, SlabNode, WallNode } from '../../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../../services/level-height'
import { getWallCurveFrameAt, isCurvedWall } from '../../systems/wall/wall-curve'
import {
  GROUND_SUPPORT_ID,
  getFloorPlacedElevation,
  getFloorPlacedFootprints,
} from './floor-placed-elevation'
import { SUPPORT_ELEVATION_EPSILON, spatialGridManager } from './spatial-grid-manager'

export type SupportSlabPatch = { supportSlabId: string | undefined }

export type SupportSlabPatchOptions = {
  /**
   * Pointer-decided support cap (level-local Y) — see
   * `FloorPlacedElevationArgs.maxElevation`. When set, the persisted host
   * reproduces the CAPPED election: the elected lower slab wins over a
   * deck hanging above the cap, and `GROUND_SUPPORT_ID` is stored when the
   * ground is elected while capped-out slabs still overlap the footprint.
   */
  maxElevation?: number | null
  /** Pointer- or snap-decided host. Ground is a first-class support source. */
  preferredSlabId?: string | null
  /** Persist even an unambiguous host so later overlapping slabs cannot re-elect it. */
  pinSupport?: boolean
}

export type FrozenFloorPlacementOptions = {
  /** Canonical position before floor/support lift is applied. */
  position: [number, number, number]
  rotation?: unknown
  /** Exact level-local elevation hit on a non-slab construction surface. */
  elevation: number
  /** Slab/ground supporting that construction surface, when known. */
  preferredSlabId?: string | null
}

export function resolveSupportSlabPatch(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  options?: SupportSlabPatchOptions,
): SupportSlabPatch {
  const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  if (!floorPlaced || (floorPlaced.applies && !floorPlaced.applies(node))) {
    return { supportSlabId: undefined }
  }

  const parentId = (node as { parentId?: AnyNodeId | null }).parentId ?? null
  const parent = parentId ? nodes[parentId] : null
  if (parent?.type !== 'level') return { supportSlabId: undefined }

  const maxElevation = options?.maxElevation
  const footprints = getFloorPlacedFootprints(floorPlaced, node, { nodes })

  if (options?.preferredSlabId === GROUND_SUPPORT_ID) {
    return { supportSlabId: GROUND_SUPPORT_ID }
  }
  if (options?.preferredSlabId) {
    for (const footprint of footprints) {
      const position = footprint.position ?? (node as { position?: unknown }).position
      if (!Array.isArray(position) || position.length !== 3) continue
      const elevation = spatialGridManager.getHostSlabElevationForFootprint(
        parent.id,
        options.preferredSlabId,
        position as [number, number, number],
        footprint.dimensions,
        footprint.rotation,
      )
      if (
        elevation !== null &&
        (maxElevation == null || elevation <= maxElevation + SUPPORT_ELEVATION_EPSILON)
      ) {
        return { supportSlabId: options.preferredSlabId }
      }
    }
  }

  const candidateElevations = new Set<number>()
  let winner: { slabId: string; elevation: number } | null = null
  let cappedOut = false

  for (const footprint of footprints) {
    const position = footprint.position ?? (node as { position?: unknown }).position
    if (!Array.isArray(position) || position.length !== 3) continue
    const candidates = spatialGridManager.getSupportCandidatesForFootprint(
      parent.id,
      position as [number, number, number],
      footprint.dimensions,
      footprint.rotation,
    )
    for (const candidate of candidates) candidateElevations.add(candidate.elevation)

    const support = spatialGridManager.getSlabSupportForItem(
      parent.id,
      position as [number, number, number],
      footprint.dimensions,
      footprint.rotation,
      maxElevation,
    )
    if (support.slabId && (!winner || support.elevation > winner.elevation)) {
      winner = { slabId: support.slabId, elevation: support.elevation }
    }
    if (maxElevation != null && support.slabId === null && candidates.length > 0) {
      cappedOut = true
    }
  }

  if (winner !== null) {
    return {
      supportSlabId:
        options?.pinSupport || candidateElevations.size >= 2 ? winner.slabId : undefined,
    }
  }
  // Capped election chose the ground while overlapping slabs sit above the
  // cap: persist the ground host, or the uncapped per-frame election would
  // lift the committed node back onto the deck.
  return {
    supportSlabId: options?.pinSupport || cappedOut ? GROUND_SUPPORT_ID : undefined,
  }
}

/**
 * Freeze an exact pointed node-top elevation into a floor-placed node's
 * existing canonical Y offset, while pinning the slab/ground beneath that
 * surface. This deliberately does not create a live hosting edge to the
 * pointed node: arbitrary mesh faces can be edited or sloped, so placement
 * captures the plane the user chose at commit time.
 */
export function resolveFrozenFloorPlacementPatch(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  options: FrozenFloorPlacementOptions,
): SupportSlabPatch & { position: [number, number, number] } {
  const effectiveNode = {
    ...(node as Record<string, unknown>),
    position: options.position,
    ...(options.rotation !== undefined ? { rotation: options.rotation } : {}),
  } as AnyNode
  const floorPlaced = nodeRegistry.get(effectiveNode.type)?.capabilities?.floorPlaced
  if (!floorPlaced || (floorPlaced.applies && !floorPlaced.applies(effectiveNode))) {
    return { supportSlabId: undefined, position: options.position }
  }
  const supportPatch = resolveSupportSlabPatch(effectiveNode, nodes, {
    maxElevation: options.elevation,
    preferredSlabId: options.preferredSlabId,
    pinSupport: true,
  })
  const pinnedNode = { ...effectiveNode, ...supportPatch } as AnyNode
  const supportElevation = getFloorPlacedElevation({
    node: pinnedNode,
    nodes,
    position: options.position,
    rotation: options.rotation,
  })

  return {
    ...supportPatch,
    position: [
      options.position[0],
      options.position[1] + options.elevation - supportElevation,
      options.position[2],
    ],
  }
}

export function resolveWallSupportSlabPatch(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  options?: SupportSlabPatchOptions,
): SupportSlabPatch {
  const parent = wall.parentId ? nodes[wall.parentId] : null
  if (parent?.type !== 'level') return { supportSlabId: undefined }
  if (options?.preferredSlabId === GROUND_SUPPORT_ID) {
    return { supportSlabId: GROUND_SUPPORT_ID }
  }

  // Winner under the pointer cap (when given): a deck hanging above the
  // aimed-at surface can't capture the elected base, so a wall drawn at the
  // floor underneath it persists the floor slab the user actually targeted.
  const support = spatialGridManager.getSlabSupportForWall(
    parent.id,
    wall.start,
    wall.end,
    wall.curveOffset,
    wall.thickness,
    options?.preferredSlabId,
    options?.maxElevation,
  )
  const candidateElevations = new Set<number>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'slab' || node.parentId !== parent.id) continue
    const candidate = node as SlabNode
    const preferred = spatialGridManager.getSlabSupportForWall(
      parent.id,
      wall.start,
      wall.end,
      wall.curveOffset,
      wall.thickness,
      candidate.id,
    )
    if (preferred.electedSlabId === candidate.id) {
      candidateElevations.add(candidate.elevation)
    }
  }

  if (support.electedSlabId === options?.preferredSlabId) {
    return { supportSlabId: support.electedSlabId ?? undefined }
  }
  if (
    options?.maxElevation != null &&
    support.electedSlabId === null &&
    candidateElevations.size > 0
  ) {
    return { supportSlabId: GROUND_SUPPORT_ID }
  }
  return {
    supportSlabId: candidateElevations.size >= 2 ? (support.electedSlabId ?? undefined) : undefined,
  }
}

/**
 * Re-elect a moved wall without discarding an explicit construction source.
 *
 * Move tools change only the wall's plan geometry. A persisted host therefore
 * remains preferred when it still supports the new footprint; the normal
 * resolver falls back when a slab no longer overlaps. Ground is also an
 * explicit source, so preserving it keeps terrain-hosted walls on terrain.
 */
export function resolveMovedWallSupportSlabPatch(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
): SupportSlabPatch {
  return resolveWallSupportSlabPatch(wall, nodes, {
    preferredSlabId: wall.supportSlabId ?? null,
  })
}

/** Fence-like shape the fence host election needs — plain segment, arc, or spline. */
export type FenceSupportInput = Pick<
  FenceNode,
  'start' | 'end' | 'curveOffset' | 'path' | 'thickness' | 'parentId'
>

/** Sample count for a curved (sagitta) fence centerline, matching the wall band test. */
const FENCE_CURVE_SUPPORT_SAMPLES = 16
/** Fallback fence thickness (schema default) when the node carries none. */
const DEFAULT_FENCE_THICKNESS = 0.08
/** Minimum band depth so the footprint survives the election's polygon inset. */
const MIN_FENCE_SUPPORT_BAND = 0.05

function fenceCenterlinePoints(fence: FenceSupportInput): Array<[number, number]> {
  if (fence.path && fence.path.length >= 2) {
    return fence.path.map((point) => [point[0], point[1]])
  }
  const wallLike = { start: fence.start, end: fence.end, curveOffset: fence.curveOffset ?? 0 }
  if ((fence.curveOffset ?? 0) !== 0 && isCurvedWall(wallLike)) {
    const points: Array<[number, number]> = []
    for (let i = 0; i <= FENCE_CURVE_SUPPORT_SAMPLES; i++) {
      const frame = getWallCurveFrameAt(wallLike, i / FENCE_CURVE_SUPPORT_SAMPLES)
      points.push([frame.point.x, frame.point.y])
    }
    return points
  }
  return [
    [fence.start[0], fence.start[1]],
    [fence.end[0], fence.end[1]],
  ]
}

/**
 * Support-host patch for a fence: elect the slab the fence line stands on
 * and persist it as `supportSlabId` (the fence lift resolves absent =
 * level floor — see `packages/nodes/src/fence/lift.ts`).
 *
 * The centerline (chord, sampled arc, or spline path) is turned into thin
 * band footprints and run through the same candidate machinery items use.
 * `options.maxElevation` is the pointer-decided cap: aiming at the floor
 * under a deck elects the floor, aiming at the deck top elects the deck.
 *
 * Persist rule: the items ambiguity rule (stacked candidates disagree)
 * PLUS the elevated-host case — a winner sitting meaningfully above the
 * level floor must be persisted even when unambiguous (a balcony deck with
 * nothing underneath), or the commit loses the election entirely since
 * fences run no per-frame election. A single default ground slab (its top
 * within `SUPPORT_ELEVATION_EPSILON` of the floor) stays unpersisted so
 * plain fences keep sitting at the level base. A capped-out election (all
 * overlapping slabs above the aimed-at ground) also resolves to the floor
 * via the same absent-host default. Pure; exported for tests.
 */
export function resolveFenceSupportSlabPatch(
  fence: FenceSupportInput,
  nodes: Record<string, AnyNode>,
  options?: SupportSlabPatchOptions,
): SupportSlabPatch {
  const parent = fence.parentId ? nodes[fence.parentId] : null
  if (parent?.type !== 'level') return { supportSlabId: undefined }

  const maxElevation = options?.maxElevation
  const band = Math.max(fence.thickness ?? DEFAULT_FENCE_THICKNESS, MIN_FENCE_SUPPORT_BAND)
  const points = fenceCenterlinePoints(fence)
  const candidateElevations = new Set<number>()
  let winner: { slabId: string; elevation: number } | null = null

  if (options?.preferredSlabId === GROUND_SUPPORT_ID) {
    return { supportSlabId: GROUND_SUPPORT_ID }
  }

  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]!
    const [bx, bz] = points[i]!
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-6) continue
    const position: [number, number, number] = [(ax + bx) / 2, 0, (az + bz) / 2]
    const dimensions: [number, number, number] = [length, 1, band]
    // getItemFootprint's rotation convention: local +X maps to
    // (cos yRot, sin yRot) in XZ, so the segment angle aligns the band.
    const rotation: [number, number, number] = [0, Math.atan2(bz - az, bx - ax), 0]

    if (options?.preferredSlabId) {
      const preferredElevation = spatialGridManager.getHostSlabElevationForFootprint(
        parent.id,
        options.preferredSlabId,
        position,
        dimensions,
        rotation,
      )
      if (
        preferredElevation !== null &&
        (maxElevation == null || preferredElevation <= maxElevation + SUPPORT_ELEVATION_EPSILON)
      ) {
        return { supportSlabId: options.preferredSlabId }
      }
    }

    const candidates = spatialGridManager.getSupportCandidatesForFootprint(
      parent.id,
      position,
      dimensions,
      rotation,
    )
    for (const candidate of candidates) candidateElevations.add(candidate.elevation)

    const support = spatialGridManager.getSlabSupportForItem(
      parent.id,
      position,
      dimensions,
      rotation,
      maxElevation,
    )
    if (support.slabId && (!winner || support.elevation > winner.elevation)) {
      winner = { slabId: support.slabId, elevation: support.elevation }
    }
  }

  if (winner === null) {
    return { supportSlabId: options?.pinSupport ? GROUND_SUPPORT_ID : undefined }
  }
  const persist = candidateElevations.size >= 2 || winner.elevation > SUPPORT_ELEVATION_EPSILON
  return { supportSlabId: options?.pinSupport || persist ? winner.slabId : undefined }
}

export type FenceConstructionOptions = {
  supportCap?: number | null
  preferredSupportSlabId?: string | null
  constructionElevation?: number | null
}

export function resolveFenceConstructionSupport(
  fence: FenceNode,
  levelId: string,
  nodes: Record<string, AnyNode>,
  options?: FenceConstructionOptions,
): FenceNode {
  const supportPatch = resolveFenceSupportSlabPatch({ ...fence, parentId: levelId }, nodes, {
    maxElevation: options?.supportCap ?? null,
    preferredSlabId: options?.preferredSupportSlabId ?? null,
    pinSupport: options?.constructionElevation != null,
  })
  const host = supportPatch.supportSlabId ? nodes[supportPatch.supportSlabId] : null
  const baseElevation =
    host?.type === 'slab'
      ? host.elevation
      : levelBaseElevationAt(nodes, levelId, fence.start[0], fence.start[1])
  const supportOffset =
    options?.constructionElevation == null
      ? fence.supportOffset
      : options.constructionElevation - baseElevation

  return {
    ...fence,
    ...supportPatch,
    supportOffset:
      supportOffset != null && Math.abs(supportOffset) > 1e-6 ? supportOffset : undefined,
  }
}

export type WallConstructionOptions = {
  supportCap?: number | null
  preferredSupportSlabId?: string | null
  constructionElevation?: number | null
  constructionHeight?: number | null
  flatConstructionBase?: boolean
  constructionSourceNodeId?: AnyNodeId | null
}

export function resolveTerrainWallConstructionOptions(
  nodes: Record<string, AnyNode>,
  levelId: string,
  point: readonly [number, number],
  defaults?: Record<string, unknown>,
): WallConstructionOptions | undefined {
  const constructionElevation = terrainSupportLift(nodes, levelId, point[0], point[1])
  if (constructionElevation == null) return undefined

  const level = nodes[levelId]
  const constructionHeight =
    typeof defaults?.height === 'number'
      ? defaults.height
      : level?.type === 'level'
        ? (level.height ?? DEFAULT_LEVEL_HEIGHT)
        : DEFAULT_LEVEL_HEIGHT

  return {
    constructionElevation,
    constructionHeight,
    supportCap: constructionElevation,
  }
}

export type WallConstructionResolution = {
  walls: WallNode[]
  sourceSupportUpdate: { id: AnyNodeId; data: SupportSlabPatch } | null
}

export function resolveWallConstruction(
  nodes: Record<string, AnyNode>,
  levelId: string,
  walls: readonly WallNode[],
  options?: WallConstructionOptions,
): WallConstructionResolution {
  let resolvedNodes = nodes
  let sourceSupportUpdate: WallConstructionResolution['sourceSupportUpdate'] = null
  const constructionSourceNodeId = options?.constructionSourceNodeId
  const constructionSourceIsSlab = constructionSourceNodeId
    ? nodes[constructionSourceNodeId]?.type === 'slab'
    : false
  if (constructionSourceNodeId) {
    const sourceNode = nodes[constructionSourceNodeId]
    const currentSupport =
      sourceNode && 'supportSlabId' in sourceNode
        ? (sourceNode.supportSlabId as string | undefined)
        : undefined
    if (sourceNode && currentSupport == null) {
      const data = resolveSupportSlabPatch(sourceNode, nodes, { pinSupport: true })
      if (data.supportSlabId != null) {
        sourceSupportUpdate = { id: constructionSourceNodeId, data }
        resolvedNodes = {
          ...nodes,
          [constructionSourceNodeId]: { ...sourceNode, ...data } as AnyNode,
        }
      }
    }
  }

  const resolvedWalls = walls.map((createdWall) => {
    const wallWithParent = { ...createdWall, parentId: levelId as AnyNodeId } as WallNode
    const terrainBase = terrainSupportLift(
      resolvedNodes,
      levelId,
      createdWall.start[0],
      createdWall.start[1],
    )
    const wallOptions =
      options?.preferredSupportSlabId === GROUND_SUPPORT_ID &&
      terrainBase == null &&
      !options.flatConstructionBase
        ? undefined
        : options
    const flatConstructionBase =
      wallOptions?.flatConstructionBase === true && !constructionSourceIsSlab
    const preferredSupportSlabId = flatConstructionBase
      ? GROUND_SUPPORT_ID
      : (wallOptions?.preferredSupportSlabId ??
        (wallOptions?.constructionElevation != null && terrainBase != null
          ? GROUND_SUPPORT_ID
          : null))
    const supportPatch = resolveWallSupportSlabPatch(wallWithParent, resolvedNodes, {
      maxElevation: wallOptions?.supportCap ?? null,
      preferredSlabId: preferredSupportSlabId,
    })
    const sourceSupport = spatialGridManager.getSlabSupportForWall(
      levelId,
      createdWall.start,
      createdWall.end,
      createdWall.curveOffset,
      createdWall.thickness,
      supportPatch.supportSlabId,
      wallOptions?.supportCap ?? null,
    )
    const groundDraft =
      preferredSupportSlabId === GROUND_SUPPORT_ID && (terrainBase != null || flatConstructionBase)
    const supportOffset =
      groundDraft && wallOptions?.constructionElevation != null
        ? wallOptions.constructionElevation - sourceSupport.elevation
        : undefined
    const preserveDraftHeight =
      groundDraft &&
      createdWall.height == null &&
      wallOptions?.constructionHeight != null &&
      wallOptions.constructionElevation != null

    return {
      ...wallWithParent,
      ...supportPatch,
      height: preserveDraftHeight ? wallOptions.constructionHeight : createdWall.height,
      supportOffset:
        supportOffset != null && Math.abs(supportOffset) > 1e-6 ? supportOffset : undefined,
    } as WallNode
  })

  return { walls: resolvedWalls, sourceSupportUpdate }
}
