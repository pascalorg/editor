import { getWallFaceOffsets, type WallJustification } from '../../systems/wall/wall-frame'
import type { Point2D } from '../../systems/wall/wall-mitering'

// Baseline rotation (deg) that orients the plan-local scene "north up" on
// screen. The on-screen floor-plan scene `<g>` is rotated by
// `FLOORPLAN_VIEW_ROTATION_DEG + userRotation - buildingRotation`; PDF export
// uses the same user rotation so its orientation matches the live plan.
//
// North is world −Z: with a 0 baseline a rotation-0 reference image (top =
// −Z) reads upright in the north-aligned view, and "align north" maps to a
// 3D camera azimuth of 0. The old 90° baseline made north world −X, so
// north-up floorplan scans displayed sideways whenever the compass claimed
// the view was aligned.
export const FLOORPLAN_VIEW_ROTATION_DEG = 0

export function clampPlanValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function rotatePlanVector(x: number, y: number, rotation: number): [number, number] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [x * cos + y * sin, -x * sin + y * cos]
}

// Converts a world X/Z point into the floor-plan-local (building-local)
// frame used by the SVG scene `<g>` and every stored node position. The
// inverse of `floorplanLocalToWorldPoint`. Shared so the floor-plan panel
// and the 2D move overlay resolve the same frame — feeding a world-space
// `original` into a local-space cursor solver lands the drop off by the
// building's world X/Z (worse for an off-origin building).
export function worldToFloorplanLocalPoint(
  worldX: number,
  worldZ: number,
  buildingPosition: readonly [number, number, number],
  buildingRotationY: number,
): Point2D {
  const dx = worldX - buildingPosition[0]
  const dz = worldZ - buildingPosition[2]
  const cos = Math.cos(buildingRotationY)
  const sin = Math.sin(buildingRotationY)

  return {
    x: dx * cos - dz * sin,
    y: dx * sin + dz * cos,
  }
}

// Inverse of `worldToFloorplanLocalPoint`: floor-plan-local X/Y → world X/Z.
export function floorplanLocalToWorldPoint(
  point: Point2D | [number, number],
  buildingPosition: readonly [number, number, number],
  buildingRotationY: number,
): { x: number; z: number } {
  const localX = Array.isArray(point) ? point[0] : point.x
  const localY = Array.isArray(point) ? point[1] : point.y
  const cos = Math.cos(buildingRotationY)
  const sin = Math.sin(buildingRotationY)

  return {
    x: buildingPosition[0] + localX * cos + localY * sin,
    z: buildingPosition[2] - localX * sin + localY * cos,
  }
}

export function interpolatePlanPoint(start: Point2D, end: Point2D, t: number): Point2D {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
}

export function getPlanPointDistance(start: Point2D, end: Point2D): number {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

export function movePlanPointTowards(start: Point2D, end: Point2D, distance: number): Point2D {
  const totalDistance = getPlanPointDistance(start, end)
  if (totalDistance <= Number.EPSILON || distance <= 0) {
    return start
  }

  return interpolatePlanPoint(start, end, Math.min(1, distance / totalDistance))
}

export function getThickPlanLinePolygon(
  line: { start: Point2D; end: Point2D },
  thickness: number,
  justification?: WallJustification,
): Point2D[] {
  const dx = line.end.x - line.start.x
  const dy = line.end.y - line.start.y
  const length = Math.hypot(dx, dy)

  if (length <= Number.EPSILON || thickness <= 0) {
    return [line.start, line.end, line.end, line.start]
  }

  const { a, b } = getWallFaceOffsets({ thickness, justification })
  const normalX = (-dy / length) * a
  const normalY = (dx / length) * a

  const backX = (-dy / length) * -b
  const backY = (dx / length) * -b
  return [
    { x: line.start.x + normalX, y: line.start.y + normalY },
    { x: line.end.x + normalX, y: line.end.y + normalY },
    { x: line.end.x - backX, y: line.end.y - backY },
    { x: line.start.x - backX, y: line.start.y - backY },
  ]
}
