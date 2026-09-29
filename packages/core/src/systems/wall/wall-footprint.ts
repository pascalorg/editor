import type { WallNode } from '../../schema'
import { getWallSurfacePolygon, isCurvedWall } from './wall-curve'
import { getWallFaceOffsets } from './wall-frame'
import {
  getWallMiterBoundaryPoints,
  type Point2D,
  pointToKey,
  type WallMiterData,
} from './wall-mitering'

export { faceOnLine, justificationForFaceOnLine } from './wall-frame'
export { calculateLevelMiters, type Point2D, type WallMiterData } from './wall-mitering'
export { roomSideFaces } from './wall-room-sides'

export const DEFAULT_WALL_THICKNESS = 0.1
export const DEFAULT_WALL_HEIGHT = 2.5
export const CURVED_WALL_SURFACE_SEGMENTS = 24

export function getWallThickness(wallNode: WallNode): number {
  return wallNode.thickness ?? DEFAULT_WALL_THICKNESS
}

export function getWallPlanFootprint(wallNode: WallNode, miterData: WallMiterData): Point2D[] {
  const { junctionData } = miterData
  const wallStart: Point2D = { x: wallNode.start[0], y: wallNode.start[1] }
  const wallEnd: Point2D = { x: wallNode.end[0], y: wallNode.end[1] }
  const { a, b } = getWallFaceOffsets(wallNode)
  const v = { x: wallEnd.x - wallStart.x, y: wallEnd.y - wallStart.y }
  const L = Math.sqrt(v.x * v.x + v.y * v.y)

  if (L < 1e-9) {
    return []
  }
  const nUnit = { x: -v.y / L, y: v.x / L }
  const keyStart = pointToKey(wallStart)
  const keyEnd = pointToKey(wallEnd)
  const startJunction = junctionData.get(keyStart)?.get(wallNode.id)
  const endJunction = junctionData.get(keyEnd)?.get(wallNode.id)

  if (isCurvedWall(wallNode)) {
    const boundaryPoints = getWallMiterBoundaryPoints(wallNode, miterData)
    if (!boundaryPoints) {
      return []
    }

    const { startLeft, startRight, endLeft, endRight } = boundaryPoints

    return getWallSurfacePolygon(wallNode, CURVED_WALL_SURFACE_SEGMENTS, {
      endLeft,
      endRight,
      startLeft,
      startRight,
    })
  }

  const pStartLeft: Point2D = startJunction?.left || {
    x: wallStart.x + nUnit.x * a,
    y: wallStart.y + nUnit.y * a,
  }
  const pStartRight: Point2D = startJunction?.right || {
    x: wallStart.x - nUnit.x * -b,
    y: wallStart.y - nUnit.y * -b,
  }
  const pEndLeft: Point2D = endJunction?.right || {
    x: wallEnd.x + nUnit.x * a,
    y: wallEnd.y + nUnit.y * a,
  }
  const pEndRight: Point2D = endJunction?.left || {
    x: wallEnd.x - nUnit.x * -b,
    y: wallEnd.y - nUnit.y * -b,
  }

  const polygon: Point2D[] = [pStartRight, pEndRight]
  if (endJunction) {
    polygon.push(endJunction.closing ?? wallEnd)
  }
  polygon.push(pEndLeft, pStartLeft)
  if (startJunction) {
    polygon.push(startJunction.closing ?? wallStart)
  }

  return polygon
}
