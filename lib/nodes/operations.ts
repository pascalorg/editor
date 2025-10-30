/**
 * Node Operations API
 *
 * High-level operations for manipulating the node tree.
 * These operations maintain immutability and return updated trees.
 */

import type {
  BaseNode,
  LevelNode,
  WallNode,
  DoorNode,
  WindowNode,
  ColumnNode,
  RoofNode,
  RoofSegmentNode,
  ReferenceImageNode,
  ScanNode,
  GroupNode,
} from './types'

import {
  addNode as addNodeUtil,
  removeNode as removeNodeUtil,
  updateNode as updateNodeUtil,
  moveNode as moveNodeUtil,
  findNodeById,
  mapTree,
} from './utils'

import {
  isLevelNode,
  isWallNode,
  isDoorNode,
  isWindowNode,
  canBeChildOf,
} from './guards'

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
  return levels.map((level) =>
    level.id === levelId
      ? { ...level, ...updates }
      : level
  )
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
 * Add a wall to a level
 */
export function addWallToLevel(
  levels: LevelNode[],
  levelId: string,
  wall: Omit<WallNode, 'parent'>,
): LevelNode[] {
  return levels.map((level) => {
    if (level.id === levelId) {
      return {
        ...level,
        children: [...level.children, { ...wall, parent: levelId }],
      }
    }
    return level
  })
}

/**
 * Add a door to a wall
 */
export function addDoorToWall(
  levels: LevelNode[],
  wallId: string,
  door: Omit<DoorNode, 'parent'>,
): LevelNode[] {
  return mapTree(levels, (node) => {
    const baseNode = node as BaseNode
    if (baseNode.id === wallId && isWallNode(baseNode)) {
      const wallNode = baseNode as WallNode
      return {
        ...wallNode,
        children: [...wallNode.children, { ...door, parent: wallId } as BaseNode],
      } as BaseNode as typeof node
    }
    return node
  }) as LevelNode[]
}

/**
 * Add a window to a wall
 */
export function addWindowToWall(
  levels: LevelNode[],
  wallId: string,
  window: Omit<WindowNode, 'parent'>,
): LevelNode[] {
  return mapTree(levels, (node) => {
    const baseNode = node as BaseNode
    if (baseNode.id === wallId && isWallNode(baseNode)) {
      const wallNode = baseNode as WallNode
      return {
        ...wallNode,
        children: [...wallNode.children, { ...window, parent: wallId } as BaseNode],
      } as BaseNode as typeof node
    }
    return node
  }) as LevelNode[]
}

/**
 * Add a column to a level
 */
export function addColumnToLevel(
  levels: LevelNode[],
  levelId: string,
  column: Omit<ColumnNode, 'parent'>,
): LevelNode[] {
  return levels.map((level) => {
    if (level.id === levelId) {
      return {
        ...level,
        children: [...level.children, { ...column, parent: levelId }],
      }
    }
    return level
  })
}

/**
 * Add a roof to a level
 */
export function addRoofToLevel(
  levels: LevelNode[],
  levelId: string,
  roof: Omit<RoofNode, 'parent'>,
): LevelNode[] {
  return levels.map((level) => {
    if (level.id === levelId) {
      return {
        ...level,
        children: [...level.children, { ...roof, parent: levelId }],
      }
    }
    return level
  })
}

/**
 * Add a roof segment to a roof
 */
export function addRoofSegmentToRoof(
  levels: LevelNode[],
  roofId: string,
  segment: Omit<RoofSegmentNode, 'parent'>,
): LevelNode[] {
  return mapTree(levels, (node) => {
    const baseNode = node as BaseNode
    if (baseNode.id === roofId && baseNode.type === 'roof') {
      const roofNode = baseNode as RoofNode
      return {
        ...roofNode,
        children: [...roofNode.children, { ...segment, parent: roofId } as BaseNode],
      } as BaseNode as typeof node
    }
    return node
  }) as LevelNode[]
}

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
 * Update a node's properties
 */
