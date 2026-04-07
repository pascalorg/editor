import type { AnyNode, AnyNodeId } from '../../schema'
import type { CollectionId } from '../../schema/collections'
import type { SceneState } from '../use-scene'

type AnyContainerNode = AnyNode & { children: string[] }

// Track pending RAF for updateNodesAction to prevent multiple queued callbacks
let pendingRafId: number | null = null
let pendingUpdates: Set<AnyNodeId> = new Set()

export const createNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ops: { node: AnyNode; parentId?: AnyNodeId }[],
) => {
  if (get().readOnly) return
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
  if (get().readOnly) return
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

  // Batch dirty-marking into a single RAF to avoid redundant callbacks during rapid updates
  for (const u of updates) {
    pendingUpdates.add(u.id)
  }
  for (const pId of parentsToUpdate) {
    pendingUpdates.add(pId)
  }

  if (pendingRafId !== null) {
    cancelAnimationFrame(pendingRafId)
  }

  pendingRafId = requestAnimationFrame(() => {
    pendingUpdates.forEach((id) => {
      get().markDirty(id)
    })
    pendingUpdates.clear()
    pendingRafId = null
  })
}

export const deleteNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ids: AnyNodeId[],
) => {
  if (get().readOnly) return
  const parentsToMarkDirty = new Set<AnyNodeId>()

  set((state) => {
    const nextNodes = { ...state.nodes }
    const nextCollections = { ...state.collections }
    let nextRootIds = [...state.rootNodeIds]

    // Collect all ids to delete (the requested ids + all their descendants) before
    // mutating anything, so the recursive walk reads consistent state.
    const allIds = new Set<AnyNodeId>()
    const collect = (id: AnyNodeId) => {
      if (allIds.has(id)) return
      allIds.add(id)
      const node = nextNodes[id]
      if (node && 'children' in node) {
        for (const cid of node.children as AnyNodeId[]) collect(cid)
      }
    }
    for (const id of ids) collect(id)

    for (const id of allIds) {
      const node = nextNodes[id]
      if (!node) continue

      // 1. Remove reference from parent — only if the parent itself is NOT also being deleted
      const parentId = node.parentId as AnyNodeId | null
      if (parentId && nextNodes[parentId] && !allIds.has(parentId)) {
        const parent = nextNodes[parentId] as AnyContainerNode
        if (parent.children) {
          nextNodes[parent.id] = {
            ...parent,
            children: parent.children.filter((cid) => cid !== id),
          } as AnyNode
          parentsToMarkDirty.add(parent.id)
        }
      }

      // 2. Remove from root list
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
