/**
 * Bounds Computation Strategies
 *
 * Pure functions for computing bounding boxes from different sources.
 */

import type { Bounds, TransformGrid } from '../components'
import { TRANSFORM_GRID } from '../components'
import type { World } from '../core'
import { gridToMeters } from '../core'
import type { BoundsStrategy, ElementSpec } from '../spec'

// ============================================================================
// BOUNDS COMPUTATION
// ============================================================================

/**
 * Compute bounds from a strategy
 */
export function boundsFromStrategy(
  strategy: BoundsStrategy,
  entityId: string,
  world: World,
  spec?: ElementSpec,
): Bounds | null {
  switch (strategy) {
    case 'orientedRectFromSize':
      return orientedRectFromSize(entityId, world)
    case 'aabbFromModelXY':
      // TODO: Implement when we have model loading
      console.warn('aabbFromModelXY strategy not yet implemented')
      return null
    case 'convexHullFromModelXY':
      // TODO: Implement when we have model loading
      console.warn('convexHullFromModelXY strategy not yet implemented')
      return null
    default:
      console.warn(`Unknown bounds strategy: ${strategy}`)
      return null
  }
}

/**
 * Compute oriented bounding box from TransformGrid size
 */
function orientedRectFromSize(entityId: string, world: World): Bounds | null {
  const transform = world.getComponent<TransformGrid>(entityId, TRANSFORM_GRID)
  if (!transform) return null

  const { position, rotation, size } = transform

  // Convert grid units to meters for world coordinates
  const posX = position[0] * world.gridSizeMeters
  const posZ = position[1] * world.gridSizeMeters
  const width = size[0] * world.gridSizeMeters
  const depth = size[1] * world.gridSizeMeters

  // For a simple rect, we can compute both AABB and OBB
  // Height is assumed to be standard wall height (2.7m for now)
  const height = 2.7

  // OBB center is at the center of the element
  const centerX = posX + (width / 2) * Math.cos(rotation) - (depth / 2) * Math.sin(rotation)
  const centerZ = posZ + (width / 2) * Math.sin(rotation) + (depth / 2) * Math.cos(rotation)
  const centerY = height / 2

  // Compute AABB by rotating the corners
  const corners: Array<[number, number]> = [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ]

  const rotatedCorners = corners.map(([x, z]) => {
    const rx = posX + x * Math.cos(rotation) - z * Math.sin(rotation)
    const rz = posZ + x * Math.sin(rotation) + z * Math.cos(rotation)
    return [rx, rz]
  })

  const minX = Math.min(...rotatedCorners.map(([x]) => x))
  const maxX = Math.max(...rotatedCorners.map(([x]) => x))
  const minZ = Math.min(...rotatedCorners.map(([, z]) => z))
  const maxZ = Math.max(...rotatedCorners.map(([, z]) => z))

  return {
    aabb: {
      min: [minX, 0, minZ],
      max: [maxX, height, maxZ],
    },
    obb: {
      center: [centerX, centerY, centerZ],
      halfExtents: [width / 2, height / 2, depth / 2],
      rotation,
    },
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Compute AABB from a set of points
 */
export function aabbFromPoints(points: Array<[number, number, number]>): Bounds['aabb'] {
  if (points.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] }
  }

  const min: [number, number, number] = [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.min(...points.map((p) => p[2])),
  ]

  const max: [number, number, number] = [
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[2])),
  ]

  return { min, max }
}

/**
 * Expand AABB by a margin
 */
export function expandAABB(aabb: Bounds['aabb'], margin: number): Bounds['aabb'] {
  return {
    min: [aabb.min[0] - margin, aabb.min[1] - margin, aabb.min[2] - margin],
    max: [aabb.max[0] + margin, aabb.max[1] + margin, aabb.max[2] + margin],
  }
}

/**
 * Check if two AABBs intersect
 */
export function aabbIntersects(a: Bounds['aabb'], b: Bounds['aabb']): boolean {
  return (
    a.min[0] <= b.max[0] &&
    a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] &&
    a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] &&
    a.max[2] >= b.min[2]
  )
}
