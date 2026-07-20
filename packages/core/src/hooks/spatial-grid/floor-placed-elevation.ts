import { nodeRegistry } from '../../registry'
import type {
  FloorPlacedConfig,
  FloorPlacedFootprint,
  FloorPlacedFootprintContext,
  FloorPlacedFootprintsResolver,
} from '../../registry/types'
import type { AnyNode, AnyNodeId } from '../../schema'
import { spatialGridManager } from './spatial-grid-manager'

export type FloorPlacedElevationArgs = {
  node: AnyNode
  nodes: Record<string, AnyNode>
  position: [number, number, number]
  rotation?: unknown
  levelId?: string | null
}

function finiteSlabElevation(elevation: number): number {
  return Number.isFinite(elevation) ? elevation : 0
}

function withPositionAndRotation({
  node,
  position,
  rotation,
}: Pick<FloorPlacedElevationArgs, 'node' | 'position' | 'rotation'>): AnyNode {
  return {
    ...(node as Record<string, unknown>),
    position,
    ...(rotation !== undefined ? { rotation } : {}),
  } as AnyNode
}

export function getFloorPlacedFootprints(
  floorPlaced: FloorPlacedConfig,
  node: AnyNode,
  ctx?: FloorPlacedFootprintContext,
): FloorPlacedFootprint[] {
  const rawFootprints = floorPlaced.footprints?.(node, ctx)
  if (rawFootprints) return [...rawFootprints]

  const footprint = floorPlaced.footprint?.(node, ctx)
  return footprint ? [footprint] : []
}

export function getFloorPlacedElevation({
  node,
  nodes,
  position,
  rotation,
  levelId,
}: FloorPlacedElevationArgs): number {
  const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  if (!floorPlaced) return 0

  const effectiveNode = withPositionAndRotation({ node, position, rotation })
  if (floorPlaced.applies && !floorPlaced.applies(effectiveNode)) return 0

  const parentId = (effectiveNode as { parentId?: AnyNodeId | null }).parentId ?? null
  const parent = parentId ? nodes[parentId] : null
  if (parentId && !parent) return 0
  if (parent && parent.type !== 'level') return 0
  if (!parent && !levelId) return 0

  const resolvedLevelId = parent?.type === 'level' ? parent.id : levelId
  if (!resolvedLevelId) return 0

  const footprints = getFloorPlacedFootprints(floorPlaced, effectiveNode, { nodes })

  // A persisted support host pins the elevation while it still exists and
  // overlaps a footprint — deterministic across stacked slabs. A stale
  // host (deleted or reshaped away) silently falls through to the
  // election below; this per-frame read path never writes the field.
  const supportSlabId = (effectiveNode as { supportSlabId?: string | null }).supportSlabId
  if (supportSlabId) {
    for (const footprint of footprints) {
      const hosted = spatialGridManager.getHostSlabElevationForFootprint(
        resolvedLevelId,
        supportSlabId,
        footprint.position ?? position,
        footprint.dimensions,
        footprint.rotation,
      )
      if (hosted !== null) return finiteSlabElevation(hosted)
    }
  }

  let maxElevation = Number.NEGATIVE_INFINITY
  for (const footprint of footprints) {
    const footprintPosition = footprint.position ?? position
    const elevation = finiteSlabElevation(
      spatialGridManager.getSlabElevationForItem(
        resolvedLevelId,
        footprintPosition,
        footprint.dimensions,
        footprint.rotation,
      ),
    )
    if (elevation > maxElevation) {
      maxElevation = elevation
    }
  }

  return maxElevation === Number.NEGATIVE_INFINITY ? 0 : maxElevation
}

export function getFloorStackedPosition(args: FloorPlacedElevationArgs): [number, number, number] {
  const [x, y, z] = args.position
  return [x, y + getFloorPlacedElevation(args), z]
}

export type { FloorPlacedFootprint, FloorPlacedFootprintContext, FloorPlacedFootprintsResolver }
