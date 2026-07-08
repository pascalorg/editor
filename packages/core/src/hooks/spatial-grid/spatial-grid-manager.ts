import { nodeRegistry } from '../../registry'
import type { AnyNode, CeilingNode, ItemNode, SlabNode, WallNode } from '../../schema'
import { getScaledDimensions, isLowProfileItemSurface } from '../../schema'
import useScene from '../../store/use-scene'
import {
  getWallCurveFrameAt,
  isCurvedWall,
  sampleWallCenterline,
} from '../../systems/wall/wall-curve'
import { DEFAULT_WALL_THICKNESS } from '../../systems/wall/wall-footprint'
import { getFloorPlacedFootprints } from './floor-placed-elevation'
import { SpatialGrid } from './spatial-grid'
import { WallSpatialGrid } from './wall-spatial-grid'

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

/**
 * Point-in-polygon test using ray casting algorithm.
 */
export function pointInPolygon(px: number, pz: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]![0],
      zi = polygon[i]![1]
    const xj = polygon[j]![0],
      zj = polygon[j]![1]

    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Compute the 4 XZ footprint corners of an item given its position, dimensions, and Y rotation.
 */
function getItemFootprint(
  position: [number, number, number],
  dimensions: [number, number, number],
  rotation: [number, number, number],
  inset = 0,
): Array<[number, number]> {
  const [x, , z] = position
  const [w, , d] = dimensions
  const yRot = rotation[1]
  const halfW = Math.max(0, w / 2 - inset)
  const halfD = Math.max(0, d / 2 - inset)
  const cos = Math.cos(yRot)
  const sin = Math.sin(yRot)

  return [
    [x + (-halfW * cos + halfD * sin), z + (-halfW * sin - halfD * cos)],
    [x + (halfW * cos + halfD * sin), z + (halfW * sin - halfD * cos)],
    [x + (halfW * cos - halfD * sin), z + (halfW * sin + halfD * cos)],
    [x + (-halfW * cos - halfD * sin), z + (-halfW * sin + halfD * cos)],
  ]
}

/**
 * Axis-aligned XZ extent of a footprint at `position`, rotated by `yRot`. The
 * rotated width/depth is the same conservative bound the floor-placement draft
 * uses, so a draft and an existing node are compared with identical math.
 */
function footprintBoundsXZ(
  position: [number, number, number],
  dimensions: [number, number, number],
  yRot: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const [width, , depth] = dimensions
  const cos = Math.abs(Math.cos(yRot))
  const sin = Math.abs(Math.sin(yRot))
  const rotatedW = width * cos + depth * sin
  const rotatedD = width * sin + depth * cos
  return {
    minX: position[0] - rotatedW / 2,
    maxX: position[0] + rotatedW / 2,
    minZ: position[2] - rotatedD / 2,
    maxZ: position[2] + rotatedD / 2,
  }
}

type ItemLocalBounds = {
  min: [number, number, number]
  max: [number, number, number]
}

type ItemParentAabb = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

function getItemLocalBounds(item: ItemNode): ItemLocalBounds {
  const [width, height, depth] = getScaledDimensions(item)
  const minZ = item.asset.attachTo === 'wall-side' ? -depth : -depth / 2
  const maxZ = item.asset.attachTo === 'wall-side' ? 0 : depth / 2
  return {
    min: [-width / 2, 0, minZ],
    max: [width / 2, height, maxZ],
  }
}

function getItemParentAabb(item: ItemNode): ItemParentAabb {
  const bounds = getItemLocalBounds(item)
  const corners: Array<[number, number, number]> = [
    [bounds.min[0], bounds.min[1], bounds.min[2]],
    [bounds.min[0], bounds.min[1], bounds.max[2]],
    [bounds.min[0], bounds.max[1], bounds.min[2]],
    [bounds.min[0], bounds.max[1], bounds.max[2]],
    [bounds.max[0], bounds.min[1], bounds.min[2]],
    [bounds.max[0], bounds.min[1], bounds.max[2]],
    [bounds.max[0], bounds.max[1], bounds.min[2]],
    [bounds.max[0], bounds.max[1], bounds.max[2]],
  ]
  const yRot = item.rotation[1] ?? 0
  const cos = Math.cos(yRot)
  const sin = Math.sin(yRot)

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [cx, cy, cz] of corners) {
    const rotatedX = cx * cos + cz * sin
    const rotatedZ = -cx * sin + cz * cos
    const worldX = rotatedX + item.position[0]
    const worldY = cy + item.position[1]
    const worldZ = rotatedZ + item.position[2]
    minX = Math.min(minX, worldX)
    minY = Math.min(minY, worldY)
    minZ = Math.min(minZ, worldZ)
    maxX = Math.max(maxX, worldX)
    maxY = Math.max(maxY, worldY)
    maxZ = Math.max(maxZ, worldZ)
  }

  return { minX, maxX, minY, maxY, minZ, maxZ }
}

