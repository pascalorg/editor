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

function getOutgoingVector(wall: WallNode, endType: 'start' | 'end'): Point2D {
  if (endType === 'start') {
    return { x: wall.end[0] - wall.start[0], y: wall.end[1] - wall.start[1] }
  }
  return { x: wall.start[0] - wall.end[0], y: wall.start[1] - wall.end[1] }
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

function normalize(v: Point2D): Point2D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y)
  if (len < 1e-9) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y
}

/**
 * Check if a point lies on a wall segment (excluding endpoints)
 */
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

  // Project point onto wall line
  const t = dot(toPoint, wallVec) / (wallLen * wallLen)

  // Check if within segment (with margin to exclude endpoints)
  if (t <= tolerance / wallLen || t >= 1 - tolerance / wallLen) return false

  // Check perpendicular distance
  const projX = wallStart.x + t * wallVec.x
  const projY = wallStart.y + t * wallVec.y
  const dist = Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2)

  return dist < tolerance
}

// ============================================================================
// JUNCTION DETECTION
// ============================================================================

interface JunctionResult {
  junctions: Map<string, Junction>
  throughWalls: Map<string, WallNode> // junctionKey -> host wall that the junction lies on
}

/**
 * Finds all junctions (where wall endpoints meet, including T-junctions on wall segments)
 */
function findCornerJunctions(walls: WallNode[]): JunctionResult {
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

  // For each junction point, check if it lies on any wall's segment (T-junction)
  // Store this info separately - the host wall should NOT be modified
  const throughWallsAtJunction = new Map<string, WallNode>() // junctionKey -> host wall

  for (const [key, junction] of junctionMap) {
    const wallIdsInJunction = new Set(junction.walls.map((w) => w.wall.id))

    for (const wall of walls) {
      if (wallIdsInJunction.has(wall.id)) continue

      const wallStart: Point2D = { x: wall.start[0], y: wall.start[1] }
      const wallEnd: Point2D = { x: wall.end[0], y: wall.end[1] }

      // Check if junction point lies on this wall's segment
      if (pointOnWallSegment(junction.point, wallStart, wallEnd)) {
        // Store the through wall separately - don't add to junction.walls
        // The host wall should NOT get miter data
        throughWallsAtJunction.set(key, wall)
        break // Only need one through wall per junction
      }
    }
  }

  // Only keep junctions with 2+ walls
  const actualJunctions = new Map<string, Junction>()
  for (const [key, junction] of junctionMap) {
    if (junction.walls.length >= 2) {
      actualJunctions.set(key, junction)
    }
  }

  return { junctions: actualJunctions, throughWalls: throughWallsAtJunction }
}

/**
 * Finds T-junctions where a wall endpoint meets another wall's side
 */
function findTJunctions(walls: WallNode[]): Map<string, Junction> {
  const tJunctions = new Map<string, Junction>()

  for (const wall of walls) {
    const endpoints: { pt: Point2D; endType: 'start' | 'end' }[] = [
      { pt: { x: wall.start[0], y: wall.start[1] }, endType: 'start' },
      { pt: { x: wall.end[0], y: wall.end[1] }, endType: 'end' },
    ]

    for (const { pt, endType } of endpoints) {
      const key = pointToKey(pt)

      // Skip if this is already a corner junction
      // (will be handled by findCornerJunctions)

      for (const otherWall of walls) {
        if (otherWall.id === wall.id) continue

        const otherStart: Point2D = { x: otherWall.start[0], y: otherWall.start[1] }
        const otherEnd: Point2D = { x: otherWall.end[0], y: otherWall.end[1] }

        // Check if endpoint touches the other wall's endpoints
        const touchesStart = pointToKey(pt) === pointToKey(otherStart)
        const touchesEnd = pointToKey(pt) === pointToKey(otherEnd)
        if (touchesStart || touchesEnd) continue

        // Check if endpoint lies on the other wall's segment
        if (pointOnWallSegment(pt, otherStart, otherEnd)) {
          if (!tJunctions.has(key)) {
            tJunctions.set(key, { point: pt, walls: [] })
          }
          const junction = tJunctions.get(key)!

          // Add the incoming wall if not already present
          if (!junction.walls.some((w) => w.wall.id === wall.id && w.endType === endType)) {
            junction.walls.push({ wall, endType })
          }

          // Add the host wall as a "through" wall (we'll handle it specially)
          // Use 'start' as a convention for through walls
          if (!junction.walls.some((w) => w.wall.id === otherWall.id)) {
            junction.walls.push({ wall: otherWall, endType: 'start' })
          }
        }
      }
    }
  }

  return tJunctions
}

