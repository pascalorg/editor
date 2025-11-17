/**
 * Node Operations API
 *
 * High-level operations for manipulating the node tree.
 * These operations maintain immutability and return updated trees.
 */

import { canBeChildOf, isLevelNode } from './guards'
import type { BaseNode, LevelNode, ReferenceImageNode, ScanNode } from './types'
import { addNode as addNodeUtil, findNodeById, updateNode as updateNodeUtil } from './utils'

// ============================================================================
// LEVEL OPERATIONS
// ============================================================================

/**
 * Add a new level to the tree
 */
export function addLevel(
  levels: LevelNode[],
  level: Omit<LevelNode, 'children'> & { children?: BaseNode[] },
): LevelNode[] {
  const newLevel: LevelNode = {
    ...level,
    children: (level.children || []) as LevelNode['children'],
  }

  return [...levels, newLevel]
}

/**
 * Remove a level and all its children
 */
export function removeLevel(levels: LevelNode[], levelId: string): LevelNode[] {
  return levels.filter((l) => l.id !== levelId)
}

/**
 * Update a level's properties
 */
export function updateLevel(
  levels: LevelNode[],
  levelId: string,
  updates: Partial<Omit<LevelNode, 'id' | 'type' | 'children'>>,
): LevelNode[] {
  return levels.map((level) => (level.id === levelId ? { ...level, ...updates } : level))
}

/**
 * Get level by ID
 */
export function getLevel(levels: LevelNode[], levelId: string): LevelNode | null {
  return levels.find((l) => l.id === levelId) || null
}

/**
 * Get level by level number
 */
export function getLevelByNumber(levels: LevelNode[], levelNumber: number): LevelNode | null {
  return levels.find((l) => l.level === levelNumber) || null
}

// ============================================================================
// NODE ADDITION OPERATIONS
// ============================================================================

/**
 * Add a reference image to a level
 */
export function addReferenceImageToLevel(
  levels: LevelNode[],
  levelId: string,
  image: Omit<ReferenceImageNode, 'parent'>,
): LevelNode[] {
  return levels.map((level) => {
    if (level.id === levelId) {
      return {
        ...level,
        children: [...level.children, { ...image, parent: levelId }],
      }
    }
    return level
  })
}

/**
 * Add a scan to a level
 */
export function addScanToLevel(
  levels: LevelNode[],
  levelId: string,
  scan: Omit<ScanNode, 'parent'>,
): LevelNode[] {
  return levels.map((level) => {
    if (level.id === levelId) {
      return {
        ...level,
        children: [...level.children, { ...scan, parent: levelId }],
      }
    }
    return level
  })
}

/**
 * Generic add node operation with validation
 */
export function addNodeToParent(
  levels: LevelNode[],
  parentId: string | null,
  node: BaseNode,
): LevelNode[] {
  if (parentId === null) {
    // Adding to root level
    if (isLevelNode(node as any)) {
      return [...levels, node as LevelNode]
    }
    throw new Error('Can only add LevelNode to root')
  }

  // Find parent and validate
  const parent = findNodeById(levels, parentId)
  if (!parent) {
    throw new Error(`Parent node ${parentId} not found`)
  }

  if (!canBeChildOf(node, parent)) {
    throw new Error(`Node of type ${node.type} cannot be child of ${parent.type}`)
  }

  // Use utility function
  return addNodeUtil(levels, parentId, { ...node, parent: parentId }) as LevelNode[]
}

// ============================================================================
// NODE UPDATE OPERATIONS
// ============================================================================

/**
 * Update node visibility
 */
export function setNodeVisibility(
  levels: LevelNode[],
  nodeId: string,
  visible: boolean,
): LevelNode[] {
  return updateNodeUtil(levels, nodeId, { visible }) as LevelNode[]
}

/**
 * Update node opacity
 */
export function setNodeOpacity(levels: LevelNode[], nodeId: string, opacity: number): LevelNode[] {
  const clampedOpacity = Math.max(0, Math.min(100, opacity))
  return updateNodeUtil(levels, nodeId, { opacity: clampedOpacity }) as LevelNode[]
}
