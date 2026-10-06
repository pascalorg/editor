import {
  type AnyNode,
  type AnyNodeId,
  findLevelAncestorId,
  levelBaseElevationAt,
  nodeRegistry,
} from '@pascal-app/core'
import { createNodeTopSurfaceHeightSampler } from './node-top-surface-height'

/** The highest walkable surface at a level-local point, including rendered shaped tops. */
export function createSceneSupportHeightSampler(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: AnyNodeId,
  selectedHostId?: AnyNodeId,
): (x: number, z: number) => number {
  const supports = Object.values(nodes)
    .filter(
      (node) =>
        node.visible !== false &&
        (!selectedHostId || node.id === selectedHostId) &&
        findLevelAncestorId(node.id as AnyNodeId, nodes) === levelId &&
        !!nodeRegistry.get(node.type)?.capabilities.surfaces?.top,
    )
    .map((node) => {
      const top = nodeRegistry.get(node.type)?.capabilities.surfaces?.top
      const resolveSupportHeight = top?.supportHeight
      return {
        node,
        resolveDataHeight: resolveSupportHeight
          ? (x: number, z: number) => resolveSupportHeight(node, x, z, { nodes })
          : null,
        sampleRenderedHeight: resolveSupportHeight
          ? null
          : createNodeTopSurfaceHeightSampler(node.id as AnyNodeId, levelId),
      }
    })

  return (x, z) => {
    let height = levelBaseElevationAt(nodes, levelId, x, z)
    for (const support of supports) {
      const top = support.resolveDataHeight
        ? support.resolveDataHeight(x, z)
        : (support.sampleRenderedHeight?.(x, z) ?? null)
      if (top !== null) height = Math.max(height, top)
    }
    return height
  }
}