// ============================================================================
// MITER CALCULATION
// ============================================================================

/**
 * Calculates mitered corners for a junction (including T-junctions with through walls)
 * @param throughWall - Optional wall that the junction lies on (for T-junctions)
 */
function calculateCornerMiters(
  junction: Junction,
  getThickness: (wall: WallNode) => number,
  throughWall?: WallNode,
): Map<string, MiterData> {
  const { point, walls } = junction
  const result = new Map<string, MiterData>()

  // If there's a through wall, handle as combined corner + T-junction
  // The through wall is NOT modified - only incoming walls get miter data
  if (throughWall) {
    const hostHalfT = getThickness(throughWall) / 2
    const hostDir = normalize({
      x: throughWall.end[0] - throughWall.start[0],
      y: throughWall.end[1] - throughWall.start[1],
    })
    const hostNormal = { x: -hostDir.y, y: hostDir.x }

    // Host wall edge points at junction
    const hostLeft = { x: point.x + hostNormal.x * hostHalfT, y: point.y + hostNormal.y * hostHalfT }
    const hostRight = { x: point.x - hostNormal.x * hostHalfT, y: point.y - hostNormal.y * hostHalfT }
    const hostEdgeLeft = createLineFromPointAndVector(hostLeft, hostDir)
    const hostEdgeRight = createLineFromPointAndVector(hostRight, hostDir)

    // Build processed list for incoming walls
    const incomingProcessed: {
      wallId: string
      angle: number
      edgeLeft: LineEquation
      edgeRight: LineEquation
      defaultLeft: Point2D
      defaultRight: Point2D
      approachDot: number
    }[] = []

    for (const { wall, endType } of walls) {
      const halfT = getThickness(wall) / 2
      const v = getOutgoingVector(wall, endType)
      const vNorm = normalize(v)

      if (Math.abs(vNorm.x) < 1e-9 && Math.abs(vNorm.y) < 1e-9) continue

      const normal = { x: -vNorm.y, y: vNorm.x }
      const leftPt = { x: point.x + normal.x * halfT, y: point.y + normal.y * halfT }
      const rightPt = { x: point.x - normal.x * halfT, y: point.y - normal.y * halfT }

      const incomingDir = { x: -vNorm.x, y: -vNorm.y }
      const approachDot = dot(incomingDir, hostNormal)

      incomingProcessed.push({
        wallId: wall.id,
        angle: Math.atan2(v.y, v.x),
        edgeLeft: createLineFromPointAndVector(leftPt, v),
        edgeRight: createLineFromPointAndVector(rightPt, v),
        defaultLeft: leftPt,
        defaultRight: rightPt,
        approachDot,
      })
    }

    // Sort ALL walls by angle for proper adjacency
    incomingProcessed.sort((a, b) => a.angle - b.angle)

    // Initialize all walls with default values
    for (const w of incomingProcessed) {
      result.set(w.wallId, { left: w.defaultLeft, right: w.defaultRight })
    }

    const n = incomingProcessed.length

    // Process consecutive pairs of walls
    for (let i = 0; i < n; i++) {
      const curr = incomingProcessed[i]!
      const next = incomingProcessed[(i + 1) % n]!

      const currFromLeft = curr.approachDot > 0
      const nextFromLeft = next.approachDot > 0

      if (currFromLeft === nextFromLeft) {
        // Same side: miter their adjacent edges together
        const cornerInt = intersectLines(curr.edgeRight, next.edgeLeft)
        if (cornerInt) {
          result.get(curr.wallId)!.right = cornerInt
          result.get(next.wallId)!.left = cornerInt
        }
      } else {
        // Different sides: their inner edges meet at intersection (inside the host wall)
        const cornerInt = intersectLines(curr.edgeRight, next.edgeLeft)
        if (cornerInt) {
          result.get(curr.wallId)!.right = cornerInt
          result.get(next.wallId)!.left = cornerInt
        }
      }
    }

    // Now set the outer edges to meet the host wall surface
    // For each wall, find which edge is "outermost" (not adjacent to a same-side wall)
    for (let i = 0; i < n; i++) {
      const curr = incomingProcessed[i]!
      const prev = incomingProcessed[(i - 1 + n) % n]!
      const next = incomingProcessed[(i + 1) % n]!

      const currFromLeft = curr.approachDot > 0
      const prevFromLeft = prev.approachDot > 0
      const nextFromLeft = next.approachDot > 0

      // Target host edge based on which side this wall approaches from
      const targetHostEdge = currFromLeft ? hostEdgeRight : hostEdgeLeft

      // Left edge is outer if prev wall is on different side (or if only one wall)
      if (n === 1 || prevFromLeft !== currFromLeft) {
        const leftInt = intersectLines(curr.edgeLeft, targetHostEdge)
        if (leftInt) result.get(curr.wallId)!.left = leftInt
      }

      // Right edge is outer if next wall is on different side (or if only one wall)
      if (n === 1 || nextFromLeft !== currFromLeft) {
        const rightInt = intersectLines(curr.edgeRight, targetHostEdge)
        if (rightInt) result.get(curr.wallId)!.right = rightInt
      }
    }

    return result
  }

  // Standard corner junction processing (no through wall)
  const processed: {
    wallId: string
    angle: number
    edgeLeft: LineEquation
    edgeRight: LineEquation
    defaultLeft: Point2D
    defaultRight: Point2D
  }[] = []

  for (const { wall, endType } of walls) {
    const halfT = getThickness(wall) / 2
    const v = getOutgoingVector(wall, endType)
    const vNorm = normalize(v)

    if (Math.abs(vNorm.x) < 1e-9 && Math.abs(vNorm.y) < 1e-9) continue

    const normal = { x: -vNorm.y, y: vNorm.x }
    const leftPt = { x: point.x + normal.x * halfT, y: point.y + normal.y * halfT }
    const rightPt = { x: point.x - normal.x * halfT, y: point.y - normal.y * halfT }

    processed.push({
      wallId: wall.id,
      angle: Math.atan2(v.y, v.x),
      edgeLeft: createLineFromPointAndVector(leftPt, v),
      edgeRight: createLineFromPointAndVector(rightPt, v),
      defaultLeft: leftPt,
      defaultRight: rightPt,
    })
  }

  // Sort by angle for proper adjacency
  processed.sort((a, b) => a.angle - b.angle)

  const n = processed.length
  if (n < 2) return result

  // Initialize with defaults
  for (const p of processed) {
    result.set(p.wallId, { left: p.defaultLeft, right: p.defaultRight })
  }

  // Calculate intersections between adjacent walls
  for (let i = 0; i < n; i++) {
    const curr = processed[i]!
    const next = processed[(i + 1) % n]!

    const intersection = intersectLines(curr.edgeLeft, next.edgeRight)

    if (intersection) {
      result.get(curr.wallId)!.left = intersection
      result.get(next.wallId)!.right = intersection
    }
  }

  return result
}

