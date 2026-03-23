import type { AnyNode, AnyNodeId } from '../../schema'
import type { CollectionId } from '../../schema/collections'
import type { SceneState } from '../use-scene'

type AnyContainerNode = AnyNode & { children: string[] }

let pendingRafId: number | null = null
const pendingUpdates = new Set<AnyNodeId>()
const pendingParents = new Set<AnyNodeId>()

function collectDescendants(node: AnyNode): AnyNodeId[] {
  const descendants: AnyNodeId[] = []
  if ('children' in node && Array.isArray(node.children)) {
    for (const childId of node.children as AnyNodeId[]) {
      descendants.push(childId)
    }
  }
  return descendants
}

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

  // Collect pending updates to batch in a single RAF
  for (const { id } of updates) {
    pendingUpdates.add(id)
  }
  for (const pId of parentsToUpdate) {
    pendingParents.add(pId)
  }

  // Cancel previous RAF if pending
  if (pendingRafId !== null) {
    cancelAnimationFrame(pendingRafId)
  }

  // Mark dirty after the next frame to ensure React renders complete
  pendingRafId = requestAnimationFrame(() => {
    pendingRafId = null
    const { markDirty } = get()
    for (const id of pendingUpdates) {
      markDirty(id)
    }
    for (const pId of pendingParents) {
      markDirty(pId)
    }
    pendingUpdates.clear()
    pendingParents.clear()
  })
}

export const deleteNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ids: AnyNodeId[],
) => {
  const parentsToMarkDirty = new Set<AnyNodeId>()
  const allIdsToDelete = new Set(ids)
  const nodes = get().nodes

  for (const id of ids) {
    const node = nodes[id]
    if (!node) continue
    const descendants = collectDescendants(node)
    for (const childId of descendants) {
      allIdsToDelete.add(childId)
      const childNode = nodes[childId]
      if (childNode) {
        const childDescendants = collectDescendants(childNode)
        for (const grandchildId of childDescendants) {
          allIdsToDelete.add(grandchildId)
        }
      }
    }
  }

  set((state) => {
    const nextNodes = { ...state.nodes }
    const nextCollections = { ...state.collections }
    let nextRootIds = [...state.rootNodeIds]

    for (const id of allIdsToDelete) {
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

      // 3. Remove from any collections it belongs to
      if ('collectionIds' in node && node.collectionIds) {
        for (const cid of node.collectionIds as CollectionId[]) {
          const col = nextCollections[cid]
          if (col) {
            nextCollections[cid] = { ...col, nodeIds: col.nodeIds.filter((nid) => nid !== id) }
          }
        }
      }

      // 4. Delete the node itself
      delete nextNodes[id]
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds, collections: nextCollections }
  })

  // Mark affected nodes dirty: parents of deleted nodes and their remaining children
  // (e.g. deleting a slab affects sibling walls via level elevation changes)
  parentsToMarkDirty.forEach((parentId) => {
    get().markDirty(parentId)
    const parent = get().nodes[parentId]
    if (parent && 'children' in parent && Array.isArray(parent.children)) {
      for (const childId of parent.children) {
        get().markDirty(childId as AnyNodeId)
      }
    }
  })
}
