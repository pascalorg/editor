import { getFloorStackedPosition } from '../../hooks/spatial-grid/floor-placed-elevation'
import { nodeRegistry } from '../../registry/registry'
import type { AnyNode, StairNode } from '../../schema'
import { stairBaseElevation } from './stair-base-elevation'
import {
  resolveStairTotalRise as resolveRise,
  syncStairRises as syncRises,
} from './stair-rise-query'

function liveBaseElevation(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  levelId: string | null,
) {
  // A host without the built-in stair kind (a bare MCP server) has no floor-placed footprint to
  // elect support with: the stair's own support query answers instead of the level base.
  if (!nodeRegistry.get('stair')?.capabilities?.floorPlaced)
    return stairBaseElevation(stair, nodes, levelId)
  return getFloorStackedPosition({
    node: stair,
    nodes,
    position: stair.position,
    rotation: stair.rotation,
    levelId,
  })[1]
}

export function resolveStairTotalRise(stair: StairNode, nodes: Record<string, AnyNode>) {
  return resolveRise(stair, nodes, liveBaseElevation)
}

export function syncStairRises(nodes: Record<string, AnyNode>) {
  return syncRises(nodes, liveBaseElevation)
}
