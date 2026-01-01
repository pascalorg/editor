import type { WallSegment } from '@pascal/core/scenegraph/common-types'

// Helper function to check if a grid point lies on a wall segment
export function isPointOnSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): boolean {
  const EPSILON = 0.001 // Tiny tolerance for floating point errors

  const px = point[0]
  const py = point[1]
  const x1 = segStart[0]
  const y1 = segStart[1]
  const x2 = segEnd[0]
  const y2 = segEnd[1]

  // Check if point is within the bounding box of the segment
  const minX = Math.min(x1, x2) - EPSILON
  const maxX = Math.max(x1, x2) + EPSILON
  const minY = Math.min(y1, y2) - EPSILON
  const maxY = Math.max(y1, y2) + EPSILON

  if (px < minX || px > maxX || py < minY || py > maxY) {
    return false
  }

  // Check if point is collinear with the segment
  // Using cross product: if (p - start) × (end - start) ≈ 0, then collinear
  const crossProduct = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1)

  return Math.abs(crossProduct) < EPSILON
}

export interface WallElementPlacementValidation {
  canPlace: boolean
  gridPosition: [number, number]
  centeredPosition: [number, number]
  rotation: number
  nearestWall: WallSegment | null
}

interface ValidateWallElementPlacementOptions {
  mouseGridPosition: [number, number] | null
  wallSegments: WallSegment[]
  existingElements: Array<{ position: [number, number]; rotation: number }>
  elementWidth: number // In grid cells (e.g., 2 for doors/windows)
  snapThreshold?: number
}

/**
 * Validates whether a wall element (door or window) can be placed at a given position.
 *
 * Rules:
 * 1. Both endpoints must have a wall in the correct direction
 * 2. No point (endpoints or center) should have a conflicting perpendicular wall
 * 3. No existing element should occupy either endpoint
 */