/**
 * Calculates miter for a T-junction (wall endpoint meeting another wall's side)
 */
function calculateTJunctionMiters(
  junction: Junction,
  getThickness: (wall: WallNode) => number,
): Map<string, MiterData> {
  const { point, walls } = junction
  const result = new Map<string, MiterData>()

  // Separate incoming walls (those with endpoint at junction) from host wall
  const incomingWalls: WallEndpoint[] = []
  let hostWall: WallNode | null = null

  for (const { wall, endType } of walls) {
    const wallStart: Point2D = { x: wall.start[0], y: wall.start[1] }
    const wallEnd: Point2D = { x: wall.end[0], y: wall.end[1] }

    const startKey = pointToKey(wallStart)
    const endKey = pointToKey(wallEnd)
    const junctionKey = pointToKey(point)

    if (startKey === junctionKey || endKey === junctionKey) {
      incomingWalls.push({ wall, endType })
    } else {
      hostWall = wall
    }
  }

  if (!hostWall || incomingWalls.length === 0) return result

  // If there are multiple incoming walls, use corner miter logic with throughWall
  // This handles cases where walls meet at a T-junction point but weren't grouped as a corner junction
  if (incomingWalls.length >= 2) {
    const cornerJunction: Junction = { point, walls: incomingWalls }
    return calculateCornerMiters(cornerJunction, getThickness, hostWall)
  }

  // Single incoming wall: handle as simple T-junction
  // Get host wall direction and normal
  const hostDir = normalize({
    x: hostWall.end[0] - hostWall.start[0],
    y: hostWall.end[1] - hostWall.start[1],
  })
  const hostNormal = { x: -hostDir.y, y: hostDir.x }
  const hostHalfT = getThickness(hostWall) / 2

  // Host wall edge points at junction
  const hostLeft = { x: point.x + hostNormal.x * hostHalfT, y: point.y + hostNormal.y * hostHalfT }
  const hostRight = {
    x: point.x - hostNormal.x * hostHalfT,
    y: point.y - hostNormal.y * hostHalfT,
  }

  // For each incoming wall, extend to meet the host wall's edges
  for (const { wall, endType } of incomingWalls) {
    const halfT = getThickness(wall) / 2
    const v = getOutgoingVector(wall, endType)
    const vNorm = normalize(v)

    if (Math.abs(vNorm.x) < 1e-9 && Math.abs(vNorm.y) < 1e-9) continue

    const normal = { x: -vNorm.y, y: vNorm.x }

    // Default corner points
    const leftPt = { x: point.x + normal.x * halfT, y: point.y + normal.y * halfT }
    const rightPt = { x: point.x - normal.x * halfT, y: point.y - normal.y * halfT }

    // Create edge lines for incoming wall
    const edgeLeft = createLineFromPointAndVector(leftPt, v)
    const edgeRight = createLineFromPointAndVector(rightPt, v)

    // Determine which side of the host wall the incoming wall approaches from
    // Use the OPPOSITE of outgoing direction (incoming direction) dotted with host normal
    const incomingDir = { x: -vNorm.x, y: -vNorm.y }
    const approachDot = dot(incomingDir, hostNormal)

    // Pick the host edge facing the incoming wall
    // If dot > 0, wall approaches from the opposite side of hostNormal, use hostRight (near surface)
    // If dot < 0, wall approaches from the hostNormal side, use hostLeft (near surface)
    const targetHostEdge =
      approachDot > 0
        ? createLineFromPointAndVector(hostRight, hostDir)
        : createLineFromPointAndVector(hostLeft, hostDir)

    // Both edges of incoming wall meet the same host edge
    const leftIntersection = intersectLines(edgeLeft, targetHostEdge)
    const rightIntersection = intersectLines(edgeRight, targetHostEdge)

    result.set(wall.id, {
      left: leftIntersection || leftPt,
      right: rightIntersection || rightPt,
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

  // Process corner junctions
  const { junctions: cornerJunctions, throughWalls } = findCornerJunctions(walls)
  for (const [key, junction] of cornerJunctions) {
    // Pass the through wall (if any) for T-junction handling
    const throughWall = throughWalls.get(key)
    const miters = calculateCornerMiters(junction, getThickness, throughWall)

    for (const { wall, endType } of junction.walls) {
      const miterData = miters.get(wall.id)
      if (!miterData) continue

      if (!miterMap.has(wall.id)) {
        miterMap.set(wall.id, {})
      }
      miterMap.get(wall.id)![endType] = miterData
    }
  }

  // Process T-junctions
  const tJunctions = findTJunctions(walls)
  for (const [, junction] of tJunctions) {
    const miters = calculateTJunctionMiters(junction, getThickness)

    for (const { wall, endType } of junction.walls) {
      const miterData = miters.get(wall.id)
      if (!miterData) continue

      // Don't overwrite corner junction miters
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
