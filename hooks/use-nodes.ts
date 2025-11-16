/**
 * useNodes Hook
 *
 * React hooks for accessing node-based data from the store.
 * Provides a clean API for components to work with the node tree.
 */

'use client'

import { useShallow } from 'zustand/react/shallow'
import {
  selectColumnsFromLevel,
  selectDoorsFromLevel,
  selectLevelById,
  selectLevels,
  selectNodeById,
  selectNodesOfTypeFromLevel,
  selectReferenceImagesFromLevel,
  selectRoofsFromLevel,
  selectScansFromLevel,
  selectVisibleReferenceImagesFromLevel,
  selectVisibleScansFromLevel,
  selectVisibleWallsFromLevel,
  selectWallsFromLevel,
  selectWindowsFromLevel,
} from '../lib/nodes/selectors'

import type {
  BaseNode,
  ColumnNode,
  DoorNode,
  LevelNode,
  NodeType,
  ReferenceImageNode,
  RoofNode,
  ScanNode,
  WallNode,
  WindowNode,
} from '../lib/nodes/types'
import { useEditor } from './use-editor'

// ============================================================================
// BASIC HOOKS
// ============================================================================

/**
 * Get all levels
 */
export function useLevels(): LevelNode[] {
  return useEditor(selectLevels)
}

/**
 * Get a specific level by ID
 */
export function useLevel(levelId: string): LevelNode | null {
  return useEditor(selectLevelById(levelId))
}

/**
 * Get a specific node by ID
 */
export function useNode(nodeId: string): BaseNode | null {
  return useEditor(selectNodeById(nodeId))
}

/**
 * Get a node by ID using the fast index lookup
 */
export function useNodeFromIndex(nodeId: string): BaseNode | undefined {
  return useEditor((state) => state.nodeIndex.get(nodeId))
}

// ============================================================================
// LEVEL CHILDREN HOOKS
// ============================================================================

/**
 * Get all children of a specific level
 */
export function useLevelChildren(levelId: string): BaseNode[] {
  return useEditor((state) => {
    const building = state.root.children[0]
    const levels = building ? building.children : []
    const level = levels.find((l) => l.id === levelId)
    return level?.children || []
  })
}

/**
 * Get nodes of a specific type from a level
 * @example
 * const walls = useNodesOfType<WallNode>(levelId, 'wall')
 */
export function useNodesOfType<T extends BaseNode>(levelId: string, type: NodeType): T[] {
  return useEditor(useShallow(selectNodesOfTypeFromLevel<T>(levelId, type)))
}

// ============================================================================
// SPECIFIC NODE TYPE HOOKS
// ============================================================================

/**
 * Get all walls from a level
 */
export function useWalls(levelId: string): WallNode[] {
  return useEditor(useShallow(selectWallsFromLevel(levelId)))
}

/**
 * Get visible walls only from a level
 */
export function useVisibleWalls(levelId: string): WallNode[] {
  return useEditor(useShallow(selectVisibleWallsFromLevel(levelId)))
}

/**
 * Get all columns from a level
 */
export function useColumns(levelId: string): ColumnNode[] {
  return useEditor(useShallow(selectColumnsFromLevel(levelId)))
}

/**
 * Get all roofs from a level
 */
export function useRoofs(levelId: string): RoofNode[] {
  return useEditor(useShallow(selectRoofsFromLevel(levelId)))
}

/**
 * Get all reference images from a level
 */
export function useReferenceImages(levelId: string): ReferenceImageNode[] {
  return useEditor(useShallow(selectReferenceImagesFromLevel(levelId)))
}

/**
 * Get visible reference images only from a level
 */
export function useVisibleReferenceImages(levelId: string): ReferenceImageNode[] {
  return useEditor(useShallow(selectVisibleReferenceImagesFromLevel(levelId)))
}

/**
 * Get all scans from a level
 */
export function useScans(levelId: string): ScanNode[] {
  return useEditor(useShallow(selectScansFromLevel(levelId)))
}

/**
 * Get visible scans only from a level
 */
export function useVisibleScans(levelId: string): ScanNode[] {
  return useEditor(useShallow(selectVisibleScansFromLevel(levelId)))
}

/**
 * Get all doors from a level (including those in walls)
 */
export function useDoors(levelId: string): DoorNode[] {
  return useEditor(useShallow(selectDoorsFromLevel(levelId)))
}

/**
 * Get all windows from a level (including those in walls)
 */
export function useWindows(levelId: string): WindowNode[] {
  return useEditor(useShallow(selectWindowsFromLevel(levelId)))
}

// ============================================================================
// NODE ACTIONS HOOKS
// ============================================================================

/**
 * Get node manipulation actions
 */
export function useNodeActions() {
  return {
    // Node manipulation actions can be added here as needed
    // For now, return empty object
  }
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Get the current API mode (always 'node' now)
 */
export function useAPIMode(): 'legacy' | 'node' {
  return 'node'
}

/**
 * Check if node-based API is active (always true now)
 */
export function useIsNodeAPI(): boolean {
  return true
}

/**
 * Get node index for advanced use cases
 */
export function useNodeIndex(): Map<string, BaseNode> {
  return useEditor((state) => state.nodeIndex)
}

// ============================================================================
// GENERIC HOOKS
// ============================================================================

/**
 * Generic hook to get nodes with a custom selector
 * @example
 * const visibleWalls = useNodesWithSelector(levelId, (level) =>
 *   level.children.filter(c => c.type === 'wall' && c.visible !== false)
 * )
 */
export function useNodesWithSelector<T>(
  levelId: string,
  selector: (level: LevelNode) => T,
): T | null {
  return useEditor((state) => {
    const building = state.root.children[0]
    const levels = building ? building.children : []
    const level = levels.find((l) => l.id === levelId)
    if (!level) {
      return null
    }
    return selector(level)
  })
}

/**
 * Generic hook to select from entire node tree
 */
export function useNodeTree<T>(selector: (levels: LevelNode[]) => T): T {
  return useEditor((state) => {
    const building = state.root.children[0]
    const levels = building ? building.children : []
    return selector(levels)
  })
}
