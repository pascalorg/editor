/**
 * Node-based Bounds Calculation
 *
 * Generic bounds calculation that works with the node tree structure.
 * Automatically handles all node types that implement GridItem interface.
 * No need to update when adding new building element types.
 */

import type { BaseNode, GridItem, LevelNode, RoofNode, RoofSegmentNode, WallNode } from './types'
import { traverseTree } from './utils'

/**
 * Bounds in 3D space matching Three.js coordinate system:
 * - X: horizontal (east-west)
 * - Y: vertical (up-down) - determined by floor level
 * - Z: horizontal depth (north-south)
 *
 * For 2D floor footprints, Y is implicit (floor level)
 */
export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Type guard to check if a node implements GridItem
 */
function hasGridPosition(node: BaseNode): node is BaseNode & GridItem {
  return 'position' in node && 'rotation' in node && 'size' in node
}

/**
 * Calculate the bounding box for a single node
 * Returns null if the node has no spatial extent
 */
function calculateNodeBounds(node: BaseNode): Bounds | null {
  // Skip hidden nodes
  if (node.visible === false) {
    return null
  }

  // Handle nodes with grid position
  if (hasGridPosition(node)) {
    // Grid coordinates: [x, z] where x is horizontal, z is depth
    // Grid Y coordinate maps to World Z coordinate
    const [x, z] = node.position
    const [width, depth] = node.size
    const rotation = node.rotation

    // Calculate the four corners of the node's bounding box
    // This works for any rotated rectangle
    const corners = [
      // Origin point
      { x, z },
      // Point along the length (width)
      { x: x + width * Math.cos(rotation), z: z + width * Math.sin(rotation) },
      // Opposite corner (diagonal)
      {
        x: x + width * Math.cos(rotation) - depth * Math.sin(rotation),
        z: z + width * Math.sin(rotation) + depth * Math.cos(rotation),
      },
      // Point along the depth
      { x: x - depth * Math.sin(rotation), z: z + depth * Math.cos(rotation) },
    ]

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY

    for (const corner of corners) {
      minX = Math.min(minX, corner.x)
      maxX = Math.max(maxX, corner.x)
      minZ = Math.min(minZ, corner.z)
      maxZ = Math.max(maxZ, corner.z)
    }

    // Special handling for roof segments with width
    if (node.type === 'roof-segment') {
      const roofSegment = node as RoofSegmentNode
      const leftWidth = roofSegment.leftWidth ?? 0
      const rightWidth = roofSegment.rightWidth ?? 0

      // Roof widths are in meters, need to convert to grid units
      const GRID_SIZE = 0.5
      const leftWidthGrid = leftWidth / GRID_SIZE
      const rightWidthGrid = rightWidth / GRID_SIZE

      // Calculate perpendicular direction for width expansion
      const perpX = -Math.sin(rotation)
      const perpZ = Math.cos(rotation)

      // Expand bounds to include roof width on both sides
      const leftExtent = [
        { x: x + perpX * leftWidthGrid, z: z + perpZ * leftWidthGrid },
        {
          x: x + width * Math.cos(rotation) + perpX * leftWidthGrid,
          z: z + width * Math.sin(rotation) + perpZ * leftWidthGrid,
        },
      ]

      const rightExtent = [
        { x: x - perpX * rightWidthGrid, z: z - perpZ * rightWidthGrid },
        {
          x: x + width * Math.cos(rotation) - perpX * rightWidthGrid,
          z: z + width * Math.sin(rotation) - perpZ * rightWidthGrid,
        },
      ]

      for (const point of [...leftExtent, ...rightExtent]) {
        minX = Math.min(minX, point.x)
        maxX = Math.max(maxX, point.x)
        minZ = Math.min(minZ, point.z)
        maxZ = Math.max(maxZ, point.z)
      }
    }

    return { minX, maxX, minZ, maxZ }
  }

  return null
}

/**
 * Merge two bounds into a single bounding box
 */
function mergeBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!(a || b)) return null
  if (!a) return b
  if (!b) return a

  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  }
}

/**
 * Calculate bounds for a level by traversing all its children
 * This automatically handles all node types without needing updates
 *
 * @param level - The level node to calculate bounds for
 * @param minSize - Minimum bounds size (ensures a minimum clickable area)
 * @returns Bounds in grid units, or null if level has no elements
 */
export function calculateLevelBounds(level: LevelNode, minSize = 6): Bounds | null {
  let bounds: Bounds | null = null

  // Traverse all children of the level
  traverseTree(level, (node, _parent, _depth) => {
    // Skip the level node itself
    if (node.type === 'level') {
      return true
    }

    // Calculate bounds for this node
    const nodeBounds = calculateNodeBounds(node)
    if (nodeBounds) {
      bounds = mergeBounds(bounds, nodeBounds)
    }

    return true
  })

  // If no bounds found, return null
  if (!bounds) {
    return null
  }

  // Ensure minimum size for clickability
  // Type assertion needed because TypeScript can't narrow bounds through the closure
  const nonNullBounds = bounds as Bounds
  const width = nonNullBounds.maxX - nonNullBounds.minX
  const depth = nonNullBounds.maxZ - nonNullBounds.minZ

  let minX = nonNullBounds.minX
  let maxX = nonNullBounds.maxX
  let minZ = nonNullBounds.minZ
  let maxZ = nonNullBounds.maxZ

  if (width < minSize) {
    const expansion = (minSize - width) / 2
    minX -= expansion
    maxX += expansion
  }

  if (depth < minSize) {
    const expansion = (minSize - depth) / 2
    minZ -= expansion
    maxZ += expansion
  }

  return { minX, maxX, minZ, maxZ }
}

/**
 * Calculate bounds for a specific level by ID
 *
 * @param levels - All level nodes
 * @param levelId - ID of the level to calculate bounds for
 * @param minSize - Minimum bounds size
 * @returns Bounds in grid units, or null if level not found or has no elements
 */
export function calculateLevelBoundsById(
  levels: LevelNode[],
  levelId: string,
  minSize = 6,
): Bounds | null {
  const level = levels.find((l) => l.id === levelId)
  if (!level) {
    return null
  }

  return calculateLevelBounds(level, minSize)
}

/**
 * Calculate combined bounds for all visible levels
 * Useful for camera framing or export operations
 */
export function calculateAllLevelsBounds(levels: LevelNode[], minSize = 6): Bounds | null {
  let combinedBounds: Bounds | null = null

  for (const level of levels) {
    if (level.visible === false) {
      continue
    }

    const levelBounds = calculateLevelBounds(level, 0) // Don't apply minSize per level
    if (levelBounds) {
      combinedBounds = mergeBounds(combinedBounds, levelBounds)
    }
  }

  // Apply minimum size to combined bounds
  if (!combinedBounds) {
    return null
  }

  // Type assertion needed because TypeScript can't narrow combinedBounds properly
  const nonNullBounds = combinedBounds as Bounds
  const width = nonNullBounds.maxX - nonNullBounds.minX
  const depth = nonNullBounds.maxZ - nonNullBounds.minZ

  let minX = nonNullBounds.minX
  let maxX = nonNullBounds.maxX
  let minZ = nonNullBounds.minZ
  let maxZ = nonNullBounds.maxZ

  if (width < minSize) {
    const expansion = (minSize - width) / 2
    minX -= expansion
    maxX += expansion
  }

  if (depth < minSize) {
    const expansion = (minSize - depth) / 2
    minZ -= expansion
    maxZ += expansion
  }

  return { minX, maxX, minZ, maxZ }
}
