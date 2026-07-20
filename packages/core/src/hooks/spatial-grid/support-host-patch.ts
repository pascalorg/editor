import { nodeRegistry } from '../../registry'
import type { AnyNode, AnyNodeId, SlabNode, WallNode } from '../../schema'
import { getFloorPlacedFootprints } from './floor-placed-elevation'
import { spatialGridManager } from './spatial-grid-manager'

export type SupportSlabPatch = { supportSlabId: string | undefined }

export function resolveSupportSlabPatch(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
): SupportSlabPatch {
  const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  if (!floorPlaced || (floorPlaced.applies && !floorPlaced.applies(node))) {
    return { supportSlabId: undefined }
  }

  const parentId = (node as { parentId?: AnyNodeId | null }).parentId ?? null
  const parent = parentId ? nodes[parentId] : null
  if (parent?.type !== 'level') return { supportSlabId: undefined }

  const footprints = getFloorPlacedFootprints(floorPlaced, node, { nodes })
  const candidateElevations = new Set<number>()
  let winner: { slabId: string; elevation: number } | null = null

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
    )
    if (support.slabId && (!winner || support.elevation > winner.elevation)) {
      winner = { slabId: support.slabId, elevation: support.elevation }
    }
  }

  return {
    supportSlabId: candidateElevations.size >= 2 && winner !== null ? winner.slabId : undefined,
  }
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
