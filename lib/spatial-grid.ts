import type { BaseNode } from '@/lib/nodes/types'

/**
 * Bounding box in 2D space (X, Z coordinates)
 */
export interface BoundingBox {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/**
 * Calculate absolute world position by traversing parent chain
 * Accumulates parent positions up to the root (level)
 */
function calculateAbsolutePosition(
  node: BaseNode,
  nodeIndex: Map<string, BaseNode>,
): [number, number] | null {
  // For nodes without position
  if (!('position' in node && Array.isArray(node.position))) {
    return null
  }

  let [absoluteX, absoluteZ] = node.position as [number, number]

  // Traverse up parent chain and accumulate positions
  let currentNode: BaseNode = node
  while (currentNode.parent) {
    const parent = nodeIndex.get(currentNode.parent)
    if (!parent) break

    if ('position' in parent && Array.isArray(parent.position)) {
      const [px, pz] = parent.position as [number, number]
      absoluteX += px
      absoluteZ += pz
    }

    currentNode = parent
  }

  return [absoluteX, absoluteZ]
}

/**
 * Calculate absolute world position for a point (x, z) by adding parent positions
 */
function calculateAbsolutePoint(
  point: { x: number; z: number },
  node: BaseNode,
  nodeIndex: Map<string, BaseNode>,
): { x: number; z: number } {
  let absoluteX = point.x
  let absoluteZ = point.z

  // Traverse up parent chain and accumulate positions
  let currentNode: BaseNode = node
  while (currentNode.parent) {
    const parent = nodeIndex.get(currentNode.parent)
    if (!parent) break

    if ('position' in parent && Array.isArray(parent.position)) {
      const [px, pz] = parent.position as [number, number]
      absoluteX += px
      absoluteZ += pz
    }

    currentNode = parent
  }

  return { x: absoluteX, z: absoluteZ }
}

/**
 * Calculate bounding box for a node based on its type
 * Uses absolute world coordinates by traversing parent chain
 * Returns null for nodes that don't have spatial bounds (like levels)
 */
export function calculateNodeBounds(
  node: BaseNode,
  nodeIndex: Map<string, BaseNode>,
): BoundingBox | null {
  const type = node.type as string

  switch (type) {
    case 'wall': {
      const wallNode = node as any
      if (wallNode.start && wallNode.end) {
        // Calculate absolute positions for start and end (in case wall is nested)
        const absoluteStart = calculateAbsolutePoint(wallNode.start, node, nodeIndex)
        const absoluteEnd = calculateAbsolutePoint(wallNode.end, node, nodeIndex)

        const minX = Math.min(absoluteStart.x, absoluteEnd.x)
        const maxX = Math.max(absoluteStart.x, absoluteEnd.x)
        const minZ = Math.min(absoluteStart.z, absoluteEnd.z)
        const maxZ = Math.max(absoluteStart.z, absoluteEnd.z)
        return { minX, maxX, minZ, maxZ }
      }
      return null
    }

    case 'slab': {
      const slabNode = node as any
      if (slabNode.size) {
        const absolutePos = calculateAbsolutePosition(node, nodeIndex)
        if (!absolutePos) return null

        const [x, z] = absolutePos
        const [width, depth] = slabNode.size
        return {
          minX: x,
          maxX: x + width,
          minZ: z,
          maxZ: z + depth,
        }
      }
      return null
    }

    case 'column': {
      const absolutePos = calculateAbsolutePosition(node, nodeIndex)
      if (!absolutePos) return null

      const [x, z] = absolutePos
      const radius = 0.25 // Approximate column radius
      return {
        minX: x - radius,
        maxX: x + radius,
        minZ: z - radius,
        maxZ: z + radius,
      }
    }

    case 'door':
    case 'window': {
      const absolutePos = calculateAbsolutePosition(node, nodeIndex)
      if (!absolutePos) return null

      const openingNode = node as any
      const [x, z] = absolutePos
      const width = openingNode.width || 1
      const halfWidth = width / 2
      return {
        minX: x - halfWidth,
        maxX: x + halfWidth,
        minZ: z - 0.2,
        maxZ: z + 0.2,
      }
    }

    case 'roof': {
      // For roof segments, we'd need to iterate through children
      // For now, return null (can be implemented later if needed)
      return null
    }

    case 'reference-image':
    case 'scan': {
      const absolutePos = calculateAbsolutePosition(node, nodeIndex)
      if (!absolutePos) return null

      const mediaNode = node as any
      const [x, z] = absolutePos
      const scale = mediaNode.scale || 1
      const size = 2 * scale // Approximate size
      return {
        minX: x - size,
        maxX: x + size,
        minZ: z - size,
        maxZ: z + size,
      }
    }

    default:
      return null
  }
}

/**
 * 2D Spatial Grid for efficient spatial queries
 *
 * Maintains separate grids for each level, using a cell-based spatial partitioning
 * scheme for fast neighbor and intersection queries.
 */
export class SpatialGrid {
  private readonly cellSize: number
  private readonly grids: Map<string, Map<string, Set<string>>> // levelId -> cellKey -> nodeIds
  private readonly nodeBounds: Map<string, { levelId: string; bounds: BoundingBox }> // nodeId -> metadata

  constructor(cellSize = 1) {
    this.cellSize = cellSize
    this.grids = new Map()
    this.nodeBounds = new Map()
  }