function intervalsOverlap(minA: number, maxA: number, minB: number, maxB: number, epsilon = 1e-4) {
  return minA < maxB - epsilon && maxA > minB + epsilon
}

function resolveNodeLevelId(node: AnyNode, nodes: Record<string, AnyNode>): string {
  if (node.type === 'level') return node.id

  let current: AnyNode | undefined = node
  while (current) {
    if (current.type === 'level') return current.id
    current = current.parentId ? nodes[current.parentId] : undefined
  }

  return 'default'
}

/**
 * Test if two line segments (a1->a2) and (b1->b2) intersect.
 */
function segmentsIntersect(
  ax1: number,
  az1: number,
  ax2: number,
  az2: number,
  bx1: number,
  bz1: number,
  bx2: number,
  bz2: number,
): boolean {
  const cross = (ox: number, oz: number, ax: number, az: number, bx: number, bz: number) =>
    (ax - ox) * (bz - oz) - (az - oz) * (bx - ox)

  const d1 = cross(bx1, bz1, bx2, bz2, ax1, az1)
  const d2 = cross(bx1, bz1, bx2, bz2, ax2, az2)
  const d3 = cross(ax1, az1, ax2, az2, bx1, bz1)
  const d4 = cross(ax1, az1, ax2, az2, bx2, bz2)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  // Collinear touching cases
  const onSeg = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    Math.min(px, qx) <= rx &&
    rx <= Math.max(px, qx) &&
    Math.min(pz, qz) <= rz &&
    rz <= Math.max(pz, qz)

  if (d1 === 0 && onSeg(bx1, bz1, bx2, bz2, ax1, az1)) return true
  if (d2 === 0 && onSeg(bx1, bz1, bx2, bz2, ax2, az2)) return true
  if (d3 === 0 && onSeg(ax1, az1, ax2, az2, bx1, bz1)) return true
  if (d4 === 0 && onSeg(ax1, az1, ax2, az2, bx2, bz2)) return true

  return false
}

/**
 * Test if a line segment intersects any edge of a polygon.
 */
function segmentIntersectsPolygon(
  sx1: number,
  sz1: number,
  sx2: number,
  sz2: number,
  polygon: Array<[number, number]>,
): boolean {
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (
      segmentsIntersect(
        sx1,
        sz1,
        sx2,
        sz2,
        polygon[i]![0],
        polygon[i]![1],
        polygon[j]![0],
        polygon[j]![1],
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * Test if an item's footprint overlaps with a polygon.
 * Checks: any item corner inside polygon, or any polygon vertex inside item AABB, or edges intersect.
 */
export function itemOverlapsPolygon(
  position: [number, number, number],
  dimensions: [number, number, number],
  rotation: [number, number, number],
  polygon: Array<[number, number]>,
  inset = 0,
): boolean {
  const corners = getItemFootprint(position, dimensions, rotation, inset)

  // Check if any item corner is inside the polygon
  for (const [cx, cz] of corners) {
    if (pointInPolygon(cx, cz, polygon)) return true
  }

  // Check if any polygon vertex is inside the item footprint
  // (handles case where slab is fully inside a large item)
  for (const [px, pz] of polygon) {
    if (pointInPolygon(px, pz, corners)) return true
  }

  // Check if any item edge intersects any polygon edge
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    if (
      segmentIntersectsPolygon(
        corners[i]![0],
        corners[i]![1],
        corners[j]![0],
        corners[j]![1],
        polygon,
      )
    )
      return true
  }

  return false
}

function pointSegmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-18) return Math.hypot(px - ax, pz - az)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared))
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

// Ray-cast pointInPolygon is unreliable for points exactly on the polygon
// boundary: the answer flips depending on which side of the polygon the edge
// is on. Interval classification below therefore treats "within this distance
// of the boundary" as inside explicitly, so walls sitting exactly on a slab
// edge (the common case — auto-slab polygons derive from wall centerlines)
// classify identically on every side of the slab.
const ON_BOUNDARY_EPSILON = 1e-4

