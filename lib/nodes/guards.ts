/**
 * Type Guards for Node-based Architecture
 *
 * This file contains type guard functions to safely discriminate between
 * different node types at runtime.
 */

import type {
  AnyNode,
  BaseNode,
  BuildingElementNode,
  ColumnNode,
  DoorNode,
  GridItem,
  GridNode,
  GroupNode,
  LevelNode,
  ReferenceImageNode,
  RoofNode,
  RoofSegmentNode,
  ScanNode,
  WallNode,
  WindowNode,
} from './types'

// ============================================================================
// BASE TYPE GUARDS
// ============================================================================

/**
 * Check if a value is a valid node
 */
export function isNode(value: unknown): value is BaseNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'type' in value &&
    'name' in value &&
    'children' in value &&
    typeof (value as BaseNode).id === 'string' &&
    typeof (value as BaseNode).type === 'string' &&
    typeof (value as BaseNode).name === 'string' &&
    Array.isArray((value as BaseNode).children)
  )
}

/**
 * Check if a node has grid positioning
 */
export function isGridNode(node: BaseNode): node is GridNode {
  return (
    'position' in node &&
    'rotation' in node &&
    'size' in node &&
    Array.isArray((node as GridNode).position) &&
    (node as GridNode).position.length === 2 &&
    typeof (node as GridNode).rotation === 'number' &&
    Array.isArray((node as GridNode).size) &&
    (node as GridNode).size.length === 2
  )
}

// ============================================================================
// SPECIFIC NODE TYPE GUARDS
// ============================================================================

/**
 * Check if node is a LevelNode
 */
export function isLevelNode(node: BaseNode): node is LevelNode {
  return node.type === 'level' && 'level' in node && typeof (node as LevelNode).level === 'number'
}

/**
 * Check if node is a WallNode
 */
export function isWallNode(node: BaseNode): node is WallNode {
  return node.type === 'wall' && isGridNode(node)
}

/**
 * Check if node is a DoorNode
 */
export function isDoorNode(node: BaseNode): node is DoorNode {
  return node.type === 'door' && isGridNode(node)
}

/**
 * Check if node is a WindowNode
 */
export function isWindowNode(node: BaseNode): node is WindowNode {
  return node.type === 'window' && isGridNode(node)
}

/**
 * Check if node is a ColumnNode
 */
export function isColumnNode(node: BaseNode): node is ColumnNode {
  return node.type === 'column' && isGridNode(node)
}

/**
 * Check if node is a RoofNode
 */
export function isRoofNode(node: BaseNode): node is RoofNode {
  return node.type === 'roof' && isGridNode(node)
}

/**
 * Check if node is a RoofSegmentNode
 */
export function isRoofSegmentNode(node: BaseNode): node is RoofSegmentNode {
  return (
    node.type === 'roof-segment' &&
    isGridNode(node) &&
    'height' in node &&
    typeof (node as RoofSegmentNode).height === 'number'
  )
}

/**
 * Check if node is a ReferenceImageNode
 */
export function isReferenceImageNode(node: BaseNode): node is ReferenceImageNode {
  return (
    node.type === 'reference-image' &&
    isGridNode(node) &&
    'url' in node &&
    'scale' in node &&
    typeof (node as ReferenceImageNode).url === 'string' &&
    typeof (node as ReferenceImageNode).scale === 'number'
  )
}

/**
 * Check if node is a ScanNode
 */
export function isScanNode(node: BaseNode): node is ScanNode {
  return (
    node.type === 'scan' &&
    isGridNode(node) &&
    'url' in node &&
    'scale' in node &&
    typeof (node as ScanNode).url === 'string' &&
    typeof (node as ScanNode).scale === 'number'
  )
}

/**
 * Check if node is a GroupNode
 */
export function isGroupNode(node: BaseNode): node is GroupNode {
  return node.type === 'group'
}

// ============================================================================
// CATEGORY TYPE GUARDS
// ============================================================================

/**
 * Check if node is a building element (wall, door, window, column, roof)
 */
export function isBuildingElementNode(node: BaseNode): node is BuildingElementNode {
  return (
    isWallNode(node) ||
    isDoorNode(node) ||
    isWindowNode(node) ||
    isColumnNode(node) ||
    isRoofNode(node) ||
    isRoofSegmentNode(node)
  )
}

/**
 * Check if node can be a child of a wall
 */
export function isWallChildNode(node: BaseNode): node is DoorNode | WindowNode {
  return isDoorNode(node) || isWindowNode(node)
}

/**
 * Check if node can be a direct child of a level
 */
export function isLevelChildNode(node: BaseNode): boolean {
  return (
    isWallNode(node) ||
    isRoofNode(node) ||
    isColumnNode(node) ||
    isReferenceImageNode(node) ||
    isScanNode(node) ||
    isGroupNode(node)
  )
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate that a node has required fields
 */
export function validateNode(node: unknown): node is BaseNode {
  if (!isNode(node)) {
    return false
  }

  // Validate visibility if present
  if (node.visible !== undefined && typeof node.visible !== 'boolean') {
    return false
  }

  // Validate opacity if present
  if (node.opacity !== undefined) {
    if (typeof node.opacity !== 'number' || node.opacity < 0 || node.opacity > 100) {
      return false
    }
  }

  // Validate locked if present
  if (node.locked !== undefined && typeof node.locked !== 'boolean') {
    return false
  }

  // Validate parent if present
  if (node.parent !== undefined && typeof node.parent !== 'string') {
    return false
  }

  return true
}

/**
 * Validate grid positioning data
 */
export function validateGridItem(node: BaseNode & Partial<GridItem>): node is GridNode {
  if (!node.position || !Array.isArray(node.position) || node.position.length !== 2) {
    return false
  }

  if (typeof node.position[0] !== 'number' || typeof node.position[1] !== 'number') {
    return false
  }

  if (typeof node.rotation !== 'number') {
    return false
  }

  if (!node.size || !Array.isArray(node.size) || node.size.length !== 2) {
    return false
  }

  if (typeof node.size[0] !== 'number' || typeof node.size[1] !== 'number') {
    return false
  }

  return true
}

/**
 * Validate that a node can be a child of another node
 */
export function canBeChildOf(child: BaseNode, parent: BaseNode): boolean {
  if (isLevelNode(parent)) {
    return isLevelChildNode(child)
  }

  if (isWallNode(parent)) {
    return isWallChildNode(child)
  }

  if (isRoofNode(parent)) {
    return isRoofSegmentNode(child)
  }

  if (isGroupNode(parent)) {
    return isBuildingElementNode(child) || isGroupNode(child)
  }

  // Other nodes don't have children
  return false
}

/**
 * Validate entire node tree structure
 */
export function validateNodeTree(node: BaseNode): boolean {
  // Validate current node
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
