import type { AnyNode, AnyNodeId } from '../schema'
import { generateId } from '../schema/base'
import type { Collection, CollectionId } from '../schema/collections'

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
 * Deep clones a scene graph with all node IDs regenerated while preserving
 * parent-child relationships and other internal references.
 *
 * This is useful for:
 * - Duplicating a project (host app creates a new project record, then loads the cloned scene)
 * - Copying nodes between different projects
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

  // Pass 2: Deep clone nodes with remapped references
  const clonedNodes = {} as Record<AnyNodeId, AnyNode>

  for (const [oldId, node] of Object.entries(nodes)) {
    const newId = idMap.get(oldId)! as AnyNodeId
    const clonedNode = structuredClone({ ...node, id: newId }) as AnyNode

    // Remap parentId
    if (clonedNode.parentId && typeof clonedNode.parentId === 'string') {
      clonedNode.parentId = (idMap.get(clonedNode.parentId) ?? null) as AnyNodeId | null
    }

    // Remap children array (buildings, levels, walls, items, etc.)
    // Children can be either string IDs or embedded node objects (with an `id` property).
    // Normalize both forms to remapped string IDs.
    if ('children' in clonedNode && Array.isArray(clonedNode.children)) {
      ;(clonedNode as Record<string, unknown>).children = (clonedNode.children as unknown[])
        .map((child) => {
          if (typeof child === 'string') return idMap.get(child)
          if (
            child &&
            typeof child === 'object' &&
            'id' in child &&
            typeof (child as any).id === 'string'
          ) {
            return idMap.get((child as any).id)
          }
          return undefined
        })
        .filter((id): id is string => id !== undefined)
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

/**
 * Deep clones a level node and all its descendants with fresh IDs.
 * All internal references (parentId, children, wallId) are remapped to the new IDs.
 * The cloned level node's parentId is preserved (building ID) — not remapped.
 *
 * Unlike `cloneSceneGraph` (which operates on serialized data), this function works
 * on live runtime nodes that may have non-serializable properties (Three.js objects,
 * etc.). It uses JSON roundtrip to safely strip them.
 *
 * @returns clonedNodes - flat array of all cloned nodes (level + descendants)
 * @returns newLevelId - the ID of the cloned level node
 * @returns idMap - old ID → new ID mapping
 */
export function cloneLevelSubtree(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: AnyNodeId,
): { clonedNodes: AnyNode[]; newLevelId: AnyNodeId; idMap: Map<string, string> } {
  const levelNode = nodes[levelId]
  if (!levelNode || levelNode.type !== 'level') {
    throw new Error(`Node "${levelId}" is not a level`)
  }

  // Recursively collect the level node + all descendants via children arrays
  const subtreeIds = new Set<AnyNodeId>()
  const collect = (id: AnyNodeId) => {
    if (subtreeIds.has(id)) return
    const node = nodes[id]
    if (!node) return
    subtreeIds.add(id)
    if ('children' in node && Array.isArray(node.children)) {
      for (const childId of node.children as AnyNodeId[]) {
        collect(childId)
      }
    }
  }
  collect(levelId)

  // Build ID mapping: old → new
  const idMap = new Map<string, string>()
  for (const oldId of subtreeIds) {
    const prefix = extractIdPrefix(oldId)
    idMap.set(oldId, generateId(prefix))
  }

  const newLevelId = idMap.get(levelId)! as AnyNodeId

  // Clone each node with remapped references.
  // Use JSON roundtrip instead of structuredClone because live runtime nodes may
  // carry non-serializable properties (Three.js Object3D refs, functions, etc.)
  // that structuredClone would throw on.
  const clonedNodes: AnyNode[] = []
  for (const oldId of subtreeIds) {
    const node = nodes[oldId]
    if (!node) continue

    const newId = idMap.get(oldId)! as AnyNodeId

    // JSON roundtrip: safely strips functions, Object3D, circular refs, etc.
    const cloned = JSON.parse(JSON.stringify(node)) as AnyNode
    ;(cloned as Record<string, unknown>).id = newId

    // Remap parentId — but only for descendants, not the level node itself
    // (the level's parentId points to the building, which is outside the subtree)
    if (oldId !== levelId && cloned.parentId && typeof cloned.parentId === 'string') {
      cloned.parentId = (idMap.get(cloned.parentId) ?? cloned.parentId) as AnyNodeId | null
    }

    // Remap children array
    if ('children' in cloned && Array.isArray(cloned.children)) {
      ;(cloned as Record<string, unknown>).children = (cloned.children as unknown[])
        .map((child) => {
          if (typeof child === 'string') return idMap.get(child) ?? child
          if (
            child &&
            typeof child === 'object' &&
            'id' in child &&
            typeof (child as any).id === 'string'
          ) {
            return idMap.get((child as any).id) ?? (child as any).id
          }
          return child
        })
        .filter((id): id is string => typeof id === 'string')
    }

    // Remap wallId (doors/windows attached to walls)
    if ('wallId' in cloned && typeof cloned.wallId === 'string') {
      ;(cloned as Record<string, unknown>).wallId = idMap.get(cloned.wallId) ?? cloned.wallId
    }

    clonedNodes.push(cloned)
  }

  return { clonedNodes, newLevelId, idMap }
}

/**
 * Forks a scene graph for use as a new project: clones with new IDs and strips
 * scan and guide nodes (and their references) since those contain user-uploaded
 * imagery that shouldn't carry over to a forked project.
 */
export function forkSceneGraph(sceneGraph: SceneGraph): SceneGraph {
  const { nodes, rootNodeIds, collections } = sceneGraph

  // First, identify scan and guide node IDs to exclude (user-uploaded imagery)
  const excludedNodeIds = new Set<string>()
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.type === 'scan' || node.type === 'guide') {
      excludedNodeIds.add(nodeId)
    }
  }

  // Build a filtered scene graph without scan nodes
  const filteredNodes = {} as Record<AnyNodeId, AnyNode>
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (excludedNodeIds.has(nodeId)) continue

    const clonedNode = structuredClone(node) as AnyNode

    // Remove scan children from any parent that references them.
    // Children can be string IDs or embedded node objects.
    if ('children' in clonedNode && Array.isArray(clonedNode.children)) {
      ;(clonedNode as Record<string, unknown>).children = (clonedNode.children as unknown[]).filter(
        (child) => {
          const childId =
            typeof child === 'string'
              ? child
              : child && typeof child === 'object' && 'id' in child
                ? (child as any).id
                : null
          return childId ? !excludedNodeIds.has(childId) : true
        },
      )
    }

    filteredNodes[nodeId as AnyNodeId] = clonedNode
  }

  const filteredRootNodeIds = rootNodeIds.filter((id) => !excludedNodeIds.has(id))

  // Filter collections to remove references to scan nodes
  let filteredCollections: Record<CollectionId, Collection> | undefined
  if (collections) {
    filteredCollections = {} as Record<CollectionId, Collection>
    for (const [collectionId, collection] of Object.entries(collections)) {
      const filteredNodeIds = collection.nodeIds.filter((id) => !excludedNodeIds.has(id))
      if (filteredNodeIds.length > 0) {
        filteredCollections[collectionId as CollectionId] = {
          ...collection,
          nodeIds: filteredNodeIds as AnyNodeId[],
          controlNodeId:
            collection.controlNodeId && excludedNodeIds.has(collection.controlNodeId)
              ? undefined
              : collection.controlNodeId,
        }
      }
    }
  }

  // Now clone the filtered graph with new IDs
  return cloneSceneGraph({
    nodes: filteredNodes,
    rootNodeIds: filteredRootNodeIds,
    ...(filteredCollections && { collections: filteredCollections }),
  })
}
