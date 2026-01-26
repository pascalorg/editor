import type { WallNode } from '../../schema'

// ============================================================================
// TYPES
// ============================================================================

export interface Point2D {
  x: number
  y: number
}

interface LineEquation {
  a: number
  b: number
  c: number // ax + by + c = 0
}

interface WallEndpoint {
  wall: WallNode
  endType: 'start' | 'end'
}

interface Junction {
  point: Point2D
  walls: WallEndpoint[]
}

export interface MiterData {
  left: Point2D
  right: Point2D
  center: Point2D // The junction meeting point
}

// Map of wallId -> { start?: MiterData, end?: MiterData }
export type WallMiterMap = Map<string, { start?: MiterData; end?: MiterData }>

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const TOLERANCE = 0.001

function pointToKey(p: Point2D, tolerance = TOLERANCE): string {
  const snap = 1 / tolerance
  return `${Math.round(p.x * snap)},${Math.round(p.y * snap)}`
}

function createLineFromPointAndVector(p: Point2D, v: Point2D): LineEquation {
  const a = -v.y
  const b = v.x
  const c = -(a * p.x + b * p.y)
  return { a, b, c }
}

function intersectLines(l1: LineEquation, l2: LineEquation): Point2D | null {
  const det = l1.a * l2.b - l2.a * l1.b
  if (Math.abs(det) < 1e-9) return null
  const x = (l1.b * l2.c - l2.b * l1.c) / det
  const y = (l2.a * l1.c - l1.a * l2.c) / det
  return { x, y }
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y
}

function pointOnWallSegment(
  point: Point2D,
  wallStart: Point2D,
  wallEnd: Point2D,
  tolerance = TOLERANCE,
): boolean {
  const wallVec = { x: wallEnd.x - wallStart.x, y: wallEnd.y - wallStart.y }
  const wallLen = Math.sqrt(wallVec.x * wallVec.x + wallVec.y * wallVec.y)
  if (wallLen < 1e-9) return false

  const toPoint = { x: point.x - wallStart.x, y: point.y - wallStart.y }
  const t = dot(toPoint, wallVec) / (wallLen * wallLen)

  if (t <= tolerance / wallLen || t >= 1 - tolerance / wallLen) return false

  const projX = wallStart.x + t * wallVec.x
  const projY = wallStart.y + t * wallVec.y
  const dist = Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2)

  return dist < tolerance
}

// ============================================================================
// JUNCTION DETECTION
// ============================================================================

/**
 * Finds all junctions where wall endpoints meet
 */
function findJunctions(walls: WallNode[]): Map<string, Junction> {
  const junctionMap = new Map<string, Junction>()

  for (const wall of walls) {
    const startPt: Point2D = { x: wall.start[0], y: wall.start[1] }
    const endPt: Point2D = { x: wall.end[0], y: wall.end[1] }

    const startKey = pointToKey(startPt)
    const endKey = pointToKey(endPt)

    if (!junctionMap.has(startKey)) {
      junctionMap.set(startKey, { point: startPt, walls: [] })
    }
    junctionMap.get(startKey)!.walls.push({ wall, endType: 'start' })

    if (!junctionMap.has(endKey)) {
      junctionMap.set(endKey, { point: endPt, walls: [] })
    }
    junctionMap.get(endKey)!.walls.push({ wall, endType: 'end' })
  }

  // Only keep junctions with 2+ walls
  const actualJunctions = new Map<string, Junction>()
  for (const [key, junction] of junctionMap) {
    if (junction.walls.length >= 2) {
      actualJunctions.set(key, junction)
    }
  }

  return actualJunctions
}

// ============================================================================
// MITER CALCULATION (Simple approach from prototype)
// ============================================================================

interface ProcessedWall {
  wallId: string
  endType: 'start' | 'end'
  angle: number
  edgeA: LineEquation // Left edge (CCW from outgoing direction)
  edgeB: LineEquation // Right edge (CW from outgoing direction)
}

/**
 * Calculates miter intersections for a junction
 * Simple algorithm from prototype:
 * 1. Get outgoing vector for each wall (pointing away from junction)
 * 2. Calculate left/right edge lines offset by halfThickness
 * 3. Sort walls by outgoing angle
 * 4. Intersect adjacent edges: wall[i].edgeA ∩ wall[i+1].edgeB
 * 5. Assign: wall[k].left = intersection[k], wall[k].right = intersection[k-1]
 */
