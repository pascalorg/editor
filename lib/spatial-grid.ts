import type { BaseNode } from '@/lib/graph/types'

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
 * Calculate bounding box for a node based on its type
 * Returns null for nodes that don't have spatial bounds (like levels)
 */
export function calculateNodeBounds(node: BaseNode): BoundingBox | null {
  const type = node.type as string

  switch (type) {
    case 'wall': {
      const wallNode = node as any
      if (wallNode.start && wallNode.end) {
        const minX = Math.min(wallNode.start.x, wallNode.end.x)
        const maxX = Math.max(wallNode.start.x, wallNode.end.x)
        const minZ = Math.min(wallNode.start.z, wallNode.end.z)
        const maxZ = Math.max(wallNode.start.z, wallNode.end.z)
        return { minX, maxX, minZ, maxZ }
      }
      return null
    }

    case 'slab': {
      const slabNode = node as any
      if (slabNode.position && slabNode.size) {
        const [x, z] = slabNode.position
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
      const columnNode = node as any
      if (columnNode.position) {
        const [x, z] = columnNode.position
        const radius = 0.25 // Approximate column radius
        return {
          minX: x - radius,
          maxX: x + radius,
          minZ: z - radius,
          maxZ: z + radius,
        }
      }
      return null
    }

    case 'door':
    case 'window': {
      const openingNode = node as any
      if (openingNode.position) {
        const [x, z] = openingNode.position
        const width = openingNode.width || 1
        const halfWidth = width / 2
        return {
          minX: x - halfWidth,
          maxX: x + halfWidth,
          minZ: z - 0.2,
          maxZ: z + 0.2,
        }
      }
      return null
    }

    case 'roof': {
      // For roof segments, we'd need to iterate through children
      // For now, return null (can be implemented later if needed)
      return null
    }

    case 'reference-image':
    case 'scan': {
      const mediaNode = node as any
      if (mediaNode.position) {
        const [x, z] = mediaNode.position
        const scale = mediaNode.scale || 1
        const size = 2 * scale // Approximate size
        return {
          minX: x - size,
          maxX: x + size,
          minZ: z - size,
          maxZ: z + size,
        }
      }
      return null
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
  updateNode(nodeId: string, levelId: string, bounds: BoundingBox): void {
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
