import type { AnyNode, AnyNodeId } from '../schema'
import type { Collection, CollectionId } from '../schema/collections'
import { generateId } from '../schema/base'

export type SceneGraph = {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  collections?: Record<CollectionId, Collection>
}

/**
 * Extracts the type prefix from a node ID (e.g., "wall_abc123" -> "wall")
 */
function extractIdPrefix(id: string): string {
  const underscoreIndex = id.indexOf('_')
  return underscoreIndex === -1 ? 'node' : id.slice(0, underscoreIndex)
}

/**
 * Resolves a child reference to a node ID.
 * Supports both string IDs and embedded child node objects with an `id` field.
 */
function resolveChildRefId(child: unknown): string | undefined {
  if (typeof child === 'string') {
    return child
  }

  if (child && typeof child === 'object' && 'id' in child) {
    const id = (child as { id?: unknown }).id
    if (typeof id === 'string') {
      return id
    }
  }

  return undefined
}

/**
 * Deep clones a scene graph with all node IDs regenerated while preserving
 * parent-child relationships and other internal references.
 *
 * This is useful for:
 * - Copying nodes between different projects
 * - Duplicating a subset of a scene within the same project
 * - Multi-scene in-memory scenarios
 */
export function cloneSceneGraph(sceneGraph: SceneGraph): SceneGraph {
  const { nodes, rootNodeIds, collections } = sceneGraph

  // Build ID mapping: old ID -> new ID
  const idMap = new Map<string, string>()

  // Pass 1: Generate new IDs for all nodes
  for (const nodeId of Object.keys(nodes)) {
    const prefix = extractIdPrefix(nodeId)
    idMap.set(nodeId, generateId(prefix))
  }

  // Pass 2: Clone nodes with remapped references
  const clonedNodes = {} as Record<AnyNodeId, AnyNode>

  for (const [oldId, node] of Object.entries(nodes)) {
    const newId = idMap.get(oldId)! as AnyNodeId
    const clonedNode = { ...node, id: newId } as AnyNode

    // Remap parentId
    if (clonedNode.parentId && typeof clonedNode.parentId === 'string') {
      clonedNode.parentId = (idMap.get(clonedNode.parentId) ?? null) as AnyNodeId | null
    }

    // Remap children array (walls, levels, buildings, sites, items can have children)
    if ('children' in clonedNode && Array.isArray(clonedNode.children)) {
      ;(clonedNode as Record<string, unknown>).children = clonedNode.children
        .map((childRef) => {
          const childId = resolveChildRefId(childRef)
          return childId ? idMap.get(childId) : undefined
        })
        .filter((id): id is string => id !== undefined) as string[]
    }

    // Remap wallId (items/doors/windows attached to walls)
    if ('wallId' in clonedNode && typeof clonedNode.wallId === 'string') {
      ;(clonedNode as Record<string, unknown>).wallId = idMap.get(clonedNode.wallId) as
        | string
        | undefined
    }

    clonedNodes[newId] = clonedNode
  }

  // Remap root node IDs
  const clonedRootNodeIds = rootNodeIds
    .map((id) => idMap.get(id))
    .filter((id): id is string => id !== undefined) as AnyNodeId[]

  // Clone and remap collections if present
  let clonedCollections: Record<CollectionId, Collection> | undefined
  if (collections) {
    clonedCollections = {} as Record<CollectionId, Collection>
    const collectionIdMap = new Map<string, CollectionId>()

    // Generate new collection IDs
    for (const collectionId of Object.keys(collections)) {
      collectionIdMap.set(collectionId, generateId('collection'))
    }

    for (const [oldCollectionId, collection] of Object.entries(collections)) {
      const newCollectionId = collectionIdMap.get(oldCollectionId)!
      clonedCollections[newCollectionId] = {
        ...collection,
        id: newCollectionId,
        nodeIds: collection.nodeIds
          .map((nodeId) => idMap.get(nodeId))
          .filter((id): id is string => id !== undefined) as AnyNodeId[],
        controlNodeId: collection.controlNodeId
          ? (idMap.get(collection.controlNodeId) as AnyNodeId | undefined)
          : undefined,
      }

      // Update collectionIds on nodes that reference this collection
      for (const oldNodeId of collection.nodeIds) {
        const newNodeId = idMap.get(oldNodeId)
        if (newNodeId && clonedNodes[newNodeId as AnyNodeId]) {
          const node = clonedNodes[newNodeId as AnyNodeId] as Record<string, unknown>
          if ('collectionIds' in node && Array.isArray(node.collectionIds)) {
            const oldColIds = node.collectionIds as string[]
            node.collectionIds = oldColIds
              .map((cid) => collectionIdMap.get(cid))
              .filter((id): id is CollectionId => id !== undefined)
          }
        }
      }
    }
  }

  return {
    nodes: clonedNodes,
    rootNodeIds: clonedRootNodeIds,
    ...(clonedCollections && { collections: clonedCollections }),
  }
}