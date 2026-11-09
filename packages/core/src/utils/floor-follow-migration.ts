import { footprintLift } from '../lib/floor-foundation-datum'
import { wallSupportForNodes } from '../lib/opening-floor-datum'
import type { AnyNode } from '../schema'
import { getWallPlaneTop } from '../services/storey'
import { wallOverlapsSlabFootprint } from '../systems/slab/slab-support'

export function migrateFootprintFollowing(nodes: Record<string, AnyNode>): Record<string, AnyNode> {
  const bases = Object.values(nodes).filter(
    (node) =>
      node.type === 'slab' &&
      node.plateRole === 'base' &&
      Math.abs(footprintLift(nodes, node)) > 1e-6,
  )
  if (!bases.length) return nodes
  let result = nodes
  for (const wall of Object.values(nodes)) {
    if (
      wall.type !== 'wall' ||
      wall.height === undefined ||
      wall.supportSlabId === 'ground' ||
      !bases.some(
        (base) =>
          base.type === 'slab' &&
          base.parentId === wall.parentId &&
          wallOverlapsSlabFootprint(wall, base.polygon),
      )
    )
      continue
    const following =
      getWallPlaneTop(wall, wall.parentId!, nodes) - wallSupportForNodes(wall, nodes).elevation
    if (Math.abs(following - wall.height) > 1e-6) continue
    const { height: _height, ...next } = wall
    if (result === nodes) result = { ...nodes }
    result[wall.id] = next
  }
  return result
}
