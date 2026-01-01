/**
 * Check if two line segments intersect (cross each other or overlap).
 * Returns true if they share any interior points.
 */
export function segmentsIntersect(
  segmentA: { x1: number; y1: number; x2: number; y2: number },
  segmentB: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const { x1: ax1, y1: ay1, x2: ax2, y2: ay2 } = segmentA
  const { x1: bx1, y1: by1, x2: bx2, y2: by2 } = segmentB

  const epsilon = 0.0001

  // Direction vectors
  const dax = ax2 - ax1
  const day = ay2 - ay1
  const dbx = bx2 - bx1
  const dby = by2 - by1

  // Cross product to check if lines are parallel
  const cross = dax * dby - day * dbx

  if (Math.abs(cross) > epsilon) {
    // Lines are not parallel - check for intersection point
    // Parametric form: A + t*(A2-A1) = B + s*(B2-B1)
    // Solving for t and s:
    const dx = bx1 - ax1
    const dy = by1 - ay1

    const t = (dx * dby - dy * dbx) / cross
    const s = (dx * day - dy * dax) / cross

    // Intersection is valid if both t and s are strictly between 0 and 1 (exclusive)
    // We exclude endpoints to allow walls to meet at corners
    if (t > epsilon && t < 1 - epsilon && s > epsilon && s < 1 - epsilon) {
      return true
    }
    return false
  }

  // Lines are parallel - check if they're collinear and overlap
  const dx = bx1 - ax1
  const dy = by1 - ay1

  // Cross product of (a1->a2) and (a1->b1) - if zero, points are collinear
  const collinearCross = dax * dy - day * dx
  if (Math.abs(collinearCross) > epsilon) {
    // Parallel but not collinear - no overlap
    return false
  }

  // Lines are collinear - check if segments overlap
  // Project onto the axis with greater extent
  let s0: number, s1: number

  if (Math.abs(dax) > Math.abs(day)) {
    // Project onto x-axis
    if (Math.abs(dax) < epsilon) return false // Segment A is a point
    s0 = (bx1 - ax1) / dax
    s1 = (bx2 - ax1) / dax
  } else {
    // Project onto y-axis
    if (Math.abs(day) < epsilon) return false // Segment A is a point
    s0 = (by1 - ay1) / day
    s1 = (by2 - ay1) / day
  }

  // Ensure s0 <= s1
  if (s0 > s1) {
    const temp = s0
    s0 = s1
    s1 = temp
  }

  // Check for overlap - segments overlap if their intervals share more than just endpoints
  // [0, 1] and [s0, s1]
  const overlapStart = Math.max(0, s0)
  const overlapEnd = Math.min(1, s1)

  // They overlap if the overlap region has positive length (not just touching at a point)
  return overlapEnd - overlapStart > epsilon
}

/**
 * Get all existing walls from all children on a level, recursively searching groups.
 * Returns walls with their absolute (world) coordinates.
 */
export function getAllWallsOnLevel(
  levelChildren: any[],
  excludeIds?: Set<string> | string,
): Array<{ x1: number; y1: number; x2: number; y2: number; id: string }> {
  const walls: Array<{ x1: number; y1: number; x2: number; y2: number; id: string }> = []

  // Convert single string to Set for consistent handling
  const excludeSet = typeof excludeIds === 'string' ? new Set([excludeIds]) : (excludeIds ?? new Set())

  function collectWalls(children: any[], parentPosition: [number, number] = [0, 0]) {
    for (const child of children) {
      // Skip excluded IDs (both walls and groups)
      if (excludeSet.has(child.id)) continue

      if (child.type === 'wall') {
        // Convert wall start/end to absolute coordinates
        const [sx, sy] = child.start
        const [ex, ey] = child.end
        walls.push({
          x1: parentPosition[0] + sx,
          y1: parentPosition[1] + sy,
          x2: parentPosition[0] + ex,
          y2: parentPosition[1] + ey,
          id: child.id,
        })
      } else if (child.type === 'group' && child.children) {
        // Recursively search groups (rooms)
        const groupPos: [number, number] = [
          parentPosition[0] + (child.position?.[0] ?? 0),
          parentPosition[1] + (child.position?.[1] ?? 0),
        ]
        collectWalls(child.children, groupPos)
      }
    }
  }

  collectWalls(levelChildren)
  return walls
}

/**
 * Check if any of the given wall segments intersect with existing walls on the level.
 */
export function checkWallsOverlap(
  newWalls: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  existingWalls: Array<{ x1: number; y1: number; x2: number; y2: number }>,
): boolean {
  for (const newWall of newWalls) {
    for (const existingWall of existingWalls) {
      if (segmentsIntersect(newWall, existingWall)) {
        return true
      }
    }
  }
  return false
}

// Keep the old name as an alias for backwards compatibility
export const wallSegmentsOverlap = segmentsIntersect
