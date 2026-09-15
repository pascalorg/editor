import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  getCeilingClampBound,
  getLevelElevations,
  resolveCeilingHeight,
} from '@pascal-app/core'

export function resolveCeilingDraftElevation(
  ceiling: Pick<CeilingNode, 'parentId' | 'polygon' | 'height'>,
  nodes: Record<AnyNodeId, AnyNode>,
) {
  const baseY = ceiling.parentId ? (getLevelElevations(nodes).get(ceiling.parentId)?.baseY ?? 0) : 0
  const bound = ceiling.parentId
    ? getCeilingClampBound(ceiling.parentId, nodes, ceiling.polygon)
    : Number.POSITIVE_INFINITY
  const height = Math.min(resolveCeilingHeight(ceiling, nodes), bound)
  return { baseY, height, elevation: baseY + height }
}