function pointOnPolygonBoundary(px: number, pz: number, polygon: Array<[number, number]>): boolean {
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const [ax, az] = polygon[i]!
    const [bx, bz] = polygon[(i + 1) % n]!
    if (pointSegmentDistance(px, pz, ax, az, bx, bz) <= ON_BOUNDARY_EPSILON) return true
  }
  return false
}

/**
 * Length of the sub-intervals of segment (ax,az)→(bx,bz) that lie inside the
 * polygon or on its boundary. The segment is split at every crossing with a
 * polygon edge and each sub-interval is classified by its midpoint, so no
 * test point ever sits on a crossing.
 */
function segmentInsideLength(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  polygon: Array<[number, number]>,
): number {
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return 0

  const ts = [0, 1]
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const [px, pz] = polygon[i]!
    const [qx, qz] = polygon[(i + 1) % n]!
    const ex = qx - px
    const ez = qz - pz
    const denom = dx * ez - dz * ex
    if (Math.abs(denom) < 1e-12) continue // parallel/collinear — nothing to split at
    const t = ((px - ax) * ez - (pz - az) * ex) / denom
    const s = ((px - ax) * dz - (pz - az) * dx) / denom
    if (t > 0 && t < 1 && s >= -1e-9 && s <= 1 + 1e-9) ts.push(t)
  }
  ts.sort((a, b) => a - b)

  let inside = 0
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i - 1]!
    const t1 = ts[i]!
    if (t1 - t0 < 1e-9) continue
    const tm = (t0 + t1) / 2
    const mx = ax + dx * tm
    const mz = az + dz * tm
    if (pointOnPolygonBoundary(mx, mz, polygon) || pointInPolygon(mx, mz, polygon)) {
      inside += (t1 - t0) * length
    }
  }
  return inside
}

function polylineInsideLength(
  points: Array<{ x: number; y: number }>,
  polygon: Array<[number, number]>,
): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    total += segmentInsideLength(a.x, a.y, b.x, b.y, polygon)
  }
  return total
}

type WallOverlapInput = {
  start: [number, number]
  end: [number, number]
  curveOffset?: number
  thickness?: number
}

// Minimum length of wall that must lie on/inside a slab polygon before the
// wall counts as overlapping it. Point contact (a perpendicular wall butting
// into a room's edge) clips to ~zero length and never reaches this, so such
// walls don't follow the slab's elevation.
const WALL_SLAB_MIN_OVERLAP = 0.05

/**
 * Centerline of the wall plus its two face lines (centerline offset by
 * ±halfThickness). The face lines catch walls whose centerline sits on or
 * just outside the slab boundary but whose body reaches onto the slab —
 * e.g. slab polygons drawn to the room's interior faces.
 */
function wallTestPolylines(
  start: [number, number],
  end: [number, number],
  curveOffset: number,
  halfThickness: number,
): Array<Array<{ x: number; y: number }>> {
  const wallLike = { start, end, curveOffset }
  if (curveOffset !== 0 && isCurvedWall(wallLike)) {
    const count = 16
    const center: Array<{ x: number; y: number }> = []
    const left: Array<{ x: number; y: number }> = []
    const right: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= count; i++) {
      const frame = getWallCurveFrameAt(wallLike, i / count)
      center.push(frame.point)
      left.push({
        x: frame.point.x + frame.normal.x * halfThickness,
        y: frame.point.y + frame.normal.y * halfThickness,
      })
      right.push({
        x: frame.point.x - frame.normal.x * halfThickness,
        y: frame.point.y - frame.normal.y * halfThickness,
      })
    }
    return halfThickness > 0 ? [center, left, right] : [center]
  }

  const center = [
    { x: start[0], y: start[1] },
    { x: end[0], y: end[1] },
  ]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const len = Math.hypot(dx, dz)
  if (len < 1e-10 || halfThickness <= 0) return [center]
  const nx = (-dz / len) * halfThickness
  const nz = (dx / len) * halfThickness
  return [
    center,
    [
      { x: start[0] + nx, y: start[1] + nz },
      { x: end[0] + nx, y: end[1] + nz },
    ],
    [
      { x: start[0] - nx, y: start[1] - nz },
      { x: end[0] - nx, y: end[1] - nz },
    ],
  ]
}

