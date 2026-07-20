import { nodeRegistry } from '../../registry'
import type {
  FloorPlacedConfig,
  FloorPlacedFootprint,
  FloorPlacedFootprintContext,
  FloorPlacedFootprintsResolver,
} from '../../registry/types'
import type { AnyNode, AnyNodeId } from '../../schema'
import { spatialGridManager } from './spatial-grid-manager'

/**
 * Sentinel `supportSlabId` meaning "hosted by the level base (ground)".
 * Persisted when a pointer-capped commit elects the ground while one or
 * more slabs (e.g. an elevated deck) still overlap the footprint above the
 * cap — without it, the uncapped per-frame election would lift the
 * committed node back onto the deck.
 */
export const GROUND_SUPPORT_ID = 'ground'

export type FloorPlacedElevationArgs = {
  node: AnyNode
  nodes: Record<string, AnyNode>
  position: [number, number, number]
  rotation?: unknown
  levelId?: string | null
  /**
   * Pointer-decided support cap (level-local Y): only slabs whose walking
   * surface sits at or below `maxElevation + SUPPORT_ELEVATION_EPSILON`
   * may be elected, and the persisted `supportSlabId` is bypassed — during
   * a drag the pointer, not the stored host, decides the target surface.
   * Omit (or pass null) for the uncapped committed-read behavior.
   */
  maxElevation?: number | null
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
  maxElevation,
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
  // Skipped entirely under a pointer cap: the cursor, not the stored
  // host, decides the target surface during a drag.
  const supportSlabId = (effectiveNode as { supportSlabId?: string | null }).supportSlabId
  if (maxElevation == null && supportSlabId) {
    if (supportSlabId === GROUND_SUPPORT_ID) return 0
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

  let elected = Number.NEGATIVE_INFINITY
  for (const footprint of footprints) {
    const footprintPosition = footprint.position ?? position
    const elevation = finiteSlabElevation(
      spatialGridManager.getSlabElevationForItem(
        resolvedLevelId,
        footprintPosition,
        footprint.dimensions,
        footprint.rotation,
        maxElevation,
      ),
    )
    if (elevation > elected) {
      elected = elevation
    }
  }

  return elected === Number.NEGATIVE_INFINITY ? 0 : elected
}

export function getFloorStackedPosition(args: FloorPlacedElevationArgs): [number, number, number] {
  const [x, y, z] = args.position
  return [x, y + getFloorPlacedElevation(args), z]
}

export type { FloorPlacedFootprint, FloorPlacedFootprintContext, FloorPlacedFootprintsResolver }
