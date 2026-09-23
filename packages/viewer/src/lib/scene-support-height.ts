import {
  type AnyNode,
  type AnyNodeId,
  findLevelAncestorId,
  levelBaseElevationAt,
  nodeRegistry,
  pointInPolygon2D,
} from '@pascal-app/core'
import { createNodeTopSurfaceHeightSampler } from './node-top-surface-height'

/** The highest walkable surface at a level-local point, including rendered shaped tops. */
export function createSceneSupportHeightSampler(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: AnyNodeId,
): (x: number, z: number) => number {
  const slabs = Object.values(nodes).filter(
    (node) =>
      node.type === 'slab' &&
      node.visible !== false &&
      findLevelAncestorId(node.id as AnyNodeId, nodes) === levelId,
  )
  const shaped = Object.values(nodes)
    .filter(
      (node) =>
        node.type !== 'slab' &&
        node.type !== 'fence' &&
        node.visible !== false &&
        findLevelAncestorId(node.id as AnyNodeId, nodes) === levelId &&
        !!nodeRegistry.get(node.type)?.capabilities.surfaces?.top,
    )
    .map((node) => createNodeTopSurfaceHeightSampler(node.id as AnyNodeId, levelId))
    .filter((sample): sample is (x: number, z: number) => number | null => sample !== null)

  return (x, z) => {
    let height = levelBaseElevationAt(nodes, levelId, x, z)
    for (const slab of slabs) {
      if (slab.type !== 'slab' || slab.polygon.length < 3) continue
      if (!pointInPolygon2D([x, z], slab.polygon, { includeBoundary: true })) continue
      if (
        slab.holes.some(
          (hole) => hole.length >= 3 && pointInPolygon2D([x, z], hole, { includeBoundary: false }),
        )
      )
        continue
      height = Math.max(height, slab.elevation)
    }
    for (const sample of shaped) {
      const top = sample(x, z)
      if (top !== null) height = Math.max(height, top)
    }
    return height
  }
}
