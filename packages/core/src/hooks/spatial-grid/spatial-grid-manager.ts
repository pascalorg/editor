import type { AnyNode, CeilingNode, ItemNode, SlabNode, WallNode } from '../../schema'
import { SpatialGrid } from './spatial-grid'
import { WallSpatialGrid } from './wall-spatial-grid'

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

/**
 * Point-in-polygon test using ray casting algorithm.
 */
export function pointInPolygon(px: number, pz: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]![0], zi = polygon[i]![1]
    const xj = polygon[j]![0], zj = polygon[j]![1]

    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Compute the 4 XZ footprint corners of an item given its position, dimensions, and Y rotation.
 */
function getItemFootprint(
  position: [number, number, number],
  dimensions: [number, number, number],
  rotation: [number, number, number],
  inset = 0,
): Array<[number, number]> {
  const [x, , z] = position
  const [w, , d] = dimensions
  const yRot = rotation[1]
  const halfW = Math.max(0, w / 2 - inset)
  const halfD = Math.max(0, d / 2 - inset)
  const cos = Math.cos(yRot)
  const sin = Math.sin(yRot)

  return [
    [x + (-halfW * cos + halfD * sin), z + (-halfW * sin - halfD * cos)],
    [x + (halfW * cos + halfD * sin), z + (halfW * sin - halfD * cos)],
    [x + (halfW * cos - halfD * sin), z + (halfW * sin + halfD * cos)],
    [x + (-halfW * cos - halfD * sin), z + (-halfW * sin + halfD * cos)],
  ]
}

/**
 * Test if two line segments (a1->a2) and (b1->b2) intersect.
 */
function segmentsIntersect(
  ax1: number, az1: number, ax2: number, az2: number,
  bx1: number, bz1: number, bx2: number, bz2: number,
): boolean {
  const cross = (ox: number, oz: number, ax: number, az: number, bx: number, bz: number) =>
    (ax - ox) * (bz - oz) - (az - oz) * (bx - ox)

  const d1 = cross(bx1, bz1, bx2, bz2, ax1, az1)
  const d2 = cross(bx1, bz1, bx2, bz2, ax2, az2)
  const d3 = cross(ax1, az1, ax2, az2, bx1, bz1)
  const d4 = cross(ax1, az1, ax2, az2, bx2, bz2)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  // Collinear touching cases
  const onSeg = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    Math.min(px, qx) <= rx && rx <= Math.max(px, qx) &&
    Math.min(pz, qz) <= rz && rz <= Math.max(pz, qz)

  if (d1 === 0 && onSeg(bx1, bz1, bx2, bz2, ax1, az1)) return true
  if (d2 === 0 && onSeg(bx1, bz1, bx2, bz2, ax2, az2)) return true
  if (d3 === 0 && onSeg(ax1, az1, ax2, az2, bx1, bz1)) return true
  if (d4 === 0 && onSeg(ax1, az1, ax2, az2, bx2, bz2)) return true

  return false
}

/**
 * Test if a line segment intersects any edge of a polygon.
 */
function segmentIntersectsPolygon(
  sx1: number, sz1: number, sx2: number, sz2: number,
  polygon: Array<[number, number]>,
): boolean {
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (segmentsIntersect(
      sx1, sz1, sx2, sz2,
      polygon[i]![0], polygon[i]![1], polygon[j]![0], polygon[j]![1],
    )) {
      return true
    }
  }
  return false
}

/**
 * Test if an item's footprint overlaps with a polygon.
 * Checks: any item corner inside polygon, or any polygon vertex inside item AABB, or edges intersect.
 */
export function itemOverlapsPolygon(
  position: [number, number, number],
  dimensions: [number, number, number],
  rotation: [number, number, number],
  polygon: Array<[number, number]>,
  inset = 0,
): boolean {
  const corners = getItemFootprint(position, dimensions, rotation, inset)

  // Check if any item corner is inside the polygon
  for (const [cx, cz] of corners) {
    if (pointInPolygon(cx, cz, polygon)) return true
  }

  // Check if any polygon vertex is inside the item footprint
  // (handles case where slab is fully inside a large item)
  for (const [px, pz] of polygon) {
    if (pointInPolygon(px, pz, corners)) return true
  }

  // Check if any item edge intersects any polygon edge
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    if (segmentIntersectsPolygon(
      corners[i]![0], corners[i]![1], corners[j]![0], corners[j]![1],
      polygon,
    )) return true
  }

  return false
}

/**
 * Test if a wall segment overlaps with a polygon.
 */
