import type { BuildingNode, RockNode } from '../schema'
import { getEffectiveNode } from '../store/use-live-node-overrides'
import useLiveTransforms from '../store/use-live-transforms'

/**
 * The rock as it is on screen mid-gesture: a footprint reshaped through the live overrides, or
 * moved whole through a live transform, which for a polygon is the distance moved. What the
 * floors cut from it must read the same, or the hole trails the stone until the drag ends.
 */
export function effectiveRock(rock: RockNode): RockNode {
  const shown = getEffectiveNode(rock)
  const moved = useLiveTransforms.getState().get(rock.id)
  if (!moved) return shown
  const [dx, , dz] = moved.position
  return { ...shown, polygon: shown.polygon.map(([x, z]): [number, number] => [x + dx, z + dz]) }
}

/** The building as it is on screen mid-move: its live position and turn, for where it stands. */
export function effectiveBuilding(building: BuildingNode): BuildingNode {
  const shown = getEffectiveNode(building)
  const moved = useLiveTransforms.getState().get(building.id)
  if (!moved) return shown
  return {
    ...shown,
    position: moved.position,
    rotation: [shown.rotation[0], moved.rotation, shown.rotation[2]],
  }
}