export function validateWallElementPlacement({
  mouseGridPosition,
  wallSegments,
  existingElements,
  elementWidth,
  snapThreshold = 0.5,
}: ValidateWallElementPlacementOptions): WallElementPlacementValidation | null {
  if (!mouseGridPosition) return null

  // Find nearest wall and snap to it
  let nearestWall: WallSegment | null = null
  let nearestPoint: [number, number] = mouseGridPosition
  let minDistance = Number.POSITIVE_INFINITY

  // Helper function to find closest point on segment
  const closestPointOnSegment = (
    point: [number, number],
    segStart: [number, number],
    segEnd: [number, number],
  ): { point: [number, number]; distance: number } => {
    const px = point[0]
    const py = point[1]
    const x1 = segStart[0]
    const y1 = segStart[1]
    const x2 = segEnd[0]
    const y2 = segEnd[1]

    const dx = x2 - x1
    const dy = y2 - y1
    const lengthSquared = dx * dx + dy * dy

    if (lengthSquared === 0) {
      const dist = Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
      return { point: [x1, y1], distance: dist }
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared
    t = Math.max(0, Math.min(1, t))

    const closestX = x1 + t * dx
    const closestY = y1 + t * dy
    const distance = Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2)

    return { point: [closestX, closestY], distance }
  }

  for (const wall of wallSegments) {
    const result = closestPointOnSegment(mouseGridPosition, wall.start, wall.end)
    if (result.distance < minDistance) {
      minDistance = result.distance
      nearestPoint = result.point
      nearestWall = wall
    }
  }

  const shouldSnap = nearestWall !== null && minDistance <= snapThreshold
  let canPlace = false
  let rotation = 0
  let centeredPosition = nearestPoint

  if (shouldSnap && nearestWall) {
    // Calculate wall direction
    const dx = nearestWall.end[0] - nearestWall.start[0]
    const dz = nearestWall.end[1] - nearestWall.start[1]
    const wallAngle = Math.atan2(dz, dx)
    rotation = -wallAngle

    const wallLength = Math.sqrt(dx * dx + dz * dz)
    if (wallLength > 0) {
      const wallDirX = dx / wallLength
      const wallDirZ = dz / wallLength

      // Snap nearestPoint to the nearest grid point
      const snappedGridPoint: [number, number] = [
        Math.round(nearestPoint[0]),
        Math.round(nearestPoint[1]),
      ]

      // Element visual is centered at gridPosition and extends 1 cell in EACH direction
      // So we need to check BOTH endpoints: gridPosition ± 1 in wall direction
      const gridPoint1: [number, number] = [
        snappedGridPoint[0] + Math.round(wallDirX),
        snappedGridPoint[1] + Math.round(wallDirZ),
      ]
      const gridPoint2: [number, number] = [
        snappedGridPoint[0] - Math.round(wallDirX),
        snappedGridPoint[1] - Math.round(wallDirZ),
      ]

      // Check that element placement is valid:
      // 1. Both endpoints must have a wall in the correct direction
      // 2. No point (endpoints OR center) should have a conflicting perpendicular wall
      canPlace = true

      // Check all 3 points: both endpoints AND the center
      const pointsToCheck = [gridPoint1, gridPoint2, snappedGridPoint]
      const endpointIndices = [0, 1] // First two are endpoints

      for (let i = 0; i < pointsToCheck.length; i++) {
        const gridPoint = pointsToCheck[i]
        const isEndpoint = endpointIndices.includes(i)
        let hasCorrectWall = false
        let hasConflictingWall = false

        // Check all wall segments at this grid point
        for (const wall of wallSegments) {
          // Check if the grid point lies exactly on this wall segment
          if (isPointOnSegment(gridPoint, wall.start, wall.end)) {
            // Check wall orientation
            const segDx = wall.end[0] - wall.start[0]
            const segDz = wall.end[1] - wall.start[1]
            const segAngle = Math.atan2(segDz, segDx)
            const angleDiff = Math.abs(wallAngle - segAngle)
            // Normalize angle difference to [0, PI]
            const normalizedDiff = Math.min(angleDiff, Math.abs(angleDiff - Math.PI * 2))

            if (normalizedDiff < 0.1 || Math.abs(normalizedDiff - Math.PI) < 0.1) {
              // Wall is parallel (same or opposite direction)
              hasCorrectWall = true
            } else {
              // Wall has a different direction - conflict!
              hasConflictingWall = true
            }
          }
        }

        // Endpoints must have correct wall, all points must not have conflicting walls
        if (isEndpoint && !hasCorrectWall) {
          canPlace = false
          break
        }
        if (hasConflictingWall) {
          canPlace = false
          break
        }
      }

      // Calculate centered position (average of the two endpoints = snappedGridPoint)
      centeredPosition = [(gridPoint1[0] + gridPoint2[0]) / 2, (gridPoint1[1] + gridPoint2[1]) / 2]

      if (canPlace) {
        // Check if there's already an element occupying any of our three grid points
        // Each element occupies 3 grid points: 2 endpoints + 1 center
        for (const existingElement of existingElements) {
          // Calculate the three grid points occupied by the existing element
          // rotation = -wallAngle, so wallAngle = -rotation
          // wallDir = [cos(wallAngle), sin(wallAngle)] = [cos(-rotation), sin(-rotation)]
          const existingWallDirX = Math.cos(-existingElement.rotation)
          const existingWallDirZ = Math.sin(-existingElement.rotation)

          const existingCenter = existingElement.position
          const existingEndpoint1: [number, number] = [
            existingCenter[0] + Math.round(existingWallDirX),
            existingCenter[1] + Math.round(existingWallDirZ),
          ]
          const existingEndpoint2: [number, number] = [
            existingCenter[0] - Math.round(existingWallDirX),
            existingCenter[1] - Math.round(existingWallDirZ),
          ]

          // Our new element occupies: gridPoint1, gridPoint2 (endpoints), and snappedGridPoint (center)
          const newPoints = [gridPoint1, gridPoint2, snappedGridPoint]
          const existingPoints = [existingEndpoint1, existingEndpoint2, existingCenter]

          // Count how many points overlap
          // If 1 point overlaps: Adjacent placement (OK - they share an endpoint)
          // If 2+ points overlap: Actual collision (NOT OK)
          let overlapCount = 0

          for (const newPoint of newPoints) {
            for (const existingPoint of existingPoints) {
              if (
                Math.abs(newPoint[0] - existingPoint[0]) < 0.01 &&
                Math.abs(newPoint[1] - existingPoint[1]) < 0.01
              ) {
                overlapCount++
              }
            }
          }

          if (overlapCount >= 2) {
            canPlace = false
            break
          }
        }
      }
    }
  }

  return {
    gridPosition: shouldSnap
      ? ([Math.round(nearestPoint[0]), Math.round(nearestPoint[1])] as [number, number])
      : mouseGridPosition,
    centeredPosition: shouldSnap ? centeredPosition : mouseGridPosition,
    canPlace: shouldSnap ? canPlace : false,
    rotation,
    nearestWall: shouldSnap ? nearestWall : null,
  }
}
