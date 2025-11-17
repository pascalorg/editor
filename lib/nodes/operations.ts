/**
 * Node Operations API
 *
 * High-level operations for manipulating the node tree.
 * These operations maintain immutability and return updated trees.
 */

import type { LevelNode, ReferenceImageNode, ScanNode } from './types'
import { updateNode as updateNodeUtil } from './utils'

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
