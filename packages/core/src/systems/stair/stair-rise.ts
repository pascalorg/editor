import { getFloorStackedPosition } from '../../hooks/spatial-grid/floor-placed-elevation'
import type { AnyNode, StairNode } from '../../schema'
import {
  resolveStairTotalRise as resolveRise,
  syncStairRises as syncRises,
} from './stair-rise-query'

function liveBaseElevation(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  levelId: string | null,
) {
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
