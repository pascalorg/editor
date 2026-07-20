import { nodeRegistry } from '../../registry'
import type { AnyNode, AnyNodeId, FenceNode, SlabNode, WallNode } from '../../schema'
import { getWallCurveFrameAt, isCurvedWall } from '../../systems/wall/wall-curve'
import { GROUND_SUPPORT_ID, getFloorPlacedFootprints } from './floor-placed-elevation'
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
    return { supportSlabId: candidateElevations.size >= 2 ? winner.slabId : undefined }
  }
  // Capped election chose the ground while overlapping slabs sit above the
  // cap: persist the ground host, or the uncapped per-frame election would
  // lift the committed node back onto the deck.
  return { supportSlabId: cappedOut ? GROUND_SUPPORT_ID : undefined }
}

export function resolveWallSupportSlabPatch(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  options?: SupportSlabPatchOptions,
): SupportSlabPatch {
  const parent = wall.parentId ? nodes[wall.parentId] : null
  if (parent?.type !== 'level') return { supportSlabId: undefined }

  // Winner under the pointer cap (when given): a deck hanging above the
  // aimed-at surface can't capture the elected base, so a wall drawn at the
  // floor underneath it persists the floor slab the user actually targeted.
  const support = spatialGridManager.getSlabSupportForWall(
    parent.id,
    wall.start,
    wall.end,
    wall.curveOffset,
    wall.thickness,
    null,
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

  return {
    supportSlabId: candidateElevations.size >= 2 ? (support.electedSlabId ?? undefined) : undefined,
  }
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

  if (winner === null) return { supportSlabId: undefined }
  const persist = candidateElevations.size >= 2 || winner.elevation > SUPPORT_ELEVATION_EPSILON
  return { supportSlabId: persist ? winner.slabId : undefined }
}
