/**
 * Node Index Management
 *
 * Utilities for building and maintaining indexes for fast node lookups.
 * Indexes are rebuilt whenever the node tree is modified.
 */

import type { BaseNode, LevelNode, NodeType } from './types'
import { traverseTree } from './utils'

// ============================================================================
// INDEX TYPES
// ============================================================================

/**
 * Collection of all indexes for fast node access
 */
export interface NodeIndexes {
  /** Map from node ID to node */
  byId: Map<string, BaseNode>

  /** Map from node type to set of node IDs */
  byType: Map<NodeType, Set<string>>

  /** Map from parent ID to set of child IDs */
  byParent: Map<string, Set<string>>

  /** Map from level number to level node ID */
  byLevel: Map<number, string>

  /** Map from node ID to its level */
  nodeToLevel: Map<string, number>
}

// ============================================================================
// INDEX BUILDING
// ============================================================================

/**
 * Build all indexes from node tree
 */
export function buildNodeIndexes(levels: LevelNode[]): NodeIndexes {
  const indexes: NodeIndexes = {
    byId: new Map(),
    byType: new Map(),
    byParent: new Map(),
    byLevel: new Map(),
    nodeToLevel: new Map(),
  }

  // Process each level
  for (const level of levels) {
    // Index the level itself
    indexes.byId.set(level.id, level)
    indexes.byLevel.set(level.level, level.id)

    // Add to type index
    if (!indexes.byType.has('level')) {
      indexes.byType.set('level', new Set())
    }
    indexes.byType.get('level')!.add(level.id)

    // Traverse all nodes in the level
    traverseTree(level, ((node, parent) => {
      // Index by ID
      indexes.byId.set(node.id, node)

      // Index by type
      if (!indexes.byType.has(node.type as NodeType)) {
        indexes.byType.set(node.type as NodeType, new Set())
      }
      indexes.byType.get(node.type as NodeType)!.add(node.id)

      // Index by parent
      if (parent) {
        if (!indexes.byParent.has(parent.id)) {
          indexes.byParent.set(parent.id, new Set())
        }
        indexes.byParent.get(parent.id)!.add(node.id)
      }

      // Index node to level mapping
      indexes.nodeToLevel.set(node.id, level.level)
    }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)
  }

  return indexes
}

/**
 * Build minimal node index (just by ID)
 */
export function buildNodeIndex(nodes: BaseNode[]): Map<string, BaseNode> {
  const index = new Map<string, BaseNode>()

  for (const node of nodes) {
    index.set(node.id, node)

    traverseTree(node, ((child) => {
      index.set(child.id, child)
    }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)
  }

  return index
}

// ============================================================================
// INDEX QUERIES
// ============================================================================

/**
 * Get node by ID from indexes
 */
export function getNodeById(indexes: NodeIndexes, id: string): BaseNode | undefined {
  return indexes.byId.get(id)
}

/**
 * Get all nodes of a specific type
 */
export function getNodesByType<T extends BaseNode>(indexes: NodeIndexes, type: NodeType): T[] {
  const ids = indexes.byType.get(type)
  if (!ids) {
    return []
  }

  const nodes: T[] = []
  for (const id of ids) {
    const node = indexes.byId.get(id)
    if (node) {
      nodes.push(node as T)
    }
  }

  return nodes
}

/**
 * Get all children of a node
 */
export function getChildrenOfNode(indexes: NodeIndexes, parentId: string): BaseNode[] {
  const childIds = indexes.byParent.get(parentId)
  if (!childIds) {
    return []
  }

  const children: BaseNode[] = []
  for (const id of childIds) {
    const node = indexes.byId.get(id)
    if (node) {
      children.push(node)
    }
  }

  return children
}

/**
 * Get level node for a given level number
 */
export function getLevelNode(indexes: NodeIndexes, level: number): LevelNode | undefined {
  const levelId = indexes.byLevel.get(level)
  if (!levelId) {
    return
  }

  return indexes.byId.get(levelId) as LevelNode | undefined
}

/**
 * Get the level number for a node
 */
export function getNodeLevel(indexes: NodeIndexes, nodeId: string): number | undefined {
  return indexes.nodeToLevel.get(nodeId)
}

/**
 * Get all nodes in a specific level
 */
export function getNodesInLevel(indexes: NodeIndexes, level: number): BaseNode[] {
  const levelNode = getLevelNode(indexes, level)
  if (!levelNode) {
    return []
  }

  const nodes: BaseNode[] = []
  traverseTree(levelNode, ((node) => {
    if (node.id !== levelNode.id) {
      // Don't include the level node itself
      nodes.push(node)
    }
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)

  return nodes
}

/**
 * Get all nodes of a specific type in a specific level
 */
export function getNodesInLevelByType<T extends BaseNode>(
  indexes: NodeIndexes,
  level: number,
  type: NodeType,
): T[] {
  const levelNode = getLevelNode(indexes, level)
  if (!levelNode) {
    return []
  }

  const nodes: T[] = []
  traverseTree(levelNode, ((node) => {
    if (node.type === type && node.id !== levelNode.id) {
      nodes.push(node as T)
    }
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)

  return nodes
}

// ============================================================================
// INDEX UPDATES
// ============================================================================

/**
 * Update indexes after adding a node
 */
export function addNodeToIndexes(
  indexes: NodeIndexes,
  node: BaseNode,
  parentId: string | null,
  level: number,
): void {
  // Add to ID index
  indexes.byId.set(node.id, node)

  // Add to type index
  if (!indexes.byType.has(node.type as NodeType)) {
    indexes.byType.set(node.type as NodeType, new Set())
  }
  indexes.byType.get(node.type as NodeType)!.add(node.id)

  // Add to parent index
  if (parentId) {
    if (!indexes.byParent.has(parentId)) {
      indexes.byParent.set(parentId, new Set())
    }
    indexes.byParent.get(parentId)!.add(node.id)
  }

  // Add to level mapping
  indexes.nodeToLevel.set(node.id, level)

  // Recursively add children
  traverseTree(node.children, ((child) => {
    addNodeToIndexes(indexes, child, child.parent || null, level)
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)
}

/**
 * Update indexes after removing a node
 */
export function removeNodeFromIndexes(indexes: NodeIndexes, nodeId: string): void {
  const node = indexes.byId.get(nodeId)
  if (!node) {
    return
  }

  // Remove from ID index
  indexes.byId.delete(nodeId)

  // Remove from type index
  const typeSet = indexes.byType.get(node.type as NodeType)
  if (typeSet) {
    typeSet.delete(nodeId)
  }

  // Remove from parent index
  if (node.parent) {
    const parentSet = indexes.byParent.get(node.parent)
    if (parentSet) {
      parentSet.delete(nodeId)
    }
  }

  // Remove from level mapping
  indexes.nodeToLevel.delete(nodeId)

  // Remove all children from index
  const childIds = indexes.byParent.get(nodeId)
  if (childIds) {
    for (const childId of Array.from(childIds)) {
      removeNodeFromIndexes(indexes, childId)
    }
    indexes.byParent.delete(nodeId)
  }
}

/**
 * Update indexes after updating a node
 */
export function updateNodeInIndexes(
  indexes: NodeIndexes,
  nodeId: string,
  updatedNode: BaseNode,
): void {
  // Simply replace in ID index
  indexes.byId.set(nodeId, updatedNode)

  // If type changed, update type index
  const oldNode = indexes.byId.get(nodeId)
  if (oldNode && oldNode.type !== updatedNode.type) {
    // Remove from old type
    const oldTypeSet = indexes.byType.get(oldNode.type as NodeType)
    if (oldTypeSet) {
      oldTypeSet.delete(nodeId)
    }

    // Add to new type
    if (!indexes.byType.has(updatedNode.type as NodeType)) {
      indexes.byType.set(updatedNode.type as NodeType, new Set())
    }
    indexes.byType.get(updatedNode.type as NodeType)!.add(nodeId)
  }

  // If parent changed, update parent index
  if (oldNode && oldNode.parent !== updatedNode.parent) {
    // Remove from old parent
    if (oldNode.parent) {
      const oldParentSet = indexes.byParent.get(oldNode.parent)
      if (oldParentSet) {
        oldParentSet.delete(nodeId)
      }
    }

    // Add to new parent
    if (updatedNode.parent) {
      if (!indexes.byParent.has(updatedNode.parent)) {
        indexes.byParent.set(updatedNode.parent, new Set())
      }
      indexes.byParent.get(updatedNode.parent)!.add(nodeId)
    }
  }
}

// ============================================================================
// INDEX STATISTICS
// ============================================================================

/**
 * Get statistics about the indexes
 */
export function getIndexStats(indexes: NodeIndexes): {
  totalNodes: number
  nodesByType: Record<string, number>
  levelCount: number
  orphanCount: number
} {
  const nodesByType: Record<string, number> = {}

  for (const [type, ids] of indexes.byType.entries()) {
    nodesByType[type] = ids.size
  }

  // Count orphans (nodes without parents that aren't levels)
  let orphanCount = 0
  for (const [id, node] of indexes.byId.entries()) {
    if (node.type !== 'level' && !node.parent) {
      orphanCount++
    }
  }

  return {
    totalNodes: indexes.byId.size,
    nodesByType,
    levelCount: indexes.byLevel.size,
    orphanCount,
  }
}

/**
 * Validate that indexes are consistent
 */
export function validateIndexes(indexes: NodeIndexes): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Check that all nodes in type index exist in ID index
  for (const [type, ids] of indexes.byType.entries()) {
    for (const id of ids) {
      if (!indexes.byId.has(id)) {
        errors.push(`Type index contains non-existent node: ${id} (type: ${type})`)
      }
    }
  }

  // Check that all nodes in parent index exist in ID index
  for (const [parentId, childIds] of indexes.byParent.entries()) {
    if (!indexes.byId.has(parentId)) {
      errors.push(`Parent index contains non-existent parent: ${parentId}`)
    }

    for (const childId of childIds) {
      if (!indexes.byId.has(childId)) {
        errors.push(`Parent index contains non-existent child: ${childId}`)
      }
    }
  }

  // Check that all parent references are valid
  for (const [id, node] of indexes.byId.entries()) {
    if (node.parent && !indexes.byId.has(node.parent)) {
      errors.push(`Node ${id} has invalid parent reference: ${node.parent}`)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
