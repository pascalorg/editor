import { nodeRegistry } from '../../registry'
import type { AnyNode, AnyNodeId, SlabNode, WallNode } from '../../schema'
import { GROUND_SUPPORT_ID, getFloorPlacedFootprints } from './floor-placed-elevation'
import { spatialGridManager } from './spatial-grid-manager'

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
): SupportSlabPatch {
  const parent = wall.parentId ? nodes[wall.parentId] : null
  if (parent?.type !== 'level') return { supportSlabId: undefined }

  const support = spatialGridManager.getSlabSupportForWall(
    parent.id,
    wall.start,
    wall.end,
    wall.curveOffset,
    wall.thickness,
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