/**
 * Test whether a wall overlaps a slab polygon along a segment of its length.
 *
 * The wall's centerline and both face lines are clipped against the polygon;
 * the wall overlaps when the longest clipped inside-or-on-boundary length
 * exceeds a threshold (5cm, halved for very short walls). Because interval
 * midpoints classify "on the boundary" as inside explicitly (never by
 * ray-cast tie-breaking), a wall sitting exactly on a slab edge resolves
 * identically on every side of the slab.
 *
 * A wall that only touches the polygon at a point — a perpendicular wall
 * butting into a room's edge, or a corner-to-corner touch — clips to ~zero
 * length and does NOT overlap.
 */
export function wallOverlapsPolygon(
  startOrWall: [number, number] | WallOverlapInput,
  endOrPolygon: [number, number] | Array<[number, number]>,
  polygonArg?: Array<[number, number]>,
): boolean {
  // Two call shapes:
  //   wallOverlapsPolygon(wallLike, polygon) — preferred; curve-aware
  //   wallOverlapsPolygon(start, end, polygon) — legacy chord-only
  let start: [number, number]
  let end: [number, number]
  let polygon: Array<[number, number]>
  let curveOffset = 0
  let thickness = DEFAULT_WALL_THICKNESS
  if (Array.isArray(startOrWall)) {
    start = startOrWall as [number, number]
    end = endOrPolygon as [number, number]
    polygon = polygonArg as Array<[number, number]>
  } else {
    start = startOrWall.start
    end = startOrWall.end
    curveOffset = startOrWall.curveOffset ?? 0
    thickness = startOrWall.thickness ?? DEFAULT_WALL_THICKNESS
    polygon = endOrPolygon as Array<[number, number]>
  }
  const halfThickness = Math.max(thickness / 2, 0)

  const polylines = wallTestPolylines(start, end, curveOffset, halfThickness)
  const center = polylines[0]!
  let centerLength = 0
  for (let i = 1; i < center.length; i++) {
    centerLength += Math.hypot(center[i]!.x - center[i - 1]!.x, center[i]!.y - center[i - 1]!.y)
  }
  if (centerLength < 1e-9) return false

  let overlap = 0
  for (const line of polylines) {
    overlap = Math.max(overlap, polylineInsideLength(line, polygon))
  }
  const threshold = Math.max(1e-3, Math.min(WALL_SLAB_MIN_OVERLAP, centerLength * 0.5))
  return overlap >= threshold
}

export class SpatialGridManager {
  private readonly floorGrids = new Map<string, SpatialGrid>() // levelId -> grid
  private readonly wallGrids = new Map<string, WallSpatialGrid>() // levelId -> wall grid
  private readonly walls = new Map<string, WallNode>() // wallId -> wall data (for length calculations)
  private readonly slabsByLevel = new Map<string, Map<string, SlabNode>>() // levelId -> (slabId -> slab)
  private readonly ceilingGrids = new Map<string, SpatialGrid>() // ceilingId -> grid
  private readonly ceilings = new Map<string, CeilingNode>() // ceilingId -> ceiling data
  private readonly itemCeilingMap = new Map<string, string>() // itemId -> ceilingId (reverse lookup)

  private readonly cellSize: number

  constructor(cellSize = 0.5) {
    this.cellSize = cellSize
  }

  private getFloorGrid(levelId: string): SpatialGrid {
    if (!this.floorGrids.has(levelId)) {
      this.floorGrids.set(levelId, new SpatialGrid({ cellSize: this.cellSize }))
    }
    return this.floorGrids.get(levelId)!
  }

  private getWallGrid(levelId: string): WallSpatialGrid {
    if (!this.wallGrids.has(levelId)) {
      this.wallGrids.set(levelId, new WallSpatialGrid())
    }
    return this.wallGrids.get(levelId)!
  }

  private getWallLength(wallId: string): number {
    const wall = this.walls.get(wallId)
    if (!wall) return 0
    const dx = wall.end[0] - wall.start[0]
    const dy = wall.end[1] - wall.start[1]
    return Math.sqrt(dx * dx + dy * dy)
  }

  private getWallHeight(wallId: string): number {
    const wall = this.walls.get(wallId)
    return wall?.height ?? 2.5 // Default wall height
  }

  private getCeilingGrid(ceilingId: string): SpatialGrid {
    if (!this.ceilingGrids.has(ceilingId)) {
      this.ceilingGrids.set(ceilingId, new SpatialGrid({ cellSize: this.cellSize }))
    }
    return this.ceilingGrids.get(ceilingId)!
  }

