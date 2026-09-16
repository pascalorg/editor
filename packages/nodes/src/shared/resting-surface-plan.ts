import { type AnyNode, type AnyNodeId, getEffectiveNode, useLiveTransforms } from '@pascal-app/core'
import { nodeLevelFrame } from '@pascal-app/core/procedural-items'

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
      live &&
      (parent.type === 'shelf' || parent.type === 'cabinet' || parent.type === 'procedural-item')
        ? ({
            ...effective,
            position: live.position,
            rotation: parent.type === 'cabinet' ? live.rotation : [0, live.rotation, 0],
          } as AnyNode)
        : effective
    if (parent.type === 'level') break
    id = parent.parentId
  }
  return nodeLevelFrame(node.id, nodes)
}
