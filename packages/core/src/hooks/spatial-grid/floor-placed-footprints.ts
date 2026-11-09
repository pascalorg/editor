import type {
  FloorPlacedConfig,
  FloorPlacedFootprint,
  FloorPlacedFootprintContext,
} from '../../registry/types'
import type { AnyNode } from '../../schema/types'

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