  private getSlabMap(levelId: string): Map<string, SlabNode> {
    if (!this.slabsByLevel.has(levelId)) {
      this.slabsByLevel.set(levelId, new Map())
    }
    return this.slabsByLevel.get(levelId)!
  }

  // Called when nodes change
  handleNodeCreated(node: AnyNode, levelId: string) {
    if (node.type === 'slab') {
      this.getSlabMap(levelId).set(node.id, node as SlabNode)
    } else if (node.type === 'ceiling') {
      this.ceilings.set(node.id, node as CeilingNode)
    } else if (node.type === 'wall') {
      const wall = node as WallNode
      this.walls.set(wall.id, wall)
    } else if (node.type === 'item') {
      const item = node as ItemNode
      if (item.asset.attachTo === 'wall' || item.asset.attachTo === 'wall-side') {
        // Wall-attached item - use parentId as the wall ID
        const wallId = item.parentId
        if (wallId && this.walls.has(wallId)) {
          const wallLength = this.getWallLength(wallId)
          if (wallLength > 0) {
            const [width, height] = getScaledDimensions(item)
            const halfW = width / wallLength / 2
            // Calculate t from local X position (position[0] is distance along wall)
            const t = item.position[0] / wallLength
            // position[1] is the bottom of the item
            this.getWallGrid(levelId).insert({
              itemId: item.id,
              wallId,
              tStart: t - halfW,
              tEnd: t + halfW,
              yStart: item.position[1],
              yEnd: item.position[1] + height,
              attachType: item.asset.attachTo as 'wall' | 'wall-side',
              side: item.side,
            })
          }
        }
      } else if (item.asset.attachTo === 'ceiling') {
        // Ceiling item - use parentId as the ceiling ID
        const ceilingId = item.parentId
        if (ceilingId && this.ceilings.has(ceilingId)) {
          this.getCeilingGrid(ceilingId).insert(
            item.id,
            item.position,
            getScaledDimensions(item),
            item.rotation,
          )
          this.itemCeilingMap.set(item.id, ceilingId)
        }
      } else if (!item.asset.attachTo) {
        // Floor item
        this.getFloorGrid(levelId).insert(
          item.id,
          item.position,
          getScaledDimensions(item),
          item.rotation,
        )
      }
    }
  }

  handleNodeUpdated(node: AnyNode, levelId: string) {
    if (node.type === 'slab') {
      this.getSlabMap(levelId).set(node.id, node as SlabNode)
    } else if (node.type === 'ceiling') {
      this.ceilings.set(node.id, node as CeilingNode)
    } else if (node.type === 'wall') {
      const wall = node as WallNode
      this.walls.set(wall.id, wall)
    } else if (node.type === 'item') {
      const item = node as ItemNode
      if (item.asset.attachTo === 'wall' || item.asset.attachTo === 'wall-side') {
        // Remove old placement and re-insert
        this.getWallGrid(levelId).removeByItemId(item.id)
        const wallId = item.parentId
        if (wallId && this.walls.has(wallId)) {
          const wallLength = this.getWallLength(wallId)
          if (wallLength > 0) {
            const [width, height] = getScaledDimensions(item)
            const halfW = width / wallLength / 2
            // Calculate t from local X position (position[0] is distance along wall)
            const t = item.position[0] / wallLength
            // position[1] is the bottom of the item
            this.getWallGrid(levelId).insert({
              itemId: item.id,
              wallId,
              tStart: t - halfW,
              tEnd: t + halfW,
              yStart: item.position[1],
              yEnd: item.position[1] + height,
              attachType: item.asset.attachTo as 'wall' | 'wall-side',
              side: item.side,
            })
          }
        }
      } else if (item.asset.attachTo === 'ceiling') {
        // Remove from old ceiling grid
        const oldCeilingId = this.itemCeilingMap.get(item.id)
        if (oldCeilingId) {
          this.getCeilingGrid(oldCeilingId).remove(item.id)
          this.itemCeilingMap.delete(item.id)
        }
        // Insert into new ceiling grid
        const ceilingId = item.parentId
        if (ceilingId && this.ceilings.has(ceilingId)) {
          this.getCeilingGrid(ceilingId).insert(
            item.id,
            item.position,
            getScaledDimensions(item),
            item.rotation,
          )
          this.itemCeilingMap.set(item.id, ceilingId)
        }
      } else if (!item.asset.attachTo) {
        this.getFloorGrid(levelId).update(
          item.id,
          item.position,
          getScaledDimensions(item),
          item.rotation,
        )
      }
    }
  }

