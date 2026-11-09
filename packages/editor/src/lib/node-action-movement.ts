import {
  type AnyNode,
  type AnyNodeId,
  cloneNodesInto,
  collectSubtree,
  isMovable,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { copyCreateOps } from './fresh-planar-placement'

export function registryMoveDisabled(node: AnyNode): boolean {
  const def = nodeRegistry.get(node.type)
  return Boolean(
    def?.capabilities.movable &&
      !isMovable(node) &&
      !def.floorplanMoveTarget &&
      !def.affordanceTools?.move,
  )
}

export function duplicateWithoutMove(node: AnyNode) {
  const subtree = collectSubtree(useScene.getState().nodes, node.id)
  const parentId = node.parentId as AnyNodeId | null
  if (!subtree || !parentId) return null
  const cloned = cloneNodesInto([subtree.root, ...subtree.descendants], {
    rootId: node.id,
    parentId,
  })
  useScene.getState().createNodes(copyCreateOps(cloned, parentId))
  return cloned.rootId
}
