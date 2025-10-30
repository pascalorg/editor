/**
 * Node Selectors
 *
 * Selector functions for querying node data from the store.
 * These can be used with Zustand's useStore selector pattern.
 */

import type {
  BaseNode,
  LevelNode,
  WallNode,
  DoorNode,
  WindowNode,
  ColumnNode,
  RoofNode,
  ReferenceImageNode,
  ScanNode,
  NodeType,
} from './types'

import { findNodeById, findNodesByType } from './utils'

// ============================================================================
// STORE STATE SELECTORS
// ============================================================================

/**
 * Select all levels from store state
 */
export const selectLevels = (state: { levels: LevelNode[] }): LevelNode[] => {
  return state.levels
}

/**
 * Select a specific level by ID
 */
export const selectLevelById =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): LevelNode | null => {
    return state.levels.find((l) => l.id === levelId) || null
  }

/**
 * Select a specific level by number
 */
export const selectLevelByNumber =
  (levelNumber: number) =>
  (state: { levels: LevelNode[] }): LevelNode | null => {
    return state.levels.find((l) => l.level === levelNumber) || null
  }

/**
 * Select a node by ID from levels
 */
export const selectNodeById =
  (nodeId: string) =>
  (state: { levels: LevelNode[] }): BaseNode | null => {
    return findNodeById(state.levels, nodeId)
  }

/**
 * Select node index from store
 */
export const selectNodeIndex = (state: {
  nodeIndex: Map<string, BaseNode>
}): Map<string, BaseNode> => {
  return state.nodeIndex
}

/**
 * Select a node by ID from index (faster)
 */
export const selectNodeByIdFromIndex =
  (nodeId: string) =>
  (state: { nodeIndex: Map<string, BaseNode> }): BaseNode | undefined => {
    return state.nodeIndex.get(nodeId)
  }

// ============================================================================
// LEVEL CHILDREN SELECTORS
// ============================================================================

/**
 * Select all children of a level
 */
export const selectLevelChildren =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): BaseNode[] => {
    const level = state.levels.find((l) => l.id === levelId)
    return level?.children || []
  }

/**
 * Select nodes of a specific type from a level
 */
export const selectNodesOfTypeFromLevel =
  <T extends BaseNode>(levelId: string, type: NodeType) =>
  (state: { levels: LevelNode[] }): T[] => {
    const level = state.levels.find((l) => l.id === levelId)
    if (!level) {
      return []
    }

    return level.children.filter((child) => child.type === type) as T[]
  }

/**
 * Select all walls from a level
 */
export const selectWallsFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): WallNode[] => {
    return selectNodesOfTypeFromLevel<WallNode>(levelId, 'wall')(state)
  }

/**
 * Select all columns from a level
 */
export const selectColumnsFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): ColumnNode[] => {
    return selectNodesOfTypeFromLevel<ColumnNode>(levelId, 'column')(state)
  }

/**
 * Select all roofs from a level
 */
export const selectRoofsFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): RoofNode[] => {
    return selectNodesOfTypeFromLevel<RoofNode>(levelId, 'roof')(state)
  }

/**
 * Select all reference images from a level
 */
export const selectReferenceImagesFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): ReferenceImageNode[] => {
    return selectNodesOfTypeFromLevel<ReferenceImageNode>(levelId, 'reference-image')(state)
  }

/**
 * Select all scans from a level
 */
export const selectScansFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): ScanNode[] => {
    return selectNodesOfTypeFromLevel<ScanNode>(levelId, 'scan')(state)
  }

// ============================================================================
// DOORS & WINDOWS (FROM WALLS)
// ============================================================================

/**
 * Select all doors from a level (including those in walls)
 */
export const selectDoorsFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): DoorNode[] => {
    const level = state.levels.find((l) => l.id === levelId)
    if (!level) {
      return []
    }

    const doors: DoorNode[] = []

    // Get walls
    const walls = level.children.filter((child) => child.type === 'wall') as WallNode[]

    // Extract doors from each wall
    for (const wall of walls) {
      const wallDoors = wall.children.filter((child) => child.type === 'door') as DoorNode[]
      doors.push(...wallDoors)
    }

    return doors
  }

/**
 * Select all windows from a level (including those in walls)
 */
export const selectWindowsFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): WindowNode[] => {
    const level = state.levels.find((l) => l.id === levelId)
    if (!level) {
      return []
    }

    const windows: WindowNode[] = []

    // Get walls
    const walls = level.children.filter((child) => child.type === 'wall') as WallNode[]

    // Extract windows from each wall
    for (const wall of walls) {
      const wallWindows = wall.children.filter((child) => child.type === 'window') as WindowNode[]
      windows.push(...wallWindows)
    }

    return windows
  }

