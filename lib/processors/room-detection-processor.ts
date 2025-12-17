/**
 * Room Detection Processor
 * Uses flood fill to detect enclosed rooms and assign interior sides to walls
 */

import type { SceneGraph } from '@/lib/scenegraph'
import type { AnyNode } from '@/lib/scenegraph/schema/index'
import type { WallNode } from '@/lib/scenegraph/schema/nodes/wall'
import type { NodeProcessResult, NodeProcessor } from './types'
import { type BoundingBox, OccupancyGrid } from './occupancy-grid'

const WALL_THICKNESS = 0.2 // 20cm default wall thickness

export class RoomDetectionProcessor implements NodeProcessor {
  nodeTypes = ['level']

  process(nodes: AnyNode[], graph: SceneGraph): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    for (const node of nodes) {
      if (node.type !== 'level') continue

      const levelResults = this.processLevel(node, graph)
      results.push(...levelResults)
    }

    return results
  }

  private processLevel(levelNode: AnyNode, graph: SceneGraph): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    // Step 1: Collect all walls in this level (including walls in groups)
    const walls = this.collectWalls(levelNode)
    if (walls.length === 0) return results

    // Step 2: Calculate bounds for the occupancy grid
    const bounds = this.calculateLevelBounds(walls)
    if (!bounds) return results

    // Step 3: Create and populate occupancy grid
    const grid = new OccupancyGrid(bounds, 0.1) // 10cm resolution

    // Rasterize all walls
    for (const wall of walls) {
      grid.rasterizeWall(wall.start, wall.end, wall.thickness || WALL_THICKNESS)
    }

    // Step 4: Flood fill exterior from grid boundary
    grid.floodFillExterior()

    // Step 5: Detect rooms (flood fill remaining EMPTY cells)
    grid.detectRooms()

    // Step 6: Determine interior side for each wall
    for (const wall of walls) {
      const interiorSide = this.determineInteriorSide(wall, grid)

      // Only update if the value has changed
      if (interiorSide !== wall.interiorSide) {
        results.push({
          nodeId: wall.id,
          updates: { interiorSide },
        })
      }
    }

    return results
  }

  /**
   * Recursively collect all walls in a level, including those nested in groups
   */
  private collectWalls(node: AnyNode): WallNode[] {
    const walls: WallNode[] = []

    const traverse = (n: AnyNode) => {
      if (n.type === 'wall') {
        walls.push(n as WallNode)
      }

      if ('children' in n && Array.isArray(n.children)) {
        for (const child of n.children) {
          traverse(child as AnyNode)
        }
      }
    }

    // Start traversing from level's children
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child as AnyNode)
      }
    }

    return walls
  }

  /**
   * Calculate the bounding box of all walls
   */
  private calculateLevelBounds(walls: WallNode[]): BoundingBox | null {
    let minX = Infinity,
      maxX = -Infinity
    let minZ = Infinity,
      maxZ = -Infinity

    for (const wall of walls) {
      const [x1, z1] = wall.start
      const [x2, z2] = wall.end
      minX = Math.min(minX, x1, x2)
      maxX = Math.max(maxX, x1, x2)
      minZ = Math.min(minZ, z1, z2)
      maxZ = Math.max(maxZ, z1, z2)
    }

    if (minX === Infinity) return null

    return { minX, maxX, minZ, maxZ }
  }

  /**
   * Determine which side of a wall faces interior space
   */
  private determineInteriorSide(
    wall: WallNode,
    grid: OccupancyGrid,
  ): 'front' | 'back' | 'both' | 'neither' {
    const frontState = grid.getSideState(wall.start, wall.end, 'front')
    const backState = grid.getSideState(wall.start, wall.end, 'back')

    const frontIsRoom = OccupancyGrid.isRoom(frontState)
    const backIsRoom = OccupancyGrid.isRoom(backState)

    if (frontIsRoom && backIsRoom) {
      // Wall between two rooms
      return 'both'
    } else if (frontIsRoom) {
      return 'front'
    } else if (backIsRoom) {
      return 'back'
    } else {
      // Neither side is a room (both exterior or wall)
      return 'neither'
    }
  }
}
