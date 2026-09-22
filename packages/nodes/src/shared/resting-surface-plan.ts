import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  collectSubtree,
  getEffectiveNode,
  useLiveTransforms,
} from '@pascal-app/core'
import { nodeLevelFrame } from '@pascal-app/core/procedural-items'

// Live transforms do not replace the committed snapshot; topology edits do.
const affectedIdsBySnapshot = new WeakMap<object, Map<AnyNodeId, readonly AnyNodeId[]>>()

// Hosted footprints read ancestor poses, so a host preview invalidates its descendants too.
export const restingFloorplanAffectedIds: NonNullable<
  AnyNodeDefinition['floorplanAffectedIds']
> = ({ nodeId, nodes }) => {
  let cached = affectedIdsBySnapshot.get(nodes)
  if (!cached) {
    cached = new Map()
    affectedIdsBySnapshot.set(nodes, cached)
  }
  let ids = cached.get(nodeId)
  if (!ids) {
    ids = collectSubtree(nodes, nodeId)?.descendants.map((node) => node.id) ?? []
    cached.set(nodeId, ids)
  }
  return ids
}

export function restingNodePlanFrame(
  node: AnyNode,
  resolve: (id: AnyNodeId) => AnyNode | undefined,
) {
  const nodes: Record<string, AnyNode> = { [node.id]: node }
  let id = node.parentId
  const visited = new Set<string>([node.id])
  while (id && !visited.has(id)) {
    visited.add(id)
    const parent = resolve(id as AnyNodeId)
    if (!parent) break
    const effective = getEffectiveNode(parent)
    const live = useLiveTransforms.getState().get(parent.id)
    nodes[id] =
      live && parent.type !== 'item' && parent.type !== 'level'
        ? ({
            ...effective,
            position: live.position,
            rotation:
              'rotation' in effective && typeof effective.rotation === 'number'
                ? live.rotation
                : [
                    'rotation' in effective && Array.isArray(effective.rotation)
                      ? effective.rotation[0]
                      : 0,
                    live.rotation,
                    'rotation' in effective && Array.isArray(effective.rotation)
                      ? effective.rotation[2]
                      : 0,
                  ],
          } as AnyNode)
        : effective
    if (parent.type === 'level') break
    id = parent.parentId
  }
  return nodeLevelFrame(node.id, nodes)
}