/**
 * Select doors from a specific wall
 */
export const selectDoorsFromWall =
  (wallId: string) =>
  (state: { levels: LevelNode[] }): DoorNode[] => {
    const wall = findNodeById(state.levels, wallId)
    if (!wall || wall.type !== 'wall') {
      return []
    }

    return (wall as WallNode).children.filter((child) => child.type === 'door') as DoorNode[]
  }

/**
 * Select windows from a specific wall
 */
export const selectWindowsFromWall =
  (wallId: string) =>
  (state: { levels: LevelNode[] }): WindowNode[] => {
    const wall = findNodeById(state.levels, wallId)
    if (!wall || wall.type !== 'wall') {
      return []
    }

    return (wall as WallNode).children.filter((child) => child.type === 'window') as WindowNode[]
  }

// ============================================================================
// VISIBILITY & OPACITY SELECTORS
// ============================================================================

/**
 * Select visible nodes of a specific type from a level
 */
export const selectVisibleNodesOfTypeFromLevel =
  <T extends BaseNode>(levelId: string, type: NodeType) =>
  (state: { levels: LevelNode[] }): T[] => {
    const nodes = selectNodesOfTypeFromLevel<T>(levelId, type)(state)
    return nodes.filter((node) => node.visible !== false)
  }

/**
 * Select visible walls from a level
 */
export const selectVisibleWallsFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): WallNode[] => {
    return selectVisibleNodesOfTypeFromLevel<WallNode>(levelId, 'wall')(state)
  }

/**
 * Select visible reference images from a level
 */
export const selectVisibleReferenceImagesFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): ReferenceImageNode[] => {
    return selectVisibleNodesOfTypeFromLevel<ReferenceImageNode>(
      levelId,
      'reference-image',
    )(state)
  }

/**
 * Select visible scans from a level
 */
export const selectVisibleScansFromLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): ScanNode[] => {
    return selectVisibleNodesOfTypeFromLevel<ScanNode>(levelId, 'scan')(state)
  }

// ============================================================================
// COUNT SELECTORS
// ============================================================================

/**
 * Select count of nodes of a specific type in a level
 */
export const selectNodeCountByType =
  (levelId: string, type: NodeType) =>
  (state: { levels: LevelNode[] }): number => {
    const nodes = selectNodesOfTypeFromLevel(levelId, type)(state)
    return nodes.length
  }

/**
 * Select total wall count in a level
 */
export const selectWallCountInLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): number => {
    return selectNodeCountByType(levelId, 'wall')(state)
  }

/**
 * Select total door count in a level (including those in walls)
 */
export const selectDoorCountInLevel =
  (levelId: string) =>
  (state: { levels: LevelNode[] }): number => {
    const doors = selectDoorsFromLevel(levelId)(state)
    return doors.length
  }

// ============================================================================
// ALL NODES SELECTORS (ACROSS ALL LEVELS)
// ============================================================================

/**
 * Select all nodes of a specific type across all levels
 */
export const selectAllNodesOfType =
  <T extends BaseNode>(type: NodeType) =>
  (state: { levels: LevelNode[] }): T[] => {
    return findNodesByType<T>(state.levels, type)
  }

/**
 * Select all walls across all levels
 */
export const selectAllWalls = (state: { levels: LevelNode[] }): WallNode[] => {
  return selectAllNodesOfType<WallNode>('wall')(state)
}

/**
 * Select all reference images across all levels
 */
export const selectAllReferenceImages = (state: {
  levels: LevelNode[]
}): ReferenceImageNode[] => {
  return selectAllNodesOfType<ReferenceImageNode>('reference-image')(state)
}

/**
 * Select all scans across all levels
 */
export const selectAllScans = (state: { levels: LevelNode[] }): ScanNode[] => {
  return selectAllNodesOfType<ScanNode>('scan')(state)
}

// ============================================================================
// SELECTION HELPERS
// ============================================================================

/**
 * Create a memoized selector for nodes of a specific type in a level
 * Use with zustand's useShallow for optimal performance
 */
export function createNodeSelector<T extends BaseNode>(levelId: string, type: NodeType) {
  return (state: { levels: LevelNode[] }): T[] => {
    const level = state.levels.find((l) => l.id === levelId)
    if (!level) {
      return []
    }

    return level.children.filter((child) => child.type === type) as T[]
  }
}

/**
 * Create a selector for a single node by ID
 */
export function createSingleNodeSelector(nodeId: string) {
  return (state: { nodeIndex: Map<string, BaseNode> }): BaseNode | undefined => {
    return state.nodeIndex.get(nodeId)
  }
}
