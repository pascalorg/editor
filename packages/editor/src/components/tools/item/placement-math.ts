import { isObject } from '@pascal-app/core'

/**
 * Snaps a position to 0.5 grid, with an offset to align item edges to grid lines.
 * For items with dimensions like 2.5, the center would be at 1.25 from the edge,
 * which doesn't align with 0.5 grid. This adds an offset so edges align instead.
 */
export function snapToGrid(position: number, dimension: number): number {
  const halfDim = dimension / 2
  const needsOffset = Math.abs(((halfDim * 2) % 1) - 0.5) < 0.01
  const offset = needsOffset ? 0.25 : 0
  return Math.round((position - offset) * 2) / 2 + offset
}

/**
 * Snap a value to 0.5 increments (used for wall-local positions).
 */
export function snapToHalf(value: number): number {
  return Math.round(value * 2) / 2
}

/**
 * Calculate cursor rotation in WORLD space from wall normal and orientation.
 */
export function calculateCursorRotation(
  normal: [number, number, number] | undefined,
  wallStart: [number, number],
  wallEnd: [number, number],
): number {
  if (!normal) return 0

  // Wall direction angle in world XZ plane
  const wallAngle = Math.atan2(wallEnd[1] - wallStart[1], wallEnd[0] - wallStart[0])

  // In local wall space, front face has normal.z < 0, back face has normal.z > 0
  if (normal[2] < 0) {
    return -wallAngle
  } else {
    return Math.PI - wallAngle
  }
}

/**
 * Calculate item rotation in WALL-LOCAL space from normal.
 * Items are children of the wall mesh, so their rotation is relative to wall's local space.
 */
export function calculateItemRotation(normal: [number, number, number] | undefined): number {
  if (!normal) return 0

  return normal[2] > 0 ? 0 : Math.PI
}

/**
 * Determine which side of the wall based on the normal vector.
 * In wall-local space, the wall runs along X-axis, so the normal points along Z-axis.
 * Positive Z normal = 'front', Negative Z normal = 'back'
 */
export function getSideFromNormal(normal: [number, number, number] | undefined): 'front' | 'back' {
  if (!normal) return 'front'
  return normal[2] >= 0 ? 'front' : 'back'
}

/**
 * Check if the normal indicates a valid wall side face (front or back).
 * Filters out top face and thickness edges.
 *
 * In wall-local geometry space (after ExtrudeGeometry + rotateX):
 * - X axis: along wall direction
 * - Y axis: up (height)
 * - Z axis: perpendicular to wall (thickness direction)
 *
 * So valid side faces have normals pointing in ±Z direction (local space).
 */
export function isValidWallSideFace(normal: [number, number, number] | undefined): boolean {
  if (!normal) return false
  return Math.abs(normal[2]) > 0.7
}

/**
 * Strip the `isTransient` flag from node metadata before committing.
 */
export function stripTransient(meta: any): any {
  if (!isObject(meta)) return meta
  const { isTransient, ...rest } = meta as Record<string, any>
  return rest
}
