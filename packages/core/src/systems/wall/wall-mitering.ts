import type { WallNode } from '../../schema'
import { getWallCurveFrameAt, isCurvedWall, projectPointToWallCenterline } from './wall-curve'
import {
  findWallJunctions,
  pointOnWallSegment,
  pointToKey,
  type WallJunction,
} from './wall-junctions'

// ============================================================================
// TYPES
// ============================================================================

export interface Point2D {
  x: number
  y: number
}

export interface WallMiterBoundaryPoints {
  startLeft: Point2D
  startRight: Point2D
  endLeft: Point2D
  endRight: Point2D
}

interface LineEquation {
  a: number
  b: number
  c: number // ax + by + c = 0
}

// Map of wallId -> { left?: Point2D, right?: Point2D } for each junction
type WallIntersections = Map<string, { left?: Point2D; right?: Point2D }>

// Map of junctionKey -> WallIntersections
type JunctionData = Map<string, WallIntersections>

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Miter joints are line-line intersections, so the joint point sits a distance
// ≈ halfThickness / sin(θ) from the junction, where θ is the angle between the
// two walls. As θ → 0 (two walls nearly collinear — e.g. a room-preset preview
// dragged on top of an existing wall, or a freshly-drawn wall almost parallel
// to its neighbour) that distance runs away to infinity and the wall renders as
// an infinite spike. Cap the joint at this multiple of the wall half-thickness;
// beyond it we fall back to a square (butt) joint, exactly like the existing
// parallel-walls guard. 10× preserves every realistic corner (a 0.1 m wall keeps
// mitering down to ~11°) while bounding the pathological near-collinear case.
const MITER_LIMIT = 10

function createLineFromPointAndVector(p: Point2D, v: Point2D): LineEquation {
  const a = -v.y
  const b = v.x
  const c = -(a * p.x + b * p.y)
  return { a, b, c }
}

type Junction = WallJunction

function getWallDirectionFromJunction(
  wall: WallNode,
  endType: 'start' | 'end' | 'passthrough',
  meetingPoint?: Point2D,
) {
  if (endType === 'passthrough') {
    if (isCurvedWall(wall) && meetingPoint) {
      const projection = projectPointToWallCenterline(wall, meetingPoint)
      if (projection) return projection.frame.tangent
    }
    return {
      x: wall.end[0] - wall.start[0],
      y: wall.end[1] - wall.start[1],
    }
  }

  if (isCurvedWall(wall)) {
    const frame = getWallCurveFrameAt(wall, endType === 'start' ? 0 : 1)
    return endType === 'start' ? frame.tangent : { x: -frame.tangent.x, y: -frame.tangent.y }
  }

  return endType === 'start'
    ? { x: wall.end[0] - wall.start[0], y: wall.end[1] - wall.start[1] }
    : { x: wall.start[0] - wall.end[0], y: wall.start[1] - wall.end[1] }
}

function getWallBoundaryFrame(wall: WallNode, endType: 'start' | 'end') {
  if (isCurvedWall(wall)) {
    const frame = getWallCurveFrameAt(wall, endType === 'start' ? 0 : 1)
    return {
      point: frame.point,
      tangent: endType === 'start' ? frame.tangent : { x: -frame.tangent.x, y: -frame.tangent.y },
      normal: frame.normal,
    }
  }

  const point =
    endType === 'start'
      ? { x: wall.start[0], y: wall.start[1] }
      : { x: wall.end[0], y: wall.end[1] }
  const direction = { x: wall.end[0] - wall.start[0], y: wall.end[1] - wall.start[1] }
  const length = Math.hypot(direction.x, direction.y)

  if (length < 1e-9) {
    return {
      point,
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
    }
  }

  return {
    point,
    tangent:
      endType === 'start'
        ? { x: direction.x / length, y: direction.y / length }
        : { x: -direction.x / length, y: -direction.y / length },
    normal: { x: -direction.y / length, y: direction.x / length },
  }
}

// ============================================================================
// MITER CALCULATION (exactly like demo)
// ============================================================================

