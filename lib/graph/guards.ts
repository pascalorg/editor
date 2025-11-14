/**
 * Type Guards for Node-based Architecture
 *
 * This file contains GENERIC type guard functions that work with any node type.
 * Specific node type guards are defined in their respective component files.
 */

import { nodeSchemaRegistry } from './schema'
import type { BaseNode } from './types'

// ============================================================================
// BASE TYPE GUARDS
// ============================================================================

/**
 * Check if a value is a valid node (using schema validation)
 */
export function isNode(value: unknown): value is BaseNode {
  if (typeof value !== 'object' || value === null) return false
  if (!('type' in value)) return false

  const nodeType = (value as any).type
  if (typeof nodeType !== 'string') return false

  // Try to validate with registered schema
  return nodeSchemaRegistry.validate(nodeType, value)
}

/**
 * Check if a node has grid positioning
 */
export function isGridNode(node: BaseNode): boolean {
  return (
    'position' in node &&
    'rotation' in node &&
    'size' in node &&
    Array.isArray((node as any).position) &&
    (node as any).position.length === 2 &&
    typeof (node as any).rotation === 'number' &&
    Array.isArray((node as any).size) &&
    (node as any).size.length === 2
  )
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate that a node has required fields (using schema)
 */
export function validateNode(node: unknown): node is BaseNode {
  return isNode(node)
}

/**
 * Validate grid positioning data
 */
export function validateGridItem(node: BaseNode): boolean {
  return isGridNode(node)
}

/**
 * Validate that a node can be a child of another node
 * This uses generic rules based on node types
 */
export function canBeChildOf(child: BaseNode, parent: BaseNode): boolean {
  // Get schemas for validation
  const parentSchema = nodeSchemaRegistry.get(parent.type)
  const childSchema = nodeSchemaRegistry.get(child.type)

  if (!(parentSchema && childSchema)) {
    // Fallback to basic rules
    if (parent.type === 'level') {
      // Levels can contain most building elements
      return ['wall', 'roof', 'column', 'slab', 'reference-image', 'scan', 'group'].includes(
        child.type,
      )
    }
    if (parent.type === 'wall') {
      // Walls can contain doors and windows
      return ['door', 'window'].includes(child.type)
    }
    if (parent.type === 'roof') {
      // Roofs can contain roof segments
      return child.type === 'roof-segment'
    }
    if (parent.type === 'group') {
      // Groups can contain building elements and other groups
      return ['wall', 'roof', 'column', 'door', 'window', 'group', 'slab'].includes(child.type)
    }
    return false
  }

  // If schemas exist, assume they handle validation
  return true
}

/**
 * Validate entire node tree structure
 */
export function validateNodeTree(node: BaseNode): boolean {
  // Validate current node using schema
  if (!validateNode(node)) {
    return false
  }

  // Validate children
  for (const child of node.children) {
    // Check child is valid
    if (!validateNode(child)) {
      return false
    }

    // Check child can be a child of this node
    if (!canBeChildOf(child, node)) {
      return false
    }

    // Check parent reference matches
    if (child.parent && child.parent !== node.id) {
      return false
    }

    // Recursively validate child tree
    if (!validateNodeTree(child)) {
      return false
    }
  }

  return true
}

// ============================================================================
// TYPE ASSERTION HELPERS
// ============================================================================

/**
 * Assert that a value is a node, throws if not
 */
export function assertNode(value: unknown): asserts value is BaseNode {
  if (!isNode(value)) {
    throw new Error('Value is not a valid node')
  }
}

/**
 * Assert that a node is of a specific type, throws if not
 */
export function assertNodeType<T extends BaseNode>(
  node: BaseNode,
  type: string,
  guard: (node: BaseNode) => node is T,
): asserts node is T {
  if (!guard(node)) {
    throw new Error(`Node ${node.id} is not of type ${type}`)
  }
}

/**
 * Get typed node or throw error
 */
export function getTypedNode<T extends BaseNode>(
  node: BaseNode,
  guard: (node: BaseNode) => node is T,
  typeName: string,
): T {
  assertNodeType(node, typeName, guard)
  return node
}
