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

  let maxElevation = Number.NEGATIVE_INFINITY
  for (const footprint of getFloorPlacedFootprints(floorPlaced, effectiveNode, { nodes })) {
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
