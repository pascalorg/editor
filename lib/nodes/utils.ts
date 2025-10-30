/**
 * Node Tree Utilities
 *
 * Helper functions for working with node trees including traversal,
 * searching, and manipulation.
 */

import { isNode } from './guards'
import type { AnyNode, BaseNode, NodeType } from './types'

// ============================================================================
// TREE TRAVERSAL
// ============================================================================

/**
 * Traverse a node tree depth-first, calling visitor for each node
 */
export function traverseTree(
  nodes: BaseNode | BaseNode[],
  visitor: (node: BaseNode, parent: BaseNode | null, depth: number) => void | boolean,
  parent: BaseNode | null = null,
  depth = 0,
): void {
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes]

  for (const node of nodeArray) {
    // Call visitor, if it returns false, stop traversal
    const result = visitor(node, parent, depth)
    if (result === false) {
      return
    }

    // Traverse children
    if (node.children.length > 0) {
      traverseTree(node.children, visitor, node, depth + 1)
    }
  }
}

/**
 * Traverse a node tree breadth-first, calling visitor for each node
 */
export function traverseTreeBreadthFirst(
  nodes: BaseNode | BaseNode[],
  visitor: (node: BaseNode, parent: BaseNode | null, depth: number) => void | boolean,
): void {
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes]
  const queue: Array<{ node: BaseNode; parent: BaseNode | null; depth: number }> = nodeArray.map(
    (node) => ({ node, parent: null, depth: 0 }),
  )

  while (queue.length > 0) {
    const { node, parent, depth } = queue.shift()!

    // Call visitor, if it returns false, stop traversal
    const result = visitor(node, parent, depth)
    if (result === false) {
      return
    }

    // Add children to queue
    for (const child of node.children) {
      queue.push({ node: child, parent: node, depth: depth + 1 })
    }
  }
}

/**
 * Map over a node tree, transforming each node
 */
export function mapTree<T extends BaseNode>(
  nodes: T | T[],
  mapper: (node: T, parent: T | null, depth: number) => T,
  parent: T | null = null,
  depth = 0,
): T | T[] {
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes]
  const isArray = Array.isArray(nodes)

  const mapped = nodeArray.map((node) => {
    const mappedNode = mapper(node, parent, depth)

    // Map children recursively
    if (mappedNode.children.length > 0) {
      mappedNode.children = mapTree(
        mappedNode.children as T[],
        mapper,
        mappedNode,
        depth + 1,
      ) as BaseNode[]
    }

    return mappedNode
  })

  return isArray ? mapped : mapped[0]
}

// ============================================================================
// SEARCHING
// ============================================================================

/**
 * Find a node by ID in the tree
 */
export function findNodeById(nodes: BaseNode | BaseNode[], id: string): BaseNode | null {
  let found: BaseNode | null = null

  traverseTree(nodes, (node) => {
    if (node.id === id) {
      found = node
      return false // Stop traversal
    }
  })

  return found
}

/**
 * Find all nodes matching a predicate
 */
export function findNodes(
  nodes: BaseNode | BaseNode[],
  predicate: (node: BaseNode) => boolean,
): BaseNode[] {
  const results: BaseNode[] = []

  traverseTree(nodes, (node) => {
    if (predicate(node)) {
      results.push(node)
    }
  })

  return results
}

/**
 * Find all nodes of a specific type
 */
export function findNodesByType<T extends BaseNode>(
  nodes: BaseNode | BaseNode[],
  type: NodeType,
): T[] {
  return findNodes(nodes, (node) => node.type === type) as T[]
}

/**
 * Find parent of a node
 */
export function findParentNode(nodes: BaseNode | BaseNode[], childId: string): BaseNode | null {
  let parent: BaseNode | null = null

  traverseTree(nodes, (node) => {
    if (node.children.some((child) => child.id === childId)) {
      parent = node
      return false // Stop traversal
    }
  })

  return parent
}

/**
 * Find all ancestors of a node
 */
export function findAncestors(nodes: BaseNode | BaseNode[], nodeId: string): BaseNode[] {
  const ancestors: BaseNode[] = []
  const node = findNodeById(nodes, nodeId)

  if (!(node && node.parent)) {
    return ancestors
  }

  let currentId: string | undefined = node.parent
  while (currentId) {
    const parent = findNodeById(nodes, currentId)
    if (parent) {
      ancestors.push(parent)
      currentId = parent.parent
    } else {
      break
    }
  }

  return ancestors
}

/**
 * Find all descendants of a node
 */
export function findDescendants(node: BaseNode): BaseNode[] {
  const descendants: BaseNode[] = []

  traverseTree(node.children, (child) => {
    descendants.push(child)
  })

  return descendants
}

/**
 * Find siblings of a node
 */
export function findSiblings(nodes: BaseNode | BaseNode[], nodeId: string): BaseNode[] {
  const parent = findParentNode(nodes, nodeId)
  if (!parent) {
    return []
  }

  return parent.children.filter((child) => child.id !== nodeId)
}

// ============================================================================
// PATH OPERATIONS
// ============================================================================

/**
 * Get path from root to node (array of IDs)
 */
export function getNodePath(nodes: BaseNode | BaseNode[], nodeId: string): string[] {
  const ancestors = findAncestors(nodes, nodeId)
  return [...ancestors.reverse().map((a) => a.id), nodeId]
}