export function updateNodeProperties(
  levels: LevelNode[],
  nodeId: string,
  updates: Partial<Omit<BaseNode, 'id' | 'type' | 'children' | 'parent'>>,
): LevelNode[] {
  return updateNodeUtil(levels, nodeId, updates) as LevelNode[]
}

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
export function setNodeOpacity(
  levels: LevelNode[],
  nodeId: string,
  opacity: number,
): LevelNode[] {
  const clampedOpacity = Math.max(0, Math.min(100, opacity))
  return updateNodeUtil(levels, nodeId, { opacity: clampedOpacity }) as LevelNode[]
}

/**
 * Update node position (for GridItem nodes)
 */
export function setNodePosition(
  levels: LevelNode[],
  nodeId: string,
  position: [number, number],
): LevelNode[] {
  return mapTree(levels, (node) => {
    const baseNode = node as BaseNode
    if (baseNode.id === nodeId && 'position' in baseNode) {
      return { ...baseNode, position } as BaseNode as typeof node
    }
    return node
  }) as LevelNode[]
}

/**
 * Update node rotation (for GridItem nodes)
 */
export function setNodeRotation(
  levels: LevelNode[],
  nodeId: string,
  rotation: number,
): LevelNode[] {
  return mapTree(levels, (node) => {
    const baseNode = node as BaseNode
    if (baseNode.id === nodeId && 'rotation' in baseNode) {
      return { ...baseNode, rotation } as BaseNode as typeof node
    }
    return node
  }) as LevelNode[]
}

/**
 * Update node size (for GridItem nodes)
 */
export function setNodeSize(
  levels: LevelNode[],
  nodeId: string,
  size: [number, number],
): LevelNode[] {
  return mapTree(levels, (node) => {
    const baseNode = node as BaseNode
    if (baseNode.id === nodeId && 'size' in baseNode) {
      return { ...baseNode, size } as BaseNode as typeof node
    }
    return node
  }) as LevelNode[]
}

// ============================================================================
// NODE DELETION OPERATIONS
// ============================================================================

/**
 * Delete a node and optionally its children
 */
export function deleteNode(
  levels: LevelNode[],
  nodeId: string,
  cascade: boolean = true,
): LevelNode[] {
  if (!cascade) {
    // Check if node has children
    const node = findNodeById(levels, nodeId)
    if (node && node.children.length > 0) {
      throw new Error(`Cannot delete node ${nodeId} with children without cascade=true`)
    }
  }

  return removeNodeUtil(levels, nodeId) as LevelNode[]
}

/**
 * Delete multiple nodes
 */
export function deleteNodes(
  levels: LevelNode[],
  nodeIds: string[],
  cascade: boolean = true,
): LevelNode[] {
  return nodeIds.reduce(
    (updatedLevels, nodeId) => deleteNode(updatedLevels, nodeId, cascade),
    levels,
  )
}

/**
 * Delete all children of a node
 */
export function deleteNodeChildren(levels: LevelNode[], nodeId: string): LevelNode[] {
  return mapTree(levels, (node) => {
    if (node.id === nodeId) {
      return { ...node, children: [] }
    }
    return node
  }) as LevelNode[]
}

// ============================================================================
// NODE MOVEMENT OPERATIONS
// ============================================================================

/**
 * Move a node to a new parent
 */
