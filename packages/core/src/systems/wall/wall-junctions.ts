import type { WallNode } from '../../schema'
import { getWallArcData, isCurvedWall, projectPointToWallCenterline } from './wall-curve'
import type { Point2D } from './wall-mitering'

const TOLERANCE = 0.001
const JUNCTION_GRID_CELL = 2.0
const JUNCTION_GRID_MAX_CELLS_PER_WALL = 64

export interface WallJunction {
  meetingPoint: Point2D
  connectedWalls: Array<{ wall: WallNode; endType: 'start' | 'end' | 'passthrough' }>
}

export function pointToKey(p: Point2D, tolerance = TOLERANCE): string {
  const snap = 1 / tolerance
  return `${Math.round(p.x * snap)},${Math.round(p.y * snap)}`
}

export function pointOnWallSegment(point: Point2D, wall: WallNode, tolerance = TOLERANCE): boolean {
  const start: Point2D = { x: wall.start[0], y: wall.start[1] }
  const end: Point2D = { x: wall.end[0], y: wall.end[1] }
  if (pointToKey(point, tolerance) === pointToKey(start, tolerance)) return false
  if (pointToKey(point, tolerance) === pointToKey(end, tolerance)) return false

  if (isCurvedWall(wall)) {
    const projection = projectPointToWallCenterline(wall, point)
    return Boolean(
      projection &&
        projection.t > tolerance &&
        projection.t < 1 - tolerance &&
        (point.x - projection.point.x) ** 2 + (point.y - projection.point.y) ** 2 <=
          tolerance * tolerance,
    )
  }

  const v = { x: end.x - start.x, y: end.y - start.y }
  const length = Math.hypot(v.x, v.y)
  if (length < 1e-9) return false
  const w = { x: point.x - start.x, y: point.y - start.y }
  const t = (v.x * w.x + v.y * w.y) / (length * length)
  if (t < tolerance || t > 1 - tolerance) return false
  const projected = { x: start.x + t * v.x, y: start.y + t * v.y }
  return Math.hypot(point.x - projected.x, point.y - projected.y) < tolerance
}

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / JUNCTION_GRID_CELL)},${Math.floor(y / JUNCTION_GRID_CELL)}`
}

function angleOnArc(angle: number, startAngle: number, delta: number) {
  let directed = (angle - startAngle) * Math.sign(delta)
  while (directed < 0) directed += Math.PI * 2
  return directed <= Math.abs(delta) + 1e-9
}

function wallBounds(wall: WallNode) {
  const points = [
    { x: wall.start[0], y: wall.start[1] },
    { x: wall.end[0], y: wall.end[1] },
  ]
  const arc = getWallArcData(wall)
  if (arc) {
    for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
      if (angleOnArc(angle, arc.startAngle, arc.delta)) {
        points.push({
          x: arc.center.x + arc.radius * Math.cos(angle),
          y: arc.center.y + arc.radius * Math.sin(angle),
        })
      }
    }
  }
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

function buildJunctionGrid(walls: WallNode[]) {
  const grid = new Map<string, WallNode[]>()
  const oversized: WallNode[] = []
  for (const wall of walls) {
    const bounds = wallBounds(wall)
    const minX = bounds.minX - TOLERANCE
    const maxX = bounds.maxX + TOLERANCE
    const minY = bounds.minY - TOLERANCE
    const maxY = bounds.maxY + TOLERANCE
    const cx0 = Math.floor(minX / JUNCTION_GRID_CELL)
    const cx1 = Math.floor(maxX / JUNCTION_GRID_CELL)
    const cy0 = Math.floor(minY / JUNCTION_GRID_CELL)
    const cy1 = Math.floor(maxY / JUNCTION_GRID_CELL)
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > JUNCTION_GRID_MAX_CELLS_PER_WALL) {
      oversized.push(wall)
      continue
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`
        const bucket = grid.get(key)
        if (bucket) bucket.push(wall)
        else grid.set(key, [wall])
      }
    }
  }
  return { grid, oversized }
}

export function findWallJunctions(walls: WallNode[]): Map<string, WallJunction> {
  const junctions = new Map<string, WallJunction>()
  for (const wall of walls) {
    const startPt: Point2D = { x: wall.start[0], y: wall.start[1] }
    const endPt: Point2D = { x: wall.end[0], y: wall.end[1] }
    const startKey = pointToKey(startPt)
    const endKey = pointToKey(endPt)
    if (!junctions.has(startKey))
      junctions.set(startKey, { meetingPoint: startPt, connectedWalls: [] })
    junctions.get(startKey)?.connectedWalls.push({ wall, endType: 'start' })
    if (!junctions.has(endKey)) junctions.set(endKey, { meetingPoint: endPt, connectedWalls: [] })
    junctions.get(endKey)?.connectedWalls.push({ wall, endType: 'end' })
  }

  const { grid, oversized } = buildJunctionGrid(walls)
  const wallOrder = new Map(walls.map((wall, index) => [wall.id, index]))
  for (const junction of junctions.values()) {
    const candidates = grid.get(cellKey(junction.meetingPoint.x, junction.meetingPoint.y))
    const passthrough: WallNode[] = []
    for (const bucket of [candidates, oversized]) {
      if (!bucket) continue
      for (const wall of bucket) {
        if (junction.connectedWalls.some((entry) => entry.wall.id === wall.id)) continue
        if (pointOnWallSegment(junction.meetingPoint, wall)) passthrough.push(wall)
      }
    }
    passthrough.sort((a, b) => (wallOrder.get(a.id) ?? 0) - (wallOrder.get(b.id) ?? 0))
    for (const wall of passthrough) {
      junction.connectedWalls.push({ wall, endType: 'passthrough' })
    }
  }

  return new Map([...junctions].filter(([, junction]) => junction.connectedWalls.length >= 2))
}