export function wallOverlapsPolygon(
  start: [number, number],
  end: [number, number],
  polygon: Array<[number, number]>,
): boolean {
  // Either endpoint inside the polygon
  if (pointInPolygon(start[0], start[1], polygon)) return true
  if (pointInPolygon(end[0], end[1], polygon)) return true

  // Wall segment intersects any polygon edge
  if (segmentIntersectsPolygon(start[0], start[1], end[0], end[1], polygon)) return true

  return false
}

export class SpatialGridManager {
  private floorGrids = new Map<string, SpatialGrid>() // levelId -> grid
  private wallGrids = new Map<string, WallSpatialGrid>() // levelId -> wall grid
  private walls = new Map<string, WallNode>() // wallId -> wall data (for length calculations)
  private slabsByLevel = new Map<string, Map<string, SlabNode>>() // levelId -> (slabId -> slab)
  private ceilingGrids = new Map<string, SpatialGrid>() // ceilingId -> grid
  private ceilings = new Map<string, CeilingNode>() // ceilingId -> ceiling data
  private itemCeilingMap = new Map<string, string>() // itemId -> ceilingId (reverse lookup)

  constructor(private cellSize = 0.5) {}

  private getFloorGrid(levelId: string): SpatialGrid {
    if (!this.floorGrids.has(levelId)) {
      this.floorGrids.set(levelId, new SpatialGrid({ cellSize: this.cellSize }))
    }
    return this.floorGrids.get(levelId)!
  }

  private getWallGrid(levelId: string): WallSpatialGrid {
    if (!this.wallGrids.has(levelId)) {
      this.wallGrids.set(levelId, new WallSpatialGrid())
    }
    return this.wallGrids.get(levelId)!
  }

  private getWallLength(wallId: string): number {
    const wall = this.walls.get(wallId)
    if (!wall) return 0
    const dx = wall.end[0] - wall.start[0]
    const dy = wall.end[1] - wall.start[1]
    return Math.sqrt(dx * dx + dy * dy)
  }

  private getWallHeight(wallId: string): number {
    const wall = this.walls.get(wallId)
    return wall?.height ?? 2.5 // Default wall height
  }

  private getCeilingGrid(ceilingId: string): SpatialGrid {
    if (!this.ceilingGrids.has(ceilingId)) {
      this.ceilingGrids.set(ceilingId, new SpatialGrid({ cellSize: this.cellSize }))
    }
    return this.ceilingGrids.get(ceilingId)!
  }

  private getSlabMap(levelId: string): Map<string, SlabNode> {
    if (!this.slabsByLevel.has(levelId)) {
      this.slabsByLevel.set(levelId, new Map())
    }
    return this.slabsByLevel.get(levelId)!
  }

  // Called when nodes change
  handleNodeCreated(node: AnyNode, levelId: string) {
    if (node.type === 'slab') {
      console.log(`[SpatialGrid] Adding slab ${node.id} to level ${levelId}`, (node as SlabNode).polygon)
      this.getSlabMap(levelId).set(node.id, node as SlabNode)
    } else if (node.type === 'ceiling') {
      this.ceilings.set(node.id, node as CeilingNode)
    } else if (node.type === 'wall') {
      const wall = node as WallNode
      this.walls.set(wall.id, wall)
    } else if (node.type === 'item') {
      const item = node as ItemNode
      if (item.asset.attachTo === 'wall' || item.asset.attachTo === 'wall-side') {
        // Wall-attached item - use parentId as the wall ID
        const wallId = item.parentId
        if (wallId && this.walls.has(wallId)) {
          const wallLength = this.getWallLength(wallId)
          if (wallLength > 0) {
            const [width, height] = item.asset.dimensions
            const halfW = width / wallLength / 2
            // Calculate t from local X position (position[0] is distance along wall)
            const t = item.position[0] / wallLength
            // position[1] is the bottom of the item
            this.getWallGrid(levelId).insert({
              itemId: item.id,
              wallId: wallId,
              tStart: t - halfW,
              tEnd: t + halfW,
              yStart: item.position[1],
              yEnd: item.position[1] + height,
              attachType: item.asset.attachTo as 'wall' | 'wall-side',
              side: item.side,
            })
          }
        }
      } else if (item.asset.attachTo === 'ceiling') {
        // Ceiling item - use parentId as the ceiling ID
        const ceilingId = item.parentId
        if (ceilingId && this.ceilings.has(ceilingId)) {
          this.getCeilingGrid(ceilingId).insert(item.id, item.position, item.asset.dimensions, item.rotation)
          this.itemCeilingMap.set(item.id, ceilingId)
        }
      } else if (!item.asset.attachTo) {
        // Floor item
        this.getFloorGrid(levelId).insert(
          item.id,
          item.position,
          item.asset.dimensions,
          item.rotation,
        )
      }
    }
  }