export function moveNodeToParent(
  levels: LevelNode[],
  nodeId: string,
  newParentId: string | null,
): LevelNode[] {
  // Validate the move
  const node = findNodeById(levels, nodeId)
  if (!node) {
    throw new Error(`Node ${nodeId} not found`)
  }

  if (newParentId !== null) {
    const newParent = findNodeById(levels, newParentId)
    if (!newParent) {
      throw new Error(`New parent ${newParentId} not found`)
    }

    if (!canBeChildOf(node, newParent)) {
      throw new Error(`Node of type ${node.type} cannot be child of ${newParent.type}`)
    }
  }

  return moveNodeUtil(levels, nodeId, newParentId) as LevelNode[]
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Replace all walls in a level (used for wall editing)
 */
export function replaceWallsInLevel(
  levels: LevelNode[],
  levelId: string,
  newWalls: WallNode[],
): LevelNode[] {
  return levels.map((level) => {
    if (level.id === levelId) {
      // Remove all existing walls
      const nonWalls = level.children.filter((child) => child.type !== 'wall')

      // Add new walls
      const wallsWithParent = newWalls.map((wall) => ({ ...wall, parent: levelId }))

      return {
        ...level,
        children: [...nonWalls, ...wallsWithParent],
      }
    }
    return level
  })
}

/**
 * Replace all roof segments in a roof (used for roof editing)
 */
export function replaceRoofSegments(
  levels: LevelNode[],
  roofId: string,
  newSegments: RoofSegmentNode[],
): LevelNode[] {
  return mapTree(levels, (node) => {
    const baseNode = node as BaseNode
    if (baseNode.id === roofId && baseNode.type === 'roof') {
      const segmentsWithParent = newSegments.map((seg) => ({ ...seg, parent: roofId }))
      return {
        ...baseNode,
        children: segmentsWithParent as BaseNode[],
      } as BaseNode as typeof node
    }
    return node
  }) as LevelNode[]
}

/**
 * Bulk update visibility for multiple nodes
 */
export function setNodesVisibility(
  levels: LevelNode[],
  nodeIds: string[],
  visible: boolean,
): LevelNode[] {
  return mapTree(levels, (node) => {
    if (nodeIds.includes(node.id)) {
      return { ...node, visible } as typeof node
    }
    return node
  }) as LevelNode[]
}

/**
 * Bulk update opacity for multiple nodes
 */
export function setNodesOpacity(
  levels: LevelNode[],
  nodeIds: string[],
  opacity: number,
): LevelNode[] {
  const clampedOpacity = Math.max(0, Math.min(100, opacity))

  return mapTree(levels, (node) => {
    if (nodeIds.includes(node.id)) {
      return { ...node, opacity: clampedOpacity } as typeof node
    }
    return node
  }) as LevelNode[]
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * Get all walls in a level
 */
export function getWallsInLevel(levels: LevelNode[], levelId: string): WallNode[] {
  const level = levels.find((l) => l.id === levelId)
  if (!level) {
    return []
  }

  return level.children.filter((child) => child.type === 'wall') as WallNode[]
}

/**
 * Get all doors in a level (including those in walls)
 */
export function getDoorsInLevel(levels: LevelNode[], levelId: string): DoorNode[] {
  const level = levels.find((l) => l.id === levelId)
  if (!level) {
    return []
  }

  const doors: DoorNode[] = []

  // Get doors from walls
  const walls = level.children.filter((child) => child.type === 'wall') as WallNode[]
  for (const wall of walls) {
    const wallDoors = wall.children.filter((child) => child.type === 'door') as DoorNode[]
    doors.push(...wallDoors)
  }

  return doors
}

/**
 * Get all windows in a level (including those in walls)
 */
export function getWindowsInLevel(levels: LevelNode[], levelId: string): WindowNode[] {
  const level = levels.find((l) => l.id === levelId)
  if (!level) {
    return []
  }

  const windows: WindowNode[] = []

  // Get windows from walls
  const walls = level.children.filter((child) => child.type === 'wall') as WallNode[]
  for (const wall of walls) {
    const wallWindows = wall.children.filter((child) => child.type === 'window') as WindowNode[]
    windows.push(...wallWindows)
  }

  return windows
}

/**
 * Get all nodes of a specific type in a level
 */
export function getNodesOfTypeInLevel<T extends BaseNode>(
  levels: LevelNode[],
  levelId: string,
  type: string,
): T[] {
  const level = levels.find((l) => l.id === levelId)
  if (!level) {
    return []
  }

  return level.children.filter((child) => child.type === type) as T[]
}