interface ProcessedWall {
  wallId: string
  angle: number
  edgeA: LineEquation // Left edge
  edgeB: LineEquation // Right edge
  isPassthrough: boolean // True if wall passes through junction (T-junction)
  halfThickness: number // Used to bound the miter joint against runaway spikes
}

function calculateJunctionIntersections(
  junction: Junction,
  getThickness: (wall: WallNode) => number,
): WallIntersections {
  const { meetingPoint, connectedWalls } = junction
  const processedWalls: ProcessedWall[] = []

  for (const { wall, endType } of connectedWalls) {
    const halfT = getThickness(wall) / 2

    if (endType === 'passthrough') {
      // For passthrough walls (T-junctions), add both directions
      // This allows walls meeting the middle of this wall to miter against it
      const tangent = getWallDirectionFromJunction(wall, endType, meetingPoint)
      const v1 = tangent
      const v2 = { x: -v1.x, y: -v1.y }

      for (const v of [v1, v2]) {
        const L = Math.sqrt(v.x * v.x + v.y * v.y)
        if (L < 1e-9) continue

        const nUnit = { x: -v.y / L, y: v.x / L }
        const pA = { x: meetingPoint.x + nUnit.x * halfT, y: meetingPoint.y + nUnit.y * halfT }
        const pB = { x: meetingPoint.x - nUnit.x * halfT, y: meetingPoint.y - nUnit.y * halfT }

        const edgeA = createLineFromPointAndVector(pA, v)
        const edgeB = createLineFromPointAndVector(pB, v)
        const angle = Math.atan2(v.y, v.x)

        processedWalls.push({
          wallId: wall.id,
          angle,
          edgeA,
          edgeB,
          isPassthrough: true,
          halfThickness: halfT,
        })
      }
    } else {
      // Normal wall endpoint (start or end)
      const v = getWallDirectionFromJunction(wall, endType)

      const L = Math.sqrt(v.x * v.x + v.y * v.y)
      if (L < 1e-9) continue

      const nUnit = { x: -v.y / L, y: v.x / L }
      const pA = { x: meetingPoint.x + nUnit.x * halfT, y: meetingPoint.y + nUnit.y * halfT }
      const pB = { x: meetingPoint.x - nUnit.x * halfT, y: meetingPoint.y - nUnit.y * halfT }

      const edgeA = createLineFromPointAndVector(pA, v)
      const edgeB = createLineFromPointAndVector(pB, v)
      const angle = Math.atan2(v.y, v.x)

      processedWalls.push({
        wallId: wall.id,
        angle,
        edgeA,
        edgeB,
        isPassthrough: false,
        halfThickness: halfT,
      })
    }
  }

  // Sort by outgoing angle, then by wall ID so equal-angle walls produce the
  // same pairing regardless of scene iteration order.
  processedWalls.sort((a, b) => {
    const angleOrder = a.angle - b.angle
    if (angleOrder !== 0) return angleOrder
    return a.wallId < b.wallId ? -1 : a.wallId > b.wallId ? 1 : 0
  })

  const wallIntersections = new Map<string, { left?: Point2D; right?: Point2D }>()
  const n = processedWalls.length

  if (n < 2) return wallIntersections

  // Calculate intersections between adjacent walls (exactly like demo)
  for (let i = 0; i < n; i++) {
    const wall1 = processedWalls[i]!
    const wall2 = processedWalls[(i + 1) % n]!

    // Intersect left edge of wall1 with right edge of wall2
    const det = wall1.edgeA.a * wall2.edgeB.b - wall2.edgeB.a * wall1.edgeA.b

    // If lines are parallel (det ≈ 0), skip this intersection - walls will use defaults
    if (Math.abs(det) < 1e-9) {
      continue
    }

    const p = {
      x: (wall1.edgeA.b * wall2.edgeB.c - wall2.edgeB.b * wall1.edgeA.c) / det,
      y: (wall2.edgeB.a * wall1.edgeA.c - wall1.edgeA.a * wall2.edgeB.c) / det,
    }

    // Miter limit: `det` only catches walls that are *exactly* parallel. Two
    // walls meeting at a shallow angle have a small-but-nonzero `det`, so `p`
    // lands far from the junction (∝ 1/sin θ) and the wall renders as an
    // infinite spike. Reject any joint farther than MITER_LIMIT half-thicknesses
    // from the meeting point — those walls fall back to a square joint.
    const maxMiter = MITER_LIMIT * Math.max(wall1.halfThickness, wall2.halfThickness)
    const dx = p.x - meetingPoint.x
    const dy = p.y - meetingPoint.y
    if (
      !(Number.isFinite(p.x) && Number.isFinite(p.y)) ||
      dx * dx + dy * dy > maxMiter * maxMiter
    ) {
      continue
    }

    // Only assign intersection to non-passthrough walls
    // Passthrough walls don't receive junction data (their geometry doesn't change)
    if (!wall1.isPassthrough) {
      if (!wallIntersections.has(wall1.wallId)) {
        wallIntersections.set(wall1.wallId, {})
      }
      wallIntersections.get(wall1.wallId)!.left = p
    }

    if (!wall2.isPassthrough) {
      if (!wallIntersections.has(wall2.wallId)) {
        wallIntersections.set(wall2.wallId, {})
      }
      wallIntersections.get(wall2.wallId)!.right = p
    }
  }

  return wallIntersections
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export interface WallMiterData {
  // Junction data keyed by junction position key
  junctionData: JunctionData
  // All junctions for quick lookup
  junctions: Map<string, Junction>
}

/**
 * Calculates miter data for all walls on a level
 */
export function calculateLevelMiters(walls: WallNode[]): WallMiterData {
  const getThickness = (wall: WallNode) => wall.thickness ?? 0.1
  const junctions = findWallJunctions(walls)
  const junctionData: JunctionData = new Map()

  for (const [key, junction] of junctions.entries()) {
    const wallIntersections = calculateJunctionIntersections(junction, getThickness)
    junctionData.set(key, wallIntersections)
  }

  return { junctionData, junctions }
}

export function getWallMiterBoundaryPoints(
  wall: WallNode,
  miterData: WallMiterData,
): WallMiterBoundaryPoints | null {
  const thickness = wall.thickness ?? 0.1
  const halfThickness = thickness / 2
  const startFrame = getWallBoundaryFrame(wall, 'start')
  const endFrame = getWallBoundaryFrame(wall, 'end')
  const startJunction = miterData.junctionData.get(pointToKey(startFrame.point))?.get(wall.id)
  const endJunction = miterData.junctionData.get(pointToKey(endFrame.point))?.get(wall.id)

  return {
    startLeft: startJunction?.left ?? {
      x: startFrame.point.x + startFrame.normal.x * halfThickness,
      y: startFrame.point.y + startFrame.normal.y * halfThickness,
    },
    startRight: startJunction?.right ?? {
      x: startFrame.point.x - startFrame.normal.x * halfThickness,
      y: startFrame.point.y - startFrame.normal.y * halfThickness,
    },
    endLeft: endJunction?.right ?? {
      x: endFrame.point.x + endFrame.normal.x * halfThickness,
      y: endFrame.point.y + endFrame.normal.y * halfThickness,
    },
    endRight: endJunction?.left ?? {
      x: endFrame.point.x - endFrame.normal.x * halfThickness,
      y: endFrame.point.y - endFrame.normal.y * halfThickness,
    },
  }
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

      // Check corner connections (endpoints meeting)
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

      // Check T-junction connections (dirty wall endpoint on other wall's segment)
      if (pointOnWallSegment(dirtyStart, wall) || pointOnWallSegment(dirtyEnd, wall)) {
        adjacent.add(wall.id)
        continue
      }

      // Check reverse T-junction (other wall endpoint on dirty wall's segment)
      if (pointOnWallSegment(wallStart, dirtyWall) || pointOnWallSegment(wallEnd, dirtyWall)) {
        adjacent.add(wall.id)
      }
    }
  }

  return adjacent
}

// Re-export for backwards compatibility
export { pointToKey }
