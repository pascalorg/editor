/**
 * Pure geometry helpers for floor plan export.
 * No React, no DOM, no side effects — safe to call from a generator or test.
 */

import type { DoorNode, Point2D, WallNode, WindowNode } from '@pascal-app/core'

// ─── Coordinate transform ──────────────────────────────────────────────────

/** Plan [x, z] → SVG x  (negate, matching floorplan-panel convention) */
export function toSvgX(value: number): number {
  return -value
}

/** Plan [x, z] → SVG y */
export function toSvgY(value: number): number {
  return -value
}

/** Convert a plan-space {x, y} Point2D to SVG-space {x, y} */
export function toSvgPoint(p: Point2D): Point2D {
  return { x: toSvgX(p.x), y: toSvgY(p.y) }
}

/** Convert a plan-space [x, z] tuple to SVG-space Point2D */
export function tupleToSvgPoint(xz: [number, number]): Point2D {
  return { x: toSvgX(xz[0]), y: toSvgY(xz[1]) }
}

// ─── SVG serialisation helpers ─────────────────────────────────────────────

/** Convert Point2D[] (plan space) to SVG polygon `points` attribute string */
export function formatPolygonPoints(points: Point2D[]): string {
  return points
    .map((p) => {
      const s = toSvgPoint(p)
      return `${s.x},${s.y}`
    })
    .join(' ')
}

/**
 * Convert an outer polygon + optional holes to an SVG `<path d>` string.
 * Uses evenodd fill rule so holes are cut out.
 */
export function formatPolygonPath(
  outer: Point2D[],
  holes: Point2D[][] = [],
): string {
  const ring = (pts: Point2D[], close = true) => {
    const parts = pts.map((p) => {
      const s = toSvgPoint(p)
      return `${s.x},${s.y}`
    })
    return `M ${parts.join(' L ')}${close ? ' Z' : ''}`
  }
  return [ring(outer), ...holes.map((h) => ring(h))].join(' ')
}

// ─── Bounding box ─────────────────────────────────────────────────────────

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function expandBBox(bbox: BBox, p: Point2D): BBox {
  return {
    minX: Math.min(bbox.minX, p.x),
    minY: Math.min(bbox.minY, p.y),
    maxX: Math.max(bbox.maxX, p.x),
    maxY: Math.max(bbox.maxY, p.y),
  }
}

export function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

export function bboxFromPoints(points: Point2D[]): BBox {
  return points.reduce(expandBBox, emptyBBox())
}

export function mergeBBoxes(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function bboxWidth(b: BBox): number {
  return b.maxX - b.minX
}
export function bboxHeight(b: BBox): number {
  return b.maxY - b.minY
}

// ─── Polygon centroid ─────────────────────────────────────────────────────

/** Area-weighted centroid of an arbitrary polygon (plan space) */
export function polygonCentroid(pts: Point2D[]): Point2D {
  let area = 0
  let cx = 0
  let cy = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y
    area += cross
    cx += (pts[i].x + pts[j].x) * cross
    cy += (pts[i].y + pts[j].y) * cross
  }
  area /= 2
  if (Math.abs(area) < 1e-12) {
    // degenerate — fall back to average
    const ax = pts.reduce((s, p) => s + p.x, 0) / n
    const ay = pts.reduce((s, p) => s + p.y, 0) / n
    return { x: ax, y: ay }
  }
  cx /= 6 * area
  cy /= 6 * area
  return { x: cx, y: cy }
}

// ─── Opening (door / window) footprint ───────────────────────────────────

/**
 * Returns 4 plan-space corners of a door or window rectangle on a wall.
 * Returns [] if the wall has zero length.
 */
export function getOpeningFootprint(
  wall: WallNode,
  node: DoorNode | WindowNode,
): Point2D[] {
  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 1e-9) return []

  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX

  const distance = node.position[0]
  const width = node.width
  const depth = (wall.thickness ?? 0.1)

  const cx = x1 + dirX * distance
  const cz = z1 + dirZ * distance
  const hw = width / 2
  const hd = depth / 2

  return [
    { x: cx - dirX * hw + perpX * hd, y: cz - dirZ * hw + perpZ * hd },
    { x: cx + dirX * hw + perpX * hd, y: cz + dirZ * hw + perpZ * hd },
    { x: cx + dirX * hw - perpX * hd, y: cz + dirZ * hw - perpZ * hd },
    { x: cx - dirX * hw - perpX * hd, y: cz - dirZ * hw - perpZ * hd },
  ]
}

/**
 * Returns the hinge-corner position (plan space) and swing radius for a door,
 * used to draw the arc. Returns null if wall has zero length.
 */