  handleNodeUpdated(node: AnyNode, levelId: string) {
    if (node.type === 'slab') {
      this.getSlabMap(levelId).set(node.id, node as SlabNode)
    } else if (node.type === 'ceiling') {
      this.ceilings.set(node.id, node as CeilingNode)
    } else if (node.type === 'wall') {
      const wall = node as WallNode
      this.walls.set(wall.id, wall)
    } else if (node.type === 'item') {
      const item = node as ItemNode
      if (item.asset.attachTo === 'wall' || item.asset.attachTo === 'wall-side') {
        // Remove old placement and re-insert
        this.getWallGrid(levelId).removeByItemId(item.id)
        const wallId = item.parentId
        if (wallId && this.walls.has(wallId)) {
          const wallLength = this.getWallLength(wallId)
          if (wallLength > 0) {
            const [width, height] = item.asset.dimensions
            const halfW = width / wallLength / 2
            // Calculate t from local X position (position[0] is distance along wall)
            const t = item.position[0] / wallLength
            // position[1] is the bottom of the item
            this.getWallGrid(levelId).insert({
              itemId: item.id,
              wallId: wallId,
              tStart: t - halfW,
              tEnd: t + halfW,
              yStart: item.position[1],
              yEnd: item.position[1] + height,
              attachType: item.asset.attachTo as 'wall' | 'wall-side',
              side: item.side,
            })
          }
        }
      } else if (item.asset.attachTo === 'ceiling') {
        // Remove from old ceiling grid
        const oldCeilingId = this.itemCeilingMap.get(item.id)
        if (oldCeilingId) {
          this.getCeilingGrid(oldCeilingId).remove(item.id)
          this.itemCeilingMap.delete(item.id)
        }
        // Insert into new ceiling grid
        const ceilingId = item.parentId
        if (ceilingId && this.ceilings.has(ceilingId)) {
          this.getCeilingGrid(ceilingId).insert(item.id, item.position, item.asset.dimensions, item.rotation)
          this.itemCeilingMap.set(item.id, ceilingId)
        }
      } else if (!item.asset.attachTo) {
        this.getFloorGrid(levelId).update(
          item.id,
          item.position,
          item.asset.dimensions,
          item.rotation,
        )
      }
    }
  }

  handleNodeDeleted(nodeId: string, nodeType: string, levelId: string) {
    if (nodeType === 'slab') {
      this.getSlabMap(levelId).delete(nodeId)
    } else if (nodeType === 'ceiling') {
      this.ceilings.delete(nodeId)
      this.ceilingGrids.delete(nodeId)
    } else if (nodeType === 'wall') {
      this.walls.delete(nodeId)
      // Remove all items attached to this wall from the spatial grid
      const removedItemIds = this.getWallGrid(levelId).removeWall(nodeId)
      return removedItemIds // Caller can use this to delete the items from scene
    } else if (nodeType === 'item') {
      this.getFloorGrid(levelId).remove(nodeId)
      this.getWallGrid(levelId).removeByItemId(nodeId)
      // Also clean up ceiling grid
      const oldCeilingId = this.itemCeilingMap.get(nodeId)
      if (oldCeilingId) {
        this.getCeilingGrid(oldCeilingId).remove(nodeId)
        this.itemCeilingMap.delete(nodeId)
      }
    }
    return []
  }

  // Query methods
  canPlaceOnFloor(
    levelId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    ignoreIds?: string[],
  ) {
    const grid = this.getFloorGrid(levelId)
    return grid.canPlace(position, dimensions, rotation, ignoreIds)
  }

  /**
   * Check if an item can be placed on a wall
   * @param levelId - the level containing the wall
   * @param wallId - the wall to check
   * @param localX - X position in wall-local space (distance from wall start)
   * @param localY - Y position (height from floor)
   * @param dimensions - item dimensions [width, height, depth]
   * @param attachType - 'wall' (needs both sides) or 'wall-side' (needs one side)
   * @param side - which side for 'wall-side' items
   * @param ignoreIds - item IDs to ignore in collision check
   */
  canPlaceOnWall(
    levelId: string,
    wallId: string,
    localX: number,
    localY: number,
    dimensions: [number, number, number],
    attachType: 'wall' | 'wall-side' = 'wall',
    side?: 'front' | 'back',
    ignoreIds?: string[],
  ) {
    const wallLength = this.getWallLength(wallId)
    if (wallLength === 0) {
      return { valid: false, conflictIds: [] }
    }
    const wallHeight = this.getWallHeight(wallId)
    // Convert local X position to parametric t (0-1)
    const tCenter = localX / wallLength
    const [itemWidth, itemHeight] = dimensions
    return this.getWallGrid(levelId).canPlaceOnWall(
      wallId,
      wallLength,
      wallHeight,
      tCenter,
      itemWidth,
      localY,
      itemHeight,
      attachType,
      side,
      ignoreIds,
    )
  }