function calculateJunctionMiters(
  junction: Junction,
  getThickness: (wall: WallNode) => number,
): Map<string, MiterData> {
  const { point, walls } = junction
  const result = new Map<string, MiterData>()
  const processedWalls: ProcessedWall[] = []

  // Process each wall at this junction
  for (const { wall, endType } of walls) {
    const halfT = getThickness(wall) / 2

    // Outgoing vector (pointing away from junction)
    const v =
      endType === 'start'
        ? { x: wall.end[0] - wall.start[0], y: wall.end[1] - wall.start[1] }
        : { x: wall.start[0] - wall.end[0], y: wall.start[1] - wall.end[1] }

    const L = Math.sqrt(v.x * v.x + v.y * v.y)
    if (L < 1e-9) continue

    // Perpendicular unit vector (90° CCW = "left" of outgoing direction)
    const nUnit = { x: -v.y / L, y: v.x / L }

    // Points on left (A) and right (B) edges at the junction
    const pA = { x: point.x + nUnit.x * halfT, y: point.y + nUnit.y * halfT }
    const pB = { x: point.x - nUnit.x * halfT, y: point.y - nUnit.y * halfT }

    // Edge lines
    const edgeA = createLineFromPointAndVector(pA, v)
    const edgeB = createLineFromPointAndVector(pB, v)

    // Angle for sorting
    const angle = Math.atan2(v.y, v.x)

    processedWalls.push({ wallId: wall.id, endType, angle, edgeA, edgeB })
  }

  // Sort by outgoing angle
  processedWalls.sort((a, b) => a.angle - b.angle)

  const n = processedWalls.length
  if (n < 2) return result

  // Calculate intersections between adjacent walls
  const intersections: Point2D[] = []
  for (let i = 0; i < n; i++) {
    const wall1 = processedWalls[i]!
    const wall2 = processedWalls[(i + 1) % n]!

    // Intersect left edge of wall1 with right edge of wall2
    const intersection = intersectLines(wall1.edgeA, wall2.edgeB)

    // If parallel, use junction center
    intersections.push(intersection ?? point)
  }

  // Assign miter data to each wall
  // wall[k].left = intersection[k], wall[k].right = intersection[k-1]
  for (let k = 0; k < n; k++) {
    const wall = processedWalls[k]!
    const prevIdx = (k - 1 + n) % n

    result.set(wall.wallId, {
      left: intersections[k]!,
      right: intersections[prevIdx]!,
      center: point, // Junction center point
    })
  }

  return result
}

// ============================================================================
// T-JUNCTION HANDLING
// ============================================================================

/**
 * Finds T-junctions where a wall endpoint meets another wall's side
 */
function findTJunctions(walls: WallNode[]): Map<string, { junction: Junction; hostWall: WallNode }> {
  const tJunctions = new Map<string, { junction: Junction; hostWall: WallNode }>()

  for (const wall of walls) {
    const endpoints: { pt: Point2D; endType: 'start' | 'end' }[] = [
      { pt: { x: wall.start[0], y: wall.start[1] }, endType: 'start' },
      { pt: { x: wall.end[0], y: wall.end[1] }, endType: 'end' },
    ]

    for (const { pt, endType } of endpoints) {
      const key = pointToKey(pt)

      for (const otherWall of walls) {
        if (otherWall.id === wall.id) continue

        const otherStart: Point2D = { x: otherWall.start[0], y: otherWall.start[1] }
        const otherEnd: Point2D = { x: otherWall.end[0], y: otherWall.end[1] }

        // Skip if touching endpoints (handled by regular junctions)
        if (pointToKey(pt) === pointToKey(otherStart)) continue
        if (pointToKey(pt) === pointToKey(otherEnd)) continue

        // Check if endpoint lies on the other wall's segment
        if (pointOnWallSegment(pt, otherStart, otherEnd)) {
          if (!tJunctions.has(key)) {
            tJunctions.set(key, {
              junction: { point: pt, walls: [] },
              hostWall: otherWall,
            })
          }

          const entry = tJunctions.get(key)!
          if (!entry.junction.walls.some((w) => w.wall.id === wall.id && w.endType === endType)) {
            entry.junction.walls.push({ wall, endType })
          }
        }
      }
    }
  }

  return tJunctions
}

/**
 * Calculates miter for T-junction (wall endpoint meeting another wall's side)
 */
