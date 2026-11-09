import { type AnyNode, type AnyNodeId, useScene, type WindowNode } from '@pascal-app/core'

/**
 * Write what Wrap the corner, Merge windows or a placement at a corner planned: one batch, so one
 * undo step, with the windows and the walls that carry them marked for rebuild.
 */
export function writeWindowChanges(changes: {
  create: WindowNode | null
  updates: Record<string, Partial<WindowNode>>
  remove: readonly string[]
}) {
  const scene = useScene.getState()
  const parents = new Set<string>()
  for (const id of [...Object.keys(changes.updates), ...changes.remove]) {
    const parentId = scene.nodes[id as AnyNodeId]?.parentId
    if (parentId) parents.add(parentId)
  }
  scene.applyNodeChanges({
    create: changes.create
      ? [{ node: changes.create, parentId: changes.create.parentId as AnyNodeId }]
      : [],
    update: Object.entries(changes.updates).map(([id, data]) => ({
      id: id as AnyNodeId,
      data: data as Partial<AnyNode>,
    })),
    delete: changes.remove as AnyNodeId[],
  })
  const after = useScene.getState()
  for (const id of Object.keys(changes.updates)) after.dirtyNodes.add(id as AnyNodeId)
  if (changes.create) {
    after.dirtyNodes.add(changes.create.id as AnyNodeId)
    if (changes.create.parentId) parents.add(changes.create.parentId)
  }
  for (const id of parents) after.dirtyNodes.add(id as AnyNodeId)
}
