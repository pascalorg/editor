import type { AnyNode, AnyNodeId } from '../../schema'
import type { SceneState } from '../use-scene'

type AnyContainerNode = AnyNode & { children: string[] }

export const createNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ops: { node: AnyNode; parentId?: AnyNodeId }[],
) => {
  set((state) => {
    const nextNodes = { ...state.nodes }
    const nextRootIds = [...state.rootNodeIds]

    for (const { node, parentId } of ops) {
      // 1. Assign parentId to the child (Safe because BaseNode has parentId)
      const newNode = {
        ...node,
        parentId: parentId ?? null,
      }

      nextNodes[newNode.id] = newNode

      // 2. Update the Parent's children list
      if (parentId && nextNodes[parentId]) {
        const parent = nextNodes[parentId]

        // Type Guard: Check if the parent node is a container that supports children
        if ('children' in parent && Array.isArray(parent.children)) {
          nextNodes[parentId] = {
            ...parent,
            // Use Set to prevent duplicate IDs if createNode is called twice
            children: Array.from(new Set([...parent.children, newNode.id])) as any, // We don't verify child types here
          }
        }
      } else if (!parentId) {
        // 3. Handle Root nodes
        if (!nextRootIds.includes(newNode.id)) {
          nextRootIds.push(newNode.id)
        }
      }
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds }
  })

  // 4. System Sync
  ops.forEach(({ node, parentId }) => {
    get().markDirty(node.id)
    if (parentId) get().markDirty(parentId)
  })
}

export const updateNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  updates: { id: AnyNodeId; data: Partial<AnyNode> }[],
) => {
  const parentsToUpdate = new Set<AnyNodeId>()

  set((state) => {
    const nextNodes = { ...state.nodes }

    for (const { id, data } of updates) {
      const currentNode = nextNodes[id]
      if (!currentNode) continue

      // Handle Reparenting Logic
      if (data.parentId !== undefined && data.parentId !== currentNode.parentId) {
        // 1. Remove from old parent
        const oldParentId = currentNode.parentId as AnyNodeId | null
        if (oldParentId && nextNodes[oldParentId]) {
          const oldParent = nextNodes[oldParentId] as AnyContainerNode
          nextNodes[oldParent.id] = {
            ...oldParent,
            children: oldParent.children.filter((childId) => childId !== id),
          } as AnyNode
          parentsToUpdate.add(oldParent.id)
        }

        // 2. Add to new parent
        const newParentId = data.parentId as AnyNodeId | null
        if (newParentId && nextNodes[newParentId]) {
          const newParent = nextNodes[newParentId] as AnyContainerNode
          nextNodes[newParent.id] = {
            ...newParent,
            children: Array.from(new Set([...newParent.children, id])),
          } as AnyNode
          parentsToUpdate.add(newParent.id)
        }
      }

      // Apply the update
      nextNodes[id] = { ...nextNodes[id], ...data } as AnyNode
    }

    return { nodes: nextNodes }
  })

  // Mark dirty after the next frame to ensure React renders complete
  requestAnimationFrame(() => {
    updates.forEach((u) => {
      get().markDirty(u.id)
    })
    parentsToUpdate.forEach((pId) => {
      get().markDirty(pId)
    })
  })
}

export const deleteNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ids: AnyNodeId[],
) => {
  const parentsToMarkDirty = new Set<AnyNodeId>()

  set((state) => {
    const nextNodes = { ...state.nodes }
    let nextRootIds = [...state.rootNodeIds]

    for (const id of ids) {
      const node = nextNodes[id]
      if (!node) continue

      // 1. Remove reference from Parent
      const parentId = node.parentId as AnyNodeId | null
      if (parentId && nextNodes[parentId]) {
        const parent = nextNodes[parentId] as AnyContainerNode
        if (parent.children) {
          nextNodes[parent.id] = {
            ...parent,
            children: parent.children.filter((cid) => cid !== id),
          } as AnyNode
          parentsToMarkDirty.add(parent.id)
        }
      }

      // 2. Remove from Root list
      nextRootIds = nextRootIds.filter((rid) => rid !== id)

      // 3. Delete the node itself
      delete nextNodes[id]

      // Inside the deleteNodes loop
      if ('children' in node && node.children.length > 0) {
        // Recursively delete all children first
        get().deleteNodes(node.children as AnyNodeId[])
      }
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds }
  })

  // Notify systems that the parent has changed (e.g. Wall needs to fill a window hole)
  parentsToMarkDirty.forEach((pId) => get().markDirty(pId))
}