function calculateTJunctionMiters(
  junction: Junction,
  hostWall: WallNode,
  getThickness: (wall: WallNode) => number,
): Map<string, MiterData> {
  const { point, walls } = junction
  const result = new Map<string, MiterData>()

  // Host wall direction and normal
  const hostDir = {
    x: hostWall.end[0] - hostWall.start[0],
    y: hostWall.end[1] - hostWall.start[1],
  }
  const hostLen = Math.sqrt(hostDir.x * hostDir.x + hostDir.y * hostDir.y)
  if (hostLen < 1e-9) return result

  const hostDirNorm = { x: hostDir.x / hostLen, y: hostDir.y / hostLen }
  const hostNormal = { x: -hostDirNorm.y, y: hostDirNorm.x }
  const hostHalfT = getThickness(hostWall) / 2

  // Host wall edge lines at the junction point
  const hostLeft = { x: point.x + hostNormal.x * hostHalfT, y: point.y + hostNormal.y * hostHalfT }
  const hostRight = { x: point.x - hostNormal.x * hostHalfT, y: point.y - hostNormal.y * hostHalfT }
  const hostEdgeLeft = createLineFromPointAndVector(hostLeft, hostDirNorm)
  const hostEdgeRight = createLineFromPointAndVector(hostRight, hostDirNorm)

  // For each incoming wall, extend to meet host wall's edge
  for (const { wall, endType } of walls) {
    const halfT = getThickness(wall) / 2

    // Outgoing vector
    const v =
      endType === 'start'
        ? { x: wall.end[0] - wall.start[0], y: wall.end[1] - wall.start[1] }
        : { x: wall.start[0] - wall.end[0], y: wall.start[1] - wall.end[1] }

    const L = Math.sqrt(v.x * v.x + v.y * v.y)
    if (L < 1e-9) continue

    const vNorm = { x: v.x / L, y: v.y / L }
    const normal = { x: -vNorm.y, y: vNorm.x }

    // Edge points
    const leftPt = { x: point.x + normal.x * halfT, y: point.y + normal.y * halfT }
    const rightPt = { x: point.x - normal.x * halfT, y: point.y - normal.y * halfT }

    // Edge lines
    const edgeLeft = createLineFromPointAndVector(leftPt, v)
    const edgeRight = createLineFromPointAndVector(rightPt, v)

    // Determine which host edge to intersect with
    // Use incoming direction (opposite of outgoing) dotted with host normal
    const incomingDir = { x: -vNorm.x, y: -vNorm.y }
    const approachDot = dot(incomingDir, hostNormal)

    // Pick host edge facing the incoming wall
    const targetHostEdge = approachDot > 0 ? hostEdgeRight : hostEdgeLeft

    // Both edges meet the same host edge
    const leftInt = intersectLines(edgeLeft, targetHostEdge)
    const rightInt = intersectLines(edgeRight, targetHostEdge)

    result.set(wall.id, {
      left: leftInt ?? leftPt,
      right: rightInt ?? rightPt,
      center: point,
    })
  }

  return result
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Calculates miter data for all walls on a level
 */
export function calculateLevelMiters(walls: WallNode[]): WallMiterMap {
  const miterMap: WallMiterMap = new Map()
  const getThickness = (wall: WallNode) => wall.thickness ?? 0.1

  // Process regular junctions (2+ walls meeting at endpoints)
  const junctions = findJunctions(walls)
  for (const [, junction] of junctions) {
    const miters = calculateJunctionMiters(junction, getThickness)

    for (const { wall, endType } of junction.walls) {
      const miterData = miters.get(wall.id)
      if (!miterData) continue

      if (!miterMap.has(wall.id)) {
        miterMap.set(wall.id, {})
      }
      miterMap.get(wall.id)![endType] = miterData
    }
  }

  // Process T-junctions (wall endpoint on another wall's side)
  const tJunctions = findTJunctions(walls)
  for (const [, { junction, hostWall }] of tJunctions) {
    const miters = calculateTJunctionMiters(junction, hostWall, getThickness)

    for (const { wall, endType } of junction.walls) {
      const miterData = miters.get(wall.id)
      if (!miterData) continue

      // Don't overwrite existing miter data
      if (miterMap.get(wall.id)?.[endType]) continue

      if (!miterMap.has(wall.id)) {
        miterMap.set(wall.id, {})
      }
      miterMap.get(wall.id)![endType] = miterData
    }
  }

  return miterMap
}

/**
 * Gets wall IDs that share junctions with the given walls
 */
export function getAdjacentWallIds(allWalls: WallNode[], dirtyWallIds: Set<string>): Set<string> {
  const adjacent = new Set<string>()

  for (const dirtyId of dirtyWallIds) {
    const dirtyWall = allWalls.find((w) => w.id === dirtyId)
    if (!dirtyWall) continue

    const dirtyStart: Point2D = { x: dirtyWall.start[0], y: dirtyWall.start[1] }
    const dirtyEnd: Point2D = { x: dirtyWall.end[0], y: dirtyWall.end[1] }

    for (const wall of allWalls) {
      if (wall.id === dirtyId) continue

      const wallStart: Point2D = { x: wall.start[0], y: wall.start[1] }
      const wallEnd: Point2D = { x: wall.end[0], y: wall.end[1] }

      // Check corner connections
      const startKey = pointToKey(wallStart)
      const endKey = pointToKey(wallEnd)
      const dirtyStartKey = pointToKey(dirtyStart)
      const dirtyEndKey = pointToKey(dirtyEnd)

      if (
        startKey === dirtyStartKey ||
        startKey === dirtyEndKey ||
        endKey === dirtyStartKey ||
        endKey === dirtyEndKey
      ) {
        adjacent.add(wall.id)
        continue
      }

      // Check T-junction connections
      if (
        pointOnWallSegment(dirtyStart, wallStart, wallEnd) ||
        pointOnWallSegment(dirtyEnd, wallStart, wallEnd) ||
        pointOnWallSegment(wallStart, dirtyStart, dirtyEnd) ||
        pointOnWallSegment(wallEnd, dirtyStart, dirtyEnd)
      ) {
        adjacent.add(wall.id)
      }
    }
  }

  return adjacent
}