  getWallForItem(levelId: string, itemId: string): string | undefined {
    return this.getWallGrid(levelId).getWallForItem(itemId)
  }

  /**
   * Get the total slab elevation at a given (x, z) position on a level.
   * Returns the highest slab elevation if the point is inside any slab polygon, otherwise 0.
   */
  getSlabElevationAt(levelId: string, x: number, z: number): number {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) return 0

    let maxElevation = 0
    for (const slab of slabMap.values()) {
      if (slab.polygon.length >= 3 && pointInPolygon(x, z, slab.polygon)) {
        const elevation = slab.elevation ?? 0.05
        if (elevation > maxElevation) {
          maxElevation = elevation
        }
      }
    }
    return maxElevation
  }

  /**
   * Get the slab elevation for an item using its full footprint (bounding box).
   * Checks if any part of the item's rotated footprint overlaps with any slab polygon.
   * Returns the highest overlapping slab elevation, or 0 if none.
   */
  getSlabElevationForItem(
    levelId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ): number {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) return 0

    let maxElevation = 0
    for (const slab of slabMap.values()) {
      if (slab.polygon.length >= 3 && itemOverlapsPolygon(position, dimensions, rotation, slab.polygon, 0.01)) {
        const elevation = slab.elevation ?? 0.05
        if (elevation > maxElevation) {
          maxElevation = elevation
        }
      }
    }
    return maxElevation
  }

  /**
   * Get the slab elevation for a wall by checking if it overlaps with any slab polygon.
   * Uses wallOverlapsPolygon which handles edge cases (points on boundary, collinear segments).
   * Returns the highest slab elevation found, or 0 if none.
   */
  getSlabElevationForWall(
    levelId: string,
    start: [number, number],
    end: [number, number],
  ): number {
    const slabMap = this.slabsByLevel.get(levelId)
    console.log(`[SpatialGrid] getSlabElevationForWall | levelId: ${levelId} | slabMap size: ${slabMap?.size ?? 0} | slabs:`, slabMap ? Array.from(slabMap.keys()) : [])
    if (!slabMap) return 0

    let maxElevation = 0
    for (const slab of slabMap.values()) {
      if (slab.polygon.length < 3) continue
      if (wallOverlapsPolygon(start, end, slab.polygon)) {
        const elevation = slab.elevation ?? 0.05
        if (elevation > maxElevation) {
          maxElevation = elevation
        }
      }
    }
    return maxElevation
  }

  /**
   * Check if an item can be placed on a ceiling.
   * Validates that the footprint is within the ceiling polygon and doesn't overlap other ceiling items.
   */
  canPlaceOnCeiling(
    ceilingId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    ignoreIds?: string[],
  ): { valid: boolean; conflictIds: string[] } {
    const ceiling = this.ceilings.get(ceilingId)
    if (!ceiling || ceiling.polygon.length < 3) {
      return { valid: false, conflictIds: [] }
    }

    // Check that the item footprint is entirely within the ceiling polygon
    const corners = getItemFootprint(position, dimensions, rotation)
    for (const [cx, cz] of corners) {
      if (!pointInPolygon(cx, cz, ceiling.polygon)) {
        return { valid: false, conflictIds: [] }
      }
    }

    // Check for overlaps with other ceiling items
    return this.getCeilingGrid(ceilingId).canPlace(position, dimensions, rotation, ignoreIds)
  }

  clearLevel(levelId: string) {
    this.floorGrids.delete(levelId)
    this.wallGrids.delete(levelId)
    this.slabsByLevel.delete(levelId)
  }

  clear() {
    this.floorGrids.clear()
    this.wallGrids.clear()
    this.walls.clear()
    this.slabsByLevel.clear()
    this.ceilingGrids.clear()
    this.ceilings.clear()
    this.itemCeilingMap.clear()
  }
}

// Singleton instance
export const spatialGridManager = new SpatialGridManager()