  handleNodeDeleted(nodeId: string, nodeType: string, levelId: string) {
    if (nodeType === 'slab') {
      this.getSlabMap(levelId).delete(nodeId)
    } else if (nodeType === 'ceiling') {
      this.ceilings.delete(nodeId)
      this.ceilingGrids.delete(nodeId)
    } else if (nodeType === 'wall') {
      this.walls.delete(nodeId)
      // Remove all items attached to this wall from the spatial grid
      const removedItemIds = this.getWallGrid(levelId).removeWall(nodeId)
      return removedItemIds // Caller can use this to delete the items from scene
    } else if (nodeType === 'item') {
      this.getFloorGrid(levelId).remove(nodeId)
      this.getWallGrid(levelId).removeByItemId(nodeId)
      // Also clean up ceiling grid
      const oldCeilingId = this.itemCeilingMap.get(nodeId)
      if (oldCeilingId) {
        this.getCeilingGrid(oldCeilingId).remove(nodeId)
        this.itemCeilingMap.delete(nodeId)
      }
    }
    return []
  }

  // Query methods
  canPlaceOnFloor(
    levelId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    ignoreIds?: string[],
  ) {
    const nodes = useScene.getState().nodes
    const ignoreSet = new Set(ignoreIds ?? [])
    const draftBounds = footprintBoundsXZ(position, dimensions, rotation[1])

    // A floor placement conflicts with any other COLLIDING floor-resting node,
    // not just items — every kind whose `floorPlaced.collides` is set (item /
    // shelf / column) contributes its footprint(s) as an obstacle. Each
    // candidate's XZ extent is read from the same declarative footprint the
    // elevation + sync paths use, so adding a colliding kind needs no change here.
    const conflicts: string[] = []
    for (const node of Object.values(nodes)) {
      if (ignoreSet.has(node.id)) continue
      const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
      if (!floorPlaced?.collides) continue
      if (floorPlaced.applies && !floorPlaced.applies(node)) continue
      // Low-profile item surfaces (rugs, mats) are stack-on targets, not
      // obstacles — keep the long-standing item-only exemption.
      if (node.type === 'item' && isLowProfileItemSurface(node as ItemNode)) continue
      if (resolveNodeLevelId(node, nodes) !== levelId) continue

      for (const footprint of getFloorPlacedFootprints(floorPlaced, node, { nodes })) {
        const fpRotation = Array.isArray(footprint.rotation) ? (footprint.rotation[1] ?? 0) : 0
        const bounds = footprintBoundsXZ(
          footprint.position ?? (node as { position: [number, number, number] }).position,
          footprint.dimensions,
          fpRotation,
        )
        if (
          intervalsOverlap(draftBounds.minX, draftBounds.maxX, bounds.minX, bounds.maxX) &&
          intervalsOverlap(draftBounds.minZ, draftBounds.maxZ, bounds.minZ, bounds.maxZ)
        ) {
          conflicts.push(node.id)
          break
        }
      }
    }

    return { valid: conflicts.length === 0, conflictIds: conflicts }
  }

  /**
   * Check if an item can be placed on a wall
   * @param levelId - the level containing the wall
   * @param wallId - the wall to check
   * @param localX - X position in wall-local space (distance from wall start)
   * @param localY - Y position (height from floor)
   * @param dimensions - item dimensions [width, height, depth]
   * @param attachType - 'wall' (needs both sides) or 'wall-side' (needs one side)
   * @param side - which side for 'wall-side' items
   * @param ignoreIds - item IDs to ignore in collision check
   */
  canPlaceOnWall(
    levelId: string,
    wallId: string,
    localX: number,
    localY: number,
    dimensions: [number, number, number],
    attachType: 'wall' | 'wall-side' = 'wall',
    side?: 'front' | 'back',
    ignoreIds?: string[],
  ) {
    const wallLength = this.getWallLength(wallId)
    if (wallLength === 0) {
      return { valid: false, conflictIds: [] }
    }
    const wallHeight = this.getWallHeight(wallId)
    // Convert local X position to parametric t (0-1)
    const tCenter = localX / wallLength
    const [itemWidth, itemHeight] = dimensions
    const baseResult = this.getWallGrid(levelId).canPlaceOnWall(
      wallId,
      wallLength,
      wallHeight,
      tCenter,
      itemWidth,
      localY,
      itemHeight,
      attachType,
      side,
      ignoreIds,
    )

    if (!baseResult.valid) return baseResult

    const nodes = useScene.getState().nodes
    const ignoreSet = new Set(ignoreIds ?? [])
    const draftBounds = {
      minX: localX - itemWidth / 2,
      maxX: localX + itemWidth / 2,
      minY: baseResult.adjustedY,
      maxY: baseResult.adjustedY + itemHeight,
    }

    const conflicts: string[] = []
    for (const node of Object.values(nodes)) {
      if (node.type !== 'item') continue
      const item = node as ItemNode
      if (!(item.asset.attachTo === 'wall' || item.asset.attachTo === 'wall-side')) continue
      if (ignoreSet.has(item.id)) continue
      if (item.parentId !== wallId) continue

      if (attachType === 'wall-side' && item.asset.attachTo === 'wall-side' && side && item.side) {
        if (side !== item.side) continue
      }

      const bounds = getItemParentAabb(item)
      if (
        intervalsOverlap(draftBounds.minX, draftBounds.maxX, bounds.minX, bounds.maxX) &&
        intervalsOverlap(draftBounds.minY, draftBounds.maxY, bounds.minY, bounds.maxY)
      ) {
        conflicts.push(item.id)
      }
    }

    return {
      ...baseResult,
      valid: conflicts.length === 0,
      conflictIds: conflicts,
    }
  }

