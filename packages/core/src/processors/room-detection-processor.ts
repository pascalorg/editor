/**
 * Room Detection Processor
 * Uses flood fill to detect enclosed rooms and assign interior sides to walls
 */

import type { SceneGraph } from '../scenegraph'
import type { AnyNode } from '../scenegraph/schema/index'
import type { WallNode } from '../scenegraph/schema/nodes/wall'
import { type BoundingBox, OccupancyGrid } from './occupancy-grid'
import type { NodeProcessor, NodeProcessResult } from './types'

const WALL_THICKNESS = 0.2 // 20cm default wall thickness

export class RoomDetectionProcessor implements NodeProcessor {
  nodeTypes = ['level']

  // Cache for tracking when reprocessing is needed
  private readonly lastWallHash: Map<string, string> = new Map()

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
    const allWalls = this.collectWalls(levelNode)

    // Filter out preview walls - only process committed walls
    const walls = allWalls.filter((w) => !w.editor?.preview)

    // Step 1.5: Check if walls have changed since last processing
    // Compute hash BEFORE early return so we can detect "no walls" -> "some walls" transitions
    const wallHash = this.computeWallHash(walls)
    const levelId = (levelNode as any).id as string

    if (this.lastWallHash.get(levelId) === wallHash) {
      // No changes to committed walls, skip reprocessing
      return results
    }
    this.lastWallHash.set(levelId, wallHash)

    // No committed walls - nothing to process
    if (walls.length === 0) return results

    // Step 2: Calculate bounds for the occupancy grid
    const bounds = this.calculateLevelBounds(walls)
    if (!bounds) return results

    // Step 3: Create and populate occupancy grid
    const grid = new OccupancyGrid(bounds, 0.1) // 10cm resolution

    // Rasterize all walls onto the grid
    for (const wall of walls) {
      grid.rasterizeWall(wall.start, wall.end, wall.thickness || WALL_THICKNESS)
    }

    // Step 4: Flood fill exterior from grid boundary
    grid.floodFillExterior()

    // Step 5: Detect rooms (flood fill remaining EMPTY cells)
    // After this, any EMPTY cell that wasn't reached by exterior flood fill
    // becomes a room. Each contiguous region gets a unique room ID.
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
   * Transforms wall coordinates to level space based on parent group transforms
   */
  private collectWalls(node: AnyNode): WallNode[] {
    const walls: WallNode[] = []

    // Transform a point by group position and rotation
    const transformPoint = (
      point: [number, number],
      groupPos: [number, number],
      groupRot: number,
    ): [number, number] => {
      // Apply rotation then translation
      const cos = Math.cos(groupRot)
      const sin = Math.sin(groupRot)
      const rotatedX = point[0] * cos - point[1] * sin
      const rotatedZ = point[0] * sin + point[1] * cos
      return [rotatedX + groupPos[0], rotatedZ + groupPos[1]]
    }

    const traverse = (n: AnyNode, parentPos: [number, number], parentRot: number) => {
      if (n.type === 'wall') {
        const wall = n as WallNode
        // Transform wall coordinates to level space
        const transformedStart = transformPoint(wall.start, parentPos, parentRot)
        const transformedEnd = transformPoint(wall.end, parentPos, parentRot)

        // Create a copy with transformed coordinates for processing
        // (we don't modify the original wall node)
        walls.push({
          ...wall,
          start: transformedStart,
          end: transformedEnd,
        })
      }

      if (n.type === 'group' && 'position' in n && 'rotation' in n) {
        // Accumulate group transforms
        const group = n as { position: [number, number]; rotation: number; children: AnyNode[] }
        const newPos = transformPoint(group.position, parentPos, parentRot)
        const newRot = parentRot + group.rotation

        if (Array.isArray(group.children)) {
          for (const child of group.children) {
            traverse(child as AnyNode, newPos, newRot)
          }
        }
      } else if ('children' in n && Array.isArray(n.children)) {
        for (const child of n.children) {
          traverse(child as AnyNode, parentPos, parentRot)
        }
      }
    }

    // Start traversing from level's children with identity transform
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child as AnyNode, [0, 0], 0)
      }
    }

    return walls
  }

  /**
   * Compute a hash of wall positions to detect changes
   */
  private computeWallHash(walls: WallNode[]): string {
    if (walls.length === 0) return 'empty'

    // Sort by ID for consistent ordering
    const sorted = [...walls].sort((a, b) => a.id.localeCompare(b.id))
    // Create a simple hash from wall geometry
    const parts = sorted.map(
      (w) => `${w.id}:${w.start[0]},${w.start[1]}:${w.end[0]},${w.end[1]}:${w.thickness || 0.2}`,
    )
    return parts.join('|')
  }

  /**
   * Calculate the bounding box of all walls
   */
  private calculateLevelBounds(walls: WallNode[]): BoundingBox | null {
    let minX = Number.POSITIVE_INFINITY,
      maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY,
      maxZ = Number.NEGATIVE_INFINITY

    for (const wall of walls) {
      const [x1, z1] = wall.start
      const [x2, z2] = wall.end
      minX = Math.min(minX, x1, x2)
      maxX = Math.max(maxX, x1, x2)
      minZ = Math.min(minZ, z1, z2)
      maxZ = Math.max(maxZ, z1, z2)
    }

    if (minX === Number.POSITIVE_INFINITY) return null

    return { minX, maxX, minZ, maxZ }
  }

  /**
   * Determine which side of a wall faces interior space
   */
  private determineInteriorSide(
    wall: WallNode,
    grid: OccupancyGrid,
  ): 'front' | 'back' | 'both' | 'neither' {
    const thickness = wall.thickness || 0.2
    const frontState = grid.getSideState(wall.start, wall.end, 'front', thickness)
    const backState = grid.getSideState(wall.start, wall.end, 'back', thickness)

    const frontIsRoom = OccupancyGrid.isRoom(frontState)
    const backIsRoom = OccupancyGrid.isRoom(backState)

    if (frontIsRoom && backIsRoom) {
      // Wall between two rooms (or same room if it's an internal partition)
      return 'both'
    }
    if (frontIsRoom) {
      return 'front'
    }
    if (backIsRoom) {
      return 'back'
    }
    // Neither side is a room (both exterior or both wall)
    return 'neither'
  }
}