/**
 * Get node at path
 */
export function getNodeAtPath(nodes: BaseNode | BaseNode[], path: string[]): BaseNode | null {
  if (path.length === 0) {
    return null
  }

  const [first, ...rest] = path
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes]
  const node = nodeArray.find((n) => n.id === first)

  if (!node) {
    return null
  }

  if (rest.length === 0) {
    return node
  }

  return getNodeAtPath(node.children, rest)
}

// ============================================================================
// TREE MANIPULATION
// ============================================================================

/**
 * Add a node to the tree at a specific parent
 */
export function addNode(nodes: BaseNode[], parentId: string | null, newNode: BaseNode): BaseNode[] {
  if (parentId === null) {
    // Add to root level
    return [...nodes, newNode]
  }

  return mapTree(nodes, (node) => {
    if (node.id === parentId) {
      return {
        ...node,
        children: [...node.children, { ...newNode, parent: node.id }],
      }
    }
    return node
  }) as BaseNode[]
}

/**
 * Remove a node from the tree
 */
export function removeNode(nodes: BaseNode[], nodeId: string): BaseNode[] {
  const result = mapTree(nodes, (node) => ({
    ...node,
    children: node.children.filter((child) => child.id !== nodeId),
  })) as BaseNode[]
  return result.filter((node) => node.id !== nodeId)
}

/**
 * Update a node in the tree
 */
export function updateNode(
  nodes: BaseNode[],
  nodeId: string,
  updates: Partial<BaseNode>,
): BaseNode[] {
  return mapTree(nodes, (node) => {
    if (node.id === nodeId) {
      return { ...node, ...updates }
    }
    return node
  }) as BaseNode[]
}

/**
 * Move a node to a new parent
 */
export function moveNode(
  nodes: BaseNode[],
  nodeId: string,
  newParentId: string | null,
): BaseNode[] {
  const node = findNodeById(nodes, nodeId)
  if (!node) {
    return nodes
  }

  // Remove from current location
  let updated = removeNode(nodes, nodeId)

  // Add to new location
  updated = addNode(updated, newParentId, { ...node, parent: newParentId ?? undefined })

  return updated
}

/**
 * Clone a node (deep copy)
 */
export function cloneNode<T extends BaseNode>(node: T, newId?: string): T {
  return {
    ...node,
    id: newId ?? `${node.id}-copy`,
    children: node.children.map((child) => cloneNode(child)),
  }
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Count total nodes in tree
 */
export function countNodes(nodes: BaseNode | BaseNode[]): number {
  let count = 0
  traverseTree(nodes, () => {
    count++
  })
  return count
}

/**
 * Get tree depth
 */
export function getTreeDepth(nodes: BaseNode | BaseNode[]): number {
  let maxDepth = 0
  traverseTree(nodes, (_node, _parent, depth) => {
    maxDepth = Math.max(maxDepth, depth)
  })
  return maxDepth
}

/**
 * Count nodes by type
 */
export function countNodesByType(nodes: BaseNode | BaseNode[]): Record<string, number> {
  const counts: Record<string, number> = {}

  traverseTree(nodes, (node) => {
    counts[node.type] = (counts[node.type] || 0) + 1
  })

  return counts
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Check if tree has circular references
 */
export function hasCircularReferences(nodes: BaseNode | BaseNode[]): boolean {
  const visited = new Set<string>()
  let hasCircular = false

  function checkNode(node: BaseNode, ancestors: Set<string>): void {
    if (ancestors.has(node.id)) {
      hasCircular = true
      return
    }

    visited.add(node.id)
    const newAncestors = new Set([...ancestors, node.id])

    for (const child of node.children) {
      checkNode(child, newAncestors)
    }
  }

  const nodeArray = Array.isArray(nodes) ? nodes : [nodes]
  for (const node of nodeArray) {
    checkNode(node, new Set())
  }

  return hasCircular
}

/**
 * Validate parent-child references are consistent
 */
export function validateParentReferences(nodes: BaseNode | BaseNode[]): boolean {
  let isValid = true

  traverseTree(nodes, (node, parent) => {
    if (parent && node.parent !== parent.id) {
      console.error(`Parent reference mismatch for node ${node.id}`)
      isValid = false
    }
  })

  return isValid
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Flatten tree to array
 */
export function flattenTree(nodes: BaseNode | BaseNode[]): BaseNode[] {
  const result: BaseNode[] = []
  traverseTree(nodes, (node) => {
    result.push(node)
  })
  return result
}

/**
 * Get all leaf nodes (nodes without children)
 */
export function getLeafNodes(nodes: BaseNode | BaseNode[]): BaseNode[] {
  return findNodes(nodes, (node) => node.children.length === 0)
}

/**
 * Get all parent nodes (nodes with children)
 */
export function getParentNodes(nodes: BaseNode | BaseNode[]): BaseNode[] {
  return findNodes(nodes, (node) => node.children.length > 0)
}

/**
 * Filter tree nodes
 */
export function filterTree(
  nodes: BaseNode | BaseNode[],
  predicate: (node: BaseNode) => boolean,
): BaseNode[] {
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes]

  return nodeArray.filter(predicate).map((node) => ({
    ...node,
    children: filterTree(node.children, predicate),
  }))
}
