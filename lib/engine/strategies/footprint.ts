/**
 * Footprint Computation Strategies
 *
 * Pure functions for computing 2D footprints from different sources.
 */

import type { Footprint, TransformGrid } from '../components'
import { TRANSFORM_GRID } from '../components'
import type { World } from '../core'
import type { ElementSpec, FootprintStrategy } from '../spec'

// ============================================================================
// FOOTPRINT COMPUTATION
// ============================================================================

/**
 * Compute footprint from a strategy
 */
export function footprintFromStrategy(
  strategy: FootprintStrategy,
  entityId: string,
  world: World,
  spec?: ElementSpec,
): Footprint | null {
  switch (strategy) {
    case 'rectFromSize':
      return rectFromSize(entityId, world)
    case 'polygon':
      return polygonFromSpec(entityId, world, spec)
    case 'hullFromModelXY':
      // TODO: Implement when we have model loading
      console.warn('hullFromModelXY strategy not yet implemented')
      return null
    default:
      console.warn(`Unknown footprint strategy: ${strategy}`)
      return null
  }
}

/**
 * Compute rectangular footprint from TransformGrid
 */
function rectFromSize(entityId: string, world: World): Footprint | null {
  const transform = world.getComponent<TransformGrid>(entityId, TRANSFORM_GRID)
  if (!transform) return null

  const { position, rotation, size } = transform

  // Convert grid units to meters
  const posX = position[0] * world.gridSizeMeters
  const posZ = position[1] * world.gridSizeMeters
  const width = size[0] * world.gridSizeMeters
  const depth = size[1] * world.gridSizeMeters

  // Compute rotated corners (clockwise from origin)
  const corners: Array<[number, number]> = [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ]

  const polygon = corners.map(([x, z]) => {
    const rx = posX + x * Math.cos(rotation) - z * Math.sin(rotation)
    const rz = posZ + x * Math.sin(rotation) + z * Math.cos(rotation)
    return [rx, rz] as [number, number]
  })

  const area = width * depth

  return { polygon, area }
}

/**
 * Compute polygon footprint from spec
 */
function polygonFromSpec(entityId: string, world: World, spec?: ElementSpec): Footprint | null {
  const transform = world.getComponent<TransformGrid>(entityId, TRANSFORM_GRID)
  if (!transform) return null

  const specPolygon = spec?.footprint?.polygon
  if (!specPolygon || specPolygon.length < 3) {
    console.warn('Polygon footprint requires at least 3 points in spec')
    return null
  }

  const { position, rotation } = transform

  // Convert grid units to meters
  const posX = position[0] * world.gridSizeMeters
  const posZ = position[1] * world.gridSizeMeters

  // Transform polygon points (which are in meters relative to origin)
  const polygon = specPolygon.map(([x, z]) => {
    const rx = posX + x * Math.cos(rotation) - z * Math.sin(rotation)
    const rz = posZ + x * Math.sin(rotation) + z * Math.cos(rotation)
    return [rx, rz] as [number, number]
  })

  const area = computePolygonArea(polygon)

  return { polygon, area }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Compute area of a polygon using the shoelace formula
 */
export function computePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0

  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    area += polygon[i][0] * polygon[j][1]
    area -= polygon[j][0] * polygon[i][1]
  }

  return Math.abs(area) / 2
}

/**
 * Check if a point is inside a polygon (ray casting algorithm)
 */
export function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  const [x, y] = point
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi

    if (intersect) inside = !inside
  }

  return inside
}

/**
 * Check if two polygons intersect (using separating axis theorem)
 * Simplified version - checks if any edge of one polygon intersects with another
 */
export function polygonsIntersect(
  poly1: Array<[number, number]>,
  poly2: Array<[number, number]>,
): boolean {
  // Check if any vertex of poly1 is inside poly2
  for (const point of poly1) {
    if (pointInPolygon(point, poly2)) return true
  }

  // Check if any vertex of poly2 is inside poly1
  for (const point of poly2) {
    if (pointInPolygon(point, poly1)) return true
  }

  // Check if any edges intersect
  for (let i = 0; i < poly1.length; i++) {
    const j = (i + 1) % poly1.length
    const edge1 = [poly1[i], poly1[j]] as const

    for (let k = 0; k < poly2.length; k++) {
      const l = (k + 1) % poly2.length
      const edge2 = [poly2[k], poly2[l]] as const

      if (edgesIntersect(edge1[0], edge1[1], edge2[0], edge2[1])) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if two line segments intersect
 */
function edgesIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const ccw = (a: [number, number], b: [number, number], c: [number, number]) =>
    (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])

  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
}
