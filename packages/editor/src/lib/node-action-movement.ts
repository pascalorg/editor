import { type AnyNode, createSceneApi, isMovable, nodeRegistry, useScene } from '@pascal-app/core'

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
  const api = createSceneApi(useScene)
  const subtree = api.getSubtree(node.id)
  if (!subtree || !node.parentId) return null
  return api.cloneNodesInto([subtree.root, ...subtree.descendants], {
    rootId: node.id,
    parentId: node.parentId as AnyNode['id'],
  })
}