  /**
   * Get the cell key for a given world position
   */
  private getCellKey(x: number, z: number): string {
    const cellX = Math.floor(x / this.cellSize)
    const cellZ = Math.floor(z / this.cellSize)
    return `${cellX},${cellZ}`
  }

  /**
   * Get all cell keys that a bounding box spans
   */
  private getCellsForBounds(bounds: BoundingBox): string[] {
    const cells: string[] = []

    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const minCellZ = Math.floor(bounds.minZ / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const maxCellZ = Math.floor(bounds.maxZ / this.cellSize)

    for (let x = minCellX; x <= maxCellX; x++) {
      for (let z = minCellZ; z <= maxCellZ; z++) {
        cells.push(`${x},${z}`)
      }
    }

    return cells
  }

  /**
   * Ensure a grid exists for the given level
   */
  private ensureLevelGrid(levelId: string): Map<string, Set<string>> {
    if (!this.grids.has(levelId)) {
      this.grids.set(levelId, new Map())
    }
    return this.grids.get(levelId)!
  }

  /**
   * Add or update a node in the spatial grid
   * Automatically handles moving nodes between cells
   */
  updateNode(
    nodeId: string,
    levelId: string,
    node: BaseNode,
    nodeIndex: Map<string, BaseNode>,
  ): void {
    // Calculate bounds for this node (using absolute world coordinates)
    const bounds = calculateNodeBounds(node, nodeIndex)
    if (!bounds) {
      // Node doesn't have spatial bounds, skip
      return
    }

    // Remove from old position if exists
    const existing = this.nodeBounds.get(nodeId)
    if (existing) {
      this.removeNode(nodeId)
    }

    // Add to new position
    const grid = this.ensureLevelGrid(levelId)
    const cells = this.getCellsForBounds(bounds)

    for (const cellKey of cells) {
      if (!grid.has(cellKey)) {
        grid.set(cellKey, new Set())
      }
      grid.get(cellKey)!.add(nodeId)
    }

    // Store bounds for this node
    this.nodeBounds.set(nodeId, { levelId, bounds })
  }

  /**
   * Remove a node from the spatial grid
   */
  removeNode(nodeId: string): void {
    const existing = this.nodeBounds.get(nodeId)
    if (!existing) return

    const { levelId, bounds } = existing
    const grid = this.grids.get(levelId)
    if (!grid) return

    const cells = this.getCellsForBounds(bounds)

    for (const cellKey of cells) {
      const cellNodes = grid.get(cellKey)
      if (cellNodes) {
        cellNodes.delete(nodeId)
        // Clean up empty cells
        if (cellNodes.size === 0) {
          grid.delete(cellKey)
        }
      }
    }

    this.nodeBounds.delete(nodeId)
  }

  /**
   * Query all nodes that intersect with the given bounding box
   * Returns only nodes that actually intersect (not just in same cells)
   */
  query(levelId: string, bounds: BoundingBox): Set<string> {
    const grid = this.grids.get(levelId)
    if (!grid) return new Set()

    const cells = this.getCellsForBounds(bounds)
    const candidates = new Set<string>()

    // Gather all candidates from cells
    for (const cellKey of cells) {
      const cellNodes = grid.get(cellKey)
      if (cellNodes) {
        for (const nodeId of cellNodes) {
          candidates.add(nodeId)
        }
      }
    }

    // Filter to only nodes that actually intersect
    const result = new Set<string>()
    for (const nodeId of candidates) {
      const nodeData = this.nodeBounds.get(nodeId)
      if (nodeData && this.boundsIntersect(bounds, nodeData.bounds)) {
        result.add(nodeId)
      }
    }

    return result
  }

  /**
   * Query all nodes that contain the given point
   */
  queryPoint(levelId: string, point: [number, number]): Set<string> {
    const grid = this.grids.get(levelId)
    if (!grid) return new Set()

    const [x, z] = point
    const cellKey = this.getCellKey(x, z)
    const cellNodes = grid.get(cellKey)
    if (!cellNodes) return new Set()

    // Filter to only nodes that actually contain the point
    const result = new Set<string>()
    for (const nodeId of cellNodes) {
      const nodeData = this.nodeBounds.get(nodeId)
      if (nodeData && this.pointInBounds(point, nodeData.bounds)) {
        result.add(nodeId)
      }
    }

    return result
  }

  /**
   * Check if two bounding boxes intersect
   */
  private boundsIntersect(a: BoundingBox, b: BoundingBox): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ)
  }

  /**
   * Check if a point is inside a bounding box
   */
  private pointInBounds(point: [number, number], bounds: BoundingBox): boolean {
    const [x, z] = point
    return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
  }

  /**
   * Get the bounds of a node (if it exists in the grid)
   * Returns null if the node is not in the grid
   */
  getNodeBounds(nodeId: string): BoundingBox | null {
    const data = this.nodeBounds.get(nodeId)
    return data ? data.bounds : null
  }

  /**
   * Get all node IDs in a level (for debugging/testing)
   */
  getNodesInLevel(levelId: string): Set<string> {
    const result = new Set<string>()
    for (const [nodeId, data] of this.nodeBounds) {
      if (data.levelId === levelId) {
        result.add(nodeId)
      }
    }
    return result
  }

  /**
   * Clear all data (useful for testing/reset)
   */
  clear(): void {
    this.grids.clear()
    this.nodeBounds.clear()
  }
}
