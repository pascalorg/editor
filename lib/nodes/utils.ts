/**
 * Node Tree Utilities
 *
 * Helper functions for working with node trees including traversal,
 * searching, and manipulation.
 */

import type { AnyNode, SceneNodeType as NodeType } from '@/lib/scenegraph/schema/index'
import { type BaseNode, isNode } from './guards'

// ============================================================================
// TREE TRAVERSAL
// ============================================================================

/**
 * Traverse a node tree depth-first, calling visitor for each node
 */
export function traverseTree(
  nodes: BaseNode | BaseNode[],
  visitor: (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined,
  parent: BaseNode | null = null,
  depth = 0,
): void {
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes]

  for (const node of nodeArray) {
    // Call visitor, if it returns false, stop traversal
    const result = visitor(node, parent, depth) as boolean | undefined
    if (result === false) {
      return
    }

    // Traverse children
    if (node.children && node.children.length > 0) {
      traverseTree(node.children, visitor, node, depth + 1)
    }
  }
}

/**
 * Traverse a node tree breadth-first, calling visitor for each node
 */
export function traverseTreeBreadthFirst(
  nodes: BaseNode | BaseNode[],
  visitor: (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined,
): void {
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes]
  const queue: Array<{ node: BaseNode; parent: BaseNode | null; depth: number }> = nodeArray.map(
    (node) => ({ node, parent: null, depth: 0 }),
  )

  while (queue.length > 0) {
    const { node, parent, depth } = queue.shift()!

    // Call visitor, if it returns false, stop traversal
    const result = visitor(node, parent, depth) as boolean | undefined
    if (result === false) {
      return
    }

    // Add children to queue
    if (node.children) {
      for (const child of node.children) {
        queue.push({ node: child, parent: node, depth: depth + 1 })
      }
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
    if (mappedNode.children && mappedNode.children.length > 0) {
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

  traverseTree(nodes, ((node) => {
    if (predicate(node)) {
      results.push(node)
    }
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)

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
 * Find all ancestors of a node
 */
export function findAncestors(nodes: BaseNode | BaseNode[], nodeId: string): BaseNode[] {
  const ancestors: BaseNode[] = []
  const node = findNodeById(nodes, nodeId)

  if (!node?.parent) {
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

  if (node.children) {
    traverseTree(node.children, ((child) => {
      descendants.push(child)
    }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)
  }

  return descendants
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

  return node.children ? getNodeAtPath(node.children, rest) : null
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
        children: [...(node.children || []), { ...newNode, parent: node.id }],
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
    children: (node.children || []).filter((child) => child.id !== nodeId),
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
    children: (node.children || []).map((child) => cloneNode(child)),
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
  traverseTree(nodes, (() => {
    count++
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)
  return count
}

/**
 * Get tree depth
 */
export function getTreeDepth(nodes: BaseNode | BaseNode[]): number {
  let maxDepth = 0
  traverseTree(nodes, ((_node, _parent, depth) => {
    maxDepth = Math.max(maxDepth, depth)
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)
  return maxDepth
}

/**
 * Count nodes by type
 */
export function countNodesByType(nodes: BaseNode | BaseNode[]): Record<string, number> {
  const counts: Record<string, number> = {}

  traverseTree(nodes, ((node) => {
    counts[node.type] = (counts[node.type] || 0) + 1
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)

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

    if (node.children) {
      for (const child of node.children) {
        checkNode(child, newAncestors)
      }
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

  traverseTree(nodes, ((node, parent) => {
    if (parent && node.parent !== parent.id) {
      console.error(`Parent reference mismatch for node ${node.id}`)
      isValid = false
    }
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)

  return isValid
}

// ============================================================================
// WALL-SPECIFIC UTILITIES
// ============================================================================

/**
 * Calculate updated wall coordinates when a wall is moved
 *
 * Walls have special `start` and `end` properties that need to be updated
 * when the wall's position changes. This function calculates the new
 * start/end coordinates based on the position delta.
 *
 * @param originalPosition - The wall's original position
 * @param newPosition - The wall's new position
 * @param originalStart - The wall's original start point
 * @param originalEnd - The wall's original end point
 * @returns Object with updated position, start, and end coordinates
 */
export function calculateWallPositionUpdate(
  originalPosition: [number, number],
  newPosition: [number, number],
  originalStart: [number, number],
  originalEnd: [number, number],
): {
  position: [number, number]
  start: [number, number]
  end: [number, number]
} {
  // Calculate the delta
  const deltaX = newPosition[0] - originalPosition[0]
  const deltaY = newPosition[1] - originalPosition[1]

  // Apply the delta to start and end points
  return {
    position: newPosition,
    start: [originalStart[0] + deltaX, originalStart[1] + deltaY] as [number, number],
    end: [originalEnd[0] + deltaX, originalEnd[1] + deltaY] as [number, number],
  }
}

/**
 * Check if a node is a wall node
 */
export function isWallNode(node: BaseNode): boolean {
  return node.type === 'wall' && 'start' in node && 'end' in node
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Flatten tree to array
 */
export function flattenTree(nodes: BaseNode | BaseNode[]): BaseNode[] {
  const result: BaseNode[] = []
  traverseTree(nodes, ((node) => {
    result.push(node)
  }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)
  return result
}

/**
 * Get all leaf nodes (nodes without children)
 */
export function getLeafNodes(nodes: BaseNode | BaseNode[]): BaseNode[] {
  return findNodes(nodes, (node) => !node.children || node.children.length === 0)
}

/**
 * Get all parent nodes (nodes with children)
 */
export function getParentNodes(nodes: BaseNode | BaseNode[]): BaseNode[] {
  return findNodes(nodes, (node) => !!node.children && node.children.length > 0)
}