export function getDoorSwingArc(
  wall: WallNode,
  door: DoorNode,
): { hinge: Point2D; tip: Point2D; radius: number; sweepFlag: 0 | 1 } | null {
  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 1e-9) return null

  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX

  const distance = door.position[0]
  const hw = door.width / 2
  const hd = (wall.thickness ?? 0.1) / 2

  // Centre of opening
  const cx = x1 + dirX * distance
  const cz = z1 + dirZ * distance

  // Hinge is at one end of the opening on the front face
  const hingesRight = door.hingesSide !== 'left'
  const sign = hingesRight ? -1 : 1
  const hinge: Point2D = {
    x: cx + sign * dirX * hw + perpX * hd,
    y: cz + sign * dirZ * hw + perpZ * hd,
  }

  // Tip of door (swings 90°)
  const swingOut = door.swingDirection !== 'inward'
  const swingSign = swingOut ? -1 : 1
  const tip: Point2D = {
    x: hinge.x - sign * swingSign * perpX * door.width,
    y: hinge.y - sign * swingSign * perpZ * door.width,
  }

  return { hinge, tip, radius: door.width, sweepFlag: swingOut ? 0 : 1 }
}

// ─── Rotation helpers ─────────────────────────────────────────────────────

/** Rotate a plan-space point around origin by `angleDeg` (degrees) */
export function rotatePlanPoint(p: Point2D, angleDeg: number): Point2D {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
    y: p.x * Math.sin(rad) + p.y * Math.cos(rad),
  }
}

/** Apply building rotation to a list of plan-space points */
export function applyBuildingRotation(
  points: Point2D[],
  angleDeg: number,
): Point2D[] {
  if (angleDeg === 0) return points
  return points.map((p) => rotatePlanPoint(p, angleDeg))
}

// ─── Item footprint ───────────────────────────────────────────────────────

/**
 * Returns 4 plan-space corners of an item's footprint rectangle,
 * accounting for position and Z-axis rotation.
 */
export function getItemFootprint(item: {
  position: [number, number, number]
  rotation: [number, number, number]
  dimensions?: [number, number, number]
  scale?: [number, number, number]
}): Point2D[] {
  const dims = item.dimensions ?? [1, 1, 1]
  const scale = item.scale ?? [1, 1, 1]
  const hw = (dims[0] * scale[0]) / 2
  const hd = (dims[2] * scale[2]) / 2

  const [px, , pz] = item.position
  const rotY = item.rotation[1] ?? 0 // Y-axis rotation maps to plan rotation
  const rad = rotY

  const corners: Point2D[] = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ]

  return corners.map((c) => ({
    x: px + c.x * Math.cos(rad) - c.y * Math.sin(rad),
    y: pz + c.x * Math.sin(rad) + c.y * Math.cos(rad),
  }))
}

// ─── Stair tread lines ────────────────────────────────────────────────────

/**
 * Returns an array of line segments (pairs of Point2D) for stair treads,
 * evenly spaced along the stair length.
 */
export function getStairTreadLines(seg: {
  position: [number, number, number]
  rotation: [number, number, number]
  width: number
  length: number
  stepCount: number
}): Array<[Point2D, Point2D]> {
  const { width, length, stepCount } = seg
  const [px, , pz] = seg.position
  const rotY = seg.rotation[1] ?? 0

  const lines: Array<[Point2D, Point2D]> = []
  for (let i = 1; i < stepCount; i++) {
    const t = (i / stepCount) * length - length / 2
    const hw = width / 2

    const localA: Point2D = { x: -hw, y: t }
    const localB: Point2D = { x: hw, y: t }

    const rotate = (p: Point2D): Point2D => ({
      x: px + p.x * Math.cos(rotY) - p.y * Math.sin(rotY),
      y: pz + p.x * Math.sin(rotY) + p.y * Math.cos(rotY),
    })

    lines.push([rotate(localA), rotate(localB)])
  }
  return lines
}

/** Returns 4 plan-space corners of a stair segment */
export function getStairSegmentFootprint(seg: {
  position: [number, number, number]
  rotation: [number, number, number]
  width: number
  length: number
}): Point2D[] {
  const { width, length } = seg
  const [px, , pz] = seg.position
  const rotY = seg.rotation[1] ?? 0
  const hw = width / 2
  const hl = length / 2

  const corners: Point2D[] = [
    { x: -hw, y: -hl },
    { x: hw, y: -hl },
    { x: hw, y: hl },
    { x: -hw, y: hl },
  ]

  return corners.map((c) => ({
    x: px + c.x * Math.cos(rotY) - c.y * Math.sin(rotY),
    y: pz + c.x * Math.sin(rotY) + c.y * Math.cos(rotY),
  }))
}

/** Returns the direction arrow head points for a stair segment */
export function getStairArrow(seg: {
  position: [number, number, number]
  rotation: [number, number, number]
  width: number
  length: number
}): { shaft: [Point2D, Point2D]; head: [Point2D, Point2D, Point2D] } {
  const { width, length } = seg
  const [px, , pz] = seg.position
  const rotY = seg.rotation[1] ?? 0
  const hl = length / 2
  const arrowW = width * 0.25

  const rotate = (lx: number, ly: number): Point2D => ({
    x: px + lx * Math.cos(rotY) - ly * Math.sin(rotY),
    y: pz + lx * Math.sin(rotY) + ly * Math.cos(rotY),
  })

  return {
    shaft: [rotate(0, -hl + length * 0.1), rotate(0, hl - length * 0.15)],
    head: [
      rotate(-arrowW, hl - length * 0.25),
      rotate(0, hl - length * 0.05),
      rotate(arrowW, hl - length * 0.25),
    ],
  }
}