  getWallForItem(levelId: string, itemId: string): string | undefined {
    return this.getWallGrid(levelId).getWallForItem(itemId)
  }

  /**
   * Get the total slab elevation at a given (x, z) position on a level.
   * Returns the highest slab elevation if the point is inside any slab polygon (but not in any holes), otherwise 0.
   */
  getSlabElevationAt(levelId: string, x: number, z: number): number {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) return 0

    let maxElevation = 0
    for (const slab of slabMap.values()) {
      if (slab.polygon.length >= 3 && pointInPolygon(x, z, slab.polygon)) {
        // Check if point is in any hole
        let inHole = false
        const holes = slab.holes || []
        for (const hole of holes) {
          if (hole.length >= 3 && pointInPolygon(x, z, hole)) {
            inHole = true
            break
          }
        }

        if (!inHole) {
          const elevation = slab.elevation ?? 0.05
          if (elevation > maxElevation) {
            maxElevation = elevation
          }
        }
      }
    }
    return maxElevation
  }

  /**
   * Get the slab elevation for an item using its full footprint (bounding box).
   * Checks if any part of the item's rotated footprint overlaps with any slab polygon (excluding holes).
   * Returns the highest overlapping slab elevation, or 0 if none.
   */
  getSlabElevationForItem(
    levelId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ): number {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) return 0

    let maxElevation = Number.NEGATIVE_INFINITY
    for (const slab of slabMap.values()) {
      if (
        slab.polygon.length >= 3 &&
        itemOverlapsPolygon(position, dimensions, rotation, slab.polygon, 0.01)
      ) {
        // Check if item is entirely within a hole (if so, ignore this slab)
        // We consider it entirely in a hole if the item center is in the hole
        let inHole = false
        const [cx, , cz] = position
        const holes = slab.holes || []
        for (const hole of holes) {
          if (hole.length >= 3 && pointInPolygon(cx, cz, hole)) {
            inHole = true
            break
          }
        }

        if (!inHole) {
          const elevation = slab.elevation ?? 0.05
          if (elevation > maxElevation) {
            maxElevation = elevation
          }
        }
      }
    }
    return maxElevation === Number.NEGATIVE_INFINITY ? 0 : maxElevation
  }

  /**
   * Get the slab elevation for a wall by checking if it overlaps with any slab polygon (excluding holes).
   * Uses wallOverlapsPolygon which handles edge cases (points on boundary, collinear segments).
   * Returns the highest slab elevation found, or 0 if none.
   *
   * Accepts an optional `curveOffset` so curved walls evaluate overlap
   * against their actual centerline samples, not just the chord.
   */
  getSlabElevationForWall(
    levelId: string,
    start: [number, number],
    end: [number, number],
    curveOffset = 0,
    thickness = DEFAULT_WALL_THICKNESS,
  ): number {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) return 0

    const wallLike: WallOverlapInput = { start, end, curveOffset, thickness }
    const isCurved = curveOffset !== 0 && isCurvedWall(wallLike)
    const holeSamplePoints: Array<{ x: number; y: number }> = isCurved
      ? sampleWallCenterline(wallLike, 8)
      : [0, 0.25, 0.5, 0.75, 1].map((t) => ({
          x: start[0] + (end[0] - start[0]) * t,
          y: start[1] + (end[1] - start[1]) * t,
        }))

    let maxElevation = Number.NEGATIVE_INFINITY
    for (const slab of slabMap.values()) {
      if (slab.polygon.length < 3) continue
      if (!wallOverlapsPolygon(wallLike, slab.polygon)) continue

      const holes = slab.holes || []
      if (holes.length === 0) {
        // No holes: wall is on this slab
        const elevation = slab.elevation ?? 0.05
        if (elevation > maxElevation) maxElevation = elevation
        continue
      }

      // Sample multiple points along the wall to check whether any portion lies on
      // solid slab (not inside any hole). Checking only the midpoint fails when the
      // midpoint falls in a staircase hole but the wall's endpoints are on solid slab.
      let hasValidPoint = false
      for (const sample of holeSamplePoints) {
        let inHole = false
        for (const hole of holes) {
          if (hole.length >= 3 && pointInPolygon(sample.x, sample.y, hole)) {
            inHole = true
            break
          }
        }
        if (!inHole) {
          hasValidPoint = true
          break
        }
      }

      if (hasValidPoint) {
        const elevation = slab.elevation ?? 0.05
        if (elevation > maxElevation) maxElevation = elevation
      }
    }
    return maxElevation === Number.NEGATIVE_INFINITY ? 0 : maxElevation
  }

  /**
   * Check if an item can be placed on a ceiling.
   * Validates that the footprint is within the ceiling polygon (but not in any holes) and doesn't overlap other ceiling items.
   */
  canPlaceOnCeiling(
    ceilingId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    ignoreIds?: string[],
  ): { valid: boolean; conflictIds: string[] } {
    const ceiling = this.ceilings.get(ceilingId)
    if (!ceiling || ceiling.polygon.length < 3) {
      return { valid: false, conflictIds: [] }
    }

    // Check that the item footprint is entirely within the ceiling polygon
    const corners = getItemFootprint(position, dimensions, rotation)
    for (const [cx, cz] of corners) {
      if (!pointInPolygon(cx, cz, ceiling.polygon)) {
        return { valid: false, conflictIds: [] }
      }
    }

    // Check if item center is in any hole (if so, it cannot be placed)
    const [centerX, , centerZ] = position
    const holes = ceiling.holes || []
    for (const hole of holes) {
      if (hole.length >= 3 && pointInPolygon(centerX, centerZ, hole)) {
        return { valid: false, conflictIds: [] }
      }
    }

    const nodes = useScene.getState().nodes
    const ignoreSet = new Set(ignoreIds ?? [])
    const [width, , depth] = dimensions
    const yRot = rotation[1]
    const cos = Math.abs(Math.cos(yRot))
    const sin = Math.abs(Math.sin(yRot))
    const rotatedW = width * cos + depth * sin
    const rotatedD = width * sin + depth * cos
    const draftBounds = {
      minX: position[0] - rotatedW / 2,
      maxX: position[0] + rotatedW / 2,
      minZ: position[2] - rotatedD / 2,
      maxZ: position[2] + rotatedD / 2,
    }

    const conflicts: string[] = []
    for (const node of Object.values(nodes)) {
      if (node.type !== 'item') continue
      const item = node as ItemNode
      if (item.asset.attachTo !== 'ceiling') continue
      if (ignoreSet.has(item.id)) continue
      if (item.parentId !== ceilingId) continue

      const bounds = getItemParentAabb(item)
      if (
        intervalsOverlap(draftBounds.minX, draftBounds.maxX, bounds.minX, bounds.maxX) &&
        intervalsOverlap(draftBounds.minZ, draftBounds.maxZ, bounds.minZ, bounds.maxZ)
      ) {
        conflicts.push(item.id)
      }
    }

    return { valid: conflicts.length === 0, conflictIds: conflicts }
  }

  clearLevel(levelId: string) {
    this.floorGrids.delete(levelId)
    this.wallGrids.delete(levelId)
    this.slabsByLevel.delete(levelId)
  }

  clear() {
    this.floorGrids.clear()
    this.wallGrids.clear()
    this.walls.clear()
    this.slabsByLevel.clear()
    this.ceilingGrids.clear()
    this.ceilings.clear()
    this.itemCeilingMap.clear()
  }
}

// Singleton instance
export const spatialGridManager = new SpatialGridManager()
