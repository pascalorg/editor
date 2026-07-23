import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import { nodeRegistry } from '../../registry'
import type { AnyNode, AnyNodeId, CeilingNode, ItemNode, SlabNode, WallNode } from '../../schema'
import { getScaledDimensions, isLowProfileItemSurface } from '../../schema'
import { getWallPlaneTop } from '../../services/storey'
import useLiveNodeOverrides, { getEffectiveNode } from '../../store/use-live-node-overrides'
import useLiveTransforms from '../../store/use-live-transforms'
import useScene from '../../store/use-scene'
import {
  computeWallSlabSupport,
  pointInPolygon,
  SUPPORT_ELEVATION_EPSILON,
  type WallSlabSupport,
} from '../../systems/slab/slab-support'
import { DEFAULT_WALL_THICKNESS } from '../../systems/wall/wall-footprint'
import { resolveWallEffectiveHeight } from '../../systems/wall/wall-top'
import { getFloorPlacedFootprints } from './floor-placed-elevation'
import { SpatialGrid } from './spatial-grid'
import { WallSpatialGrid } from './wall-spatial-grid'

export {
  computeWallSlabElevation,
  computeWallSlabSupport,
  pointInPolygon,
  SUPPORT_ELEVATION_EPSILON,
  type WallOverlapInput,
  type WallSlabSupport,
  type WallSlabSupportSegment,
  wallOverlapsPolygon,
} from '../../systems/slab/slab-support'

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

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

function expandIgnoredNodeIds(
  ignoreIds: readonly string[] | undefined,
  nodes: Record<string, AnyNode>,
): Set<string> {
  const ignored = new Set(ignoreIds ?? [])
  const queue = [...ignored]

  while (queue.length > 0) {
    const id = queue.pop()!
    const node = nodes[id]
    const children = (node as { children?: unknown } | undefined)?.children
    if (!Array.isArray(children)) continue
    for (const childId of children) {
      if (typeof childId !== 'string' || ignored.has(childId)) continue
      ignored.add(childId)
      queue.push(childId)
    }
  }

  return ignored
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

/** One slab overlapping a queried footprint, as seen by support election. */
export type SlabSupportCandidate = {
  slabId: string
  elevation: number
}

export type ItemSlabSupport = {
  elevation: number
  /** The winning slab, or null when no slab overlaps the footprint. */
  slabId: string | null
}

export type PointedSupportSurface = ItemSlabSupport & {
  /**
   * Level-local XZ where the ray meets the pointed surface's plane, or
   * null when the ray never reaches it (grazing / aimed above the base).
   * This is the plan point the pointer actually indicates: unlike a grid
   * event-plane hit — whose XZ shifts with whatever height the event
   * plane currently rides at — it depends only on the ray and the
   * aimed-at surface, so election/preview at this point cannot flip when
   * the event plane changes storey.
   */
  point: [number, number] | null
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
    if (!wall) return 0
    if (wall.height != null) return wall.height

    const nodes = useScene.getState().nodes
    const levelId = resolveNodeLevelId(wall, nodes)
    const support = this.getSlabSupportForWall(
      levelId,
      wall.start,
      wall.end,
      wall.curveOffset ?? 0,
      wall.thickness,
      wall.supportSlabId ?? null,
    )
    return resolveWallEffectiveHeight(
      wall,
      getWallPlaneTop(wall, levelId, nodes),
      support.elevation,
    )
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

  /**
   * Per-slab RENDERED polygon cache (`getRenderableSlabPolygon`). Item
   * support queries run per frame and the projection scans the level's
   * walls + sibling slabs, so the result is cached per slab id and
   * dropped for the whole level whenever a slab or wall on that level
   * flows through the manager's create/update/delete handlers.
   */
  private readonly renderedSlabPolygons = new Map<string, Array<[number, number]>>()

  private invalidateRenderedSlabPolygons(levelId: string) {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) return
    for (const slabId of slabMap.keys()) this.renderedSlabPolygons.delete(slabId)
  }

  /**
   * True while a slab or wall on `levelId` has a live preview: group drags
   * publish translated slab polygons and wall endpoints to
   * `useLiveNodeOverrides`, and the slab move tool / room-preset stamp
   * publish a translation DELTA to `useLiveTransforms` — either way the
   * scene store commits only on release, so the committed cache and index
   * would elect support against pre-drag footprints (items and walls
   * visibly drop to ground mid-preview). Support queries then read
   * live-effective records and skip the rendered-polygon cache.
   */
  private levelHasLivePreview(levelId: string): boolean {
    const nodes = useScene.getState().nodes
    const structuralOnLevel = (id: string) => {
      const node = nodes[id as AnyNodeId]
      if (!node || (node.type !== 'slab' && node.type !== 'wall')) return false
      return resolveNodeLevelId(node, nodes) === levelId
    }
    const overrides = useLiveNodeOverrides.getState().overrides
    for (const id of overrides.keys()) {
      if (structuralOnLevel(id)) return true
    }
    const transforms = useLiveTransforms.getState().transforms
    for (const id of transforms.keys()) {
      if (structuralOnLevel(id)) return true
    }
    return false
  }

  /**
   * The live-effective slab record: field overrides merged, then the
   * `useLiveTransforms` DELTA (slab publishers — move tool, room-preset
   * stamp — store a translation, not an absolute position) applied to the
   * polygon, holes, and elevation. Mapping happens exactly ONCE at each
   * public query's loop entry: `slabSupportsFootprint` /
   * `getRenderedSlabPolygon` take the already-effective record and must
   * never re-map, or the delta would apply twice.
   */
  private effectiveSlabRecord(slab: SlabNode): SlabNode {
    let effective = getEffectiveNode(slab)
    const live = useLiveTransforms.getState().get(slab.id)
    if (live) {
      const [dx, dy, dz] = live.position
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        effective = {
          ...effective,
          polygon: effective.polygon.map(([x, z]) => [x + dx, z + dz] as [number, number]),
          holes: (effective.holes || []).map((hole) =>
            hole.map(([x, z]) => [x + dx, z + dz] as [number, number]),
          ),
          elevation: (effective.elevation ?? 0.05) + dy,
        }
      }
    }
    return effective
  }

  private getRenderedSlabPolygon(levelId: string, slab: SlabNode): Array<[number, number]> {
    const live = this.levelHasLivePreview(levelId)
    if (!live) {
      const cached = this.renderedSlabPolygons.get(slab.id)
      if (cached) return cached
    }

    const siblingSlabs: SlabNode[] = []
    for (const other of this.getSlabMap(levelId).values()) {
      if (other.id !== slab.id) siblingSlabs.push(live ? this.effectiveSlabRecord(other) : other)
    }
    const walls = this.getLevelWallNodes(levelId)
    const polygon = getRenderableSlabPolygon(slab, {
      walls: live ? walls.map((wall) => getEffectiveNode(wall)) : walls,
      siblingSlabs,
    })
    if (!live) this.renderedSlabPolygons.set(slab.id, polygon)
    return polygon
  }

  /**
   * Support test shared by election, candidate listing, and persisted-host
   * validation: the footprint overlaps the slab's RENDERED polygon (what
   * users see — matching the wall election in `computeWallSlabSupport`),
   * with the center-point hole veto kept against the stored holes (holes
   * are data, never render-offset).
   */
  private slabSupportsFootprint(
    levelId: string,
    slab: SlabNode,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ): boolean {
    if (slab.polygon.length < 3) return false
    const rendered = this.getRenderedSlabPolygon(levelId, slab)
    if (!itemOverlapsPolygon(position, dimensions, rotation, rendered, 0.01)) return false

    const [cx, , cz] = position
    for (const hole of slab.holes || []) {
      if (hole.length >= 3 && pointInPolygon(cx, cz, hole)) return false
    }
    return true
  }

  // Called when nodes change
  handleNodeCreated(node: AnyNode, levelId: string) {
    if (node.type === 'slab') {
      this.getSlabMap(levelId).set(node.id, node as SlabNode)
      this.invalidateRenderedSlabPolygons(levelId)
    } else if (node.type === 'ceiling') {
      this.ceilings.set(node.id, node as CeilingNode)
    } else if (node.type === 'wall') {
      const wall = node as WallNode
      this.walls.set(wall.id, wall)
      // Rendered slab polygons adopt wall bands — a new wall can extend them.
      this.invalidateRenderedSlabPolygons(levelId)
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
      this.invalidateRenderedSlabPolygons(levelId)
    } else if (node.type === 'ceiling') {
      this.ceilings.set(node.id, node as CeilingNode)
    } else if (node.type === 'wall') {
      const wall = node as WallNode
      this.walls.set(wall.id, wall)
      this.invalidateRenderedSlabPolygons(levelId)
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
      // Invalidate before removal so the deleted slab's own cache entry
      // (still keyed in the level map here) is dropped with its siblings'.
      this.invalidateRenderedSlabPolygons(levelId)
      this.getSlabMap(levelId).delete(nodeId)
    } else if (nodeType === 'ceiling') {
      this.ceilings.delete(nodeId)
      this.ceilingGrids.delete(nodeId)
    } else if (nodeType === 'wall') {
      this.walls.delete(nodeId)
      this.invalidateRenderedSlabPolygons(levelId)
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
    return this.canPlaceOnFloorFootprints(levelId, [{ position, dimensions, rotation }], ignoreIds)
  }

  canPlaceOnFloorFootprints(
    levelId: string,
    footprints: readonly {
      position: [number, number, number]
      dimensions: [number, number, number]
      rotation: [number, number, number]
    }[],
    ignoreIds?: string[],
  ) {
    const nodes = useScene.getState().nodes
    const ignoreSet = expandIgnoredNodeIds(ignoreIds, nodes)
    const draftBounds = footprints.map((footprint) =>
      footprintBoundsXZ(footprint.position, footprint.dimensions, footprint.rotation[1] ?? 0),
    )
    for (let i = 0; i < draftBounds.length; i += 1) {
      const a = draftBounds[i]!
      for (let j = i + 1; j < draftBounds.length; j += 1) {
        const b = draftBounds[j]!
        if (
          intervalsOverlap(a.minX, a.maxX, b.minX, b.maxX) &&
          intervalsOverlap(a.minZ, a.maxZ, b.minZ, b.maxZ)
        ) {
          return { valid: false, conflictIds: [] }
        }
      }
    }

    // A floor placement conflicts with any other COLLIDING floor-resting node,
    // not just items — every kind whose `floorPlaced.collides` is set (item /
    // shelf / column / cabinet / stair) contributes its footprint(s) as an
    // obstacle. Each candidate's XZ extent is read from the same declarative
    // footprint the elevation + sync paths use, so adding a colliding kind
    // needs no change here.
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
          draftBounds.some(
            (draft) =>
              intervalsOverlap(draft.minX, draft.maxX, bounds.minX, bounds.maxX) &&
              intervalsOverlap(draft.minZ, draft.maxZ, bounds.minZ, bounds.maxZ),
          )
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
    for (const stored of slabMap.values()) {
      const slab = this.effectiveSlabRecord(stored)
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
   * Thin wrapper over {@link getSlabSupportForItem} for callers (and tests)
   * that only need the number.
   */
  getSlabElevationForItem(
    levelId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    maxElevation?: number | null,
  ): number {
    return this.getSlabSupportForItem(levelId, position, dimensions, rotation, maxElevation)
      .elevation
  }

  /**
   * Elect the supporting slab for a footprint: the highest-elevation slab
   * whose RENDERED polygon the footprint overlaps (center-point hole veto
   * applies). Returns `{ elevation: 0, slabId: null }` when nothing
   * overlaps.
   *
   * `maxElevation` is the pointer-decided cap: when set, only slabs whose
   * walking surface sits at or below `maxElevation +
   * SUPPORT_ELEVATION_EPSILON` may win — a deck hanging above the surface
   * the cursor ray actually hit never captures the election.
   */
  getSlabSupportForItem(
    levelId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    maxElevation?: number | null,
  ): ItemSlabSupport {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) return { elevation: 0, slabId: null }

    let winningElevation = Number.NEGATIVE_INFINITY
    let winnerId: string | null = null
    for (const stored of slabMap.values()) {
      const slab = this.effectiveSlabRecord(stored)
      const elevation = slab.elevation ?? 0.05
      if (maxElevation != null && elevation > maxElevation + SUPPORT_ELEVATION_EPSILON) continue
      if (!this.slabSupportsFootprint(levelId, slab, position, dimensions, rotation)) continue
      if (elevation > winningElevation) {
        winningElevation = elevation
        winnerId = slab.id
      }
    }
    return winnerId === null
      ? { elevation: 0, slabId: null }
      : { elevation: winningElevation, slabId: winnerId }
  }

  /**
   * The walking surface the pointer actually points at: the nearest slab
   * plane the ray crosses INSIDE that slab's rendered polygon (hole veto
   * applies), or the level base (`elevation: 0, slabId: null`) when it
   * crosses none. Ray origin/direction are level-local. Deliberately a
   * point test, not a footprint test — it answers "which surface is under
   * the cursor", which then caps the footprint election so a deck hanging
   * above the aimed-at floor never lifts the placement. `point` is the
   * ray's crossing of that surface's plane — the stable plan point
   * callers should elect/preview at (see {@link PointedSupportSurface}).
   */
  getPointedSupportSurface(
    levelId: string,
    rayOrigin: [number, number, number],
    rayDirection: [number, number, number],
  ): PointedSupportSurface {
    const slabMap = this.slabsByLevel.get(levelId)
    const [ox, oy, oz] = rayOrigin
    const [dx, dy, dz] = rayDirection
    if (Math.abs(dy) < 1e-9) return { elevation: 0, slabId: null, point: null }

    let best: { t: number; elevation: number; slabId: string } | null = null
    if (slabMap) {
      for (const stored of slabMap.values()) {
        const slab = this.effectiveSlabRecord(stored)
        if (slab.polygon.length < 3) continue
        const elevation = slab.elevation ?? 0.05
        const t = (elevation - oy) / dy
        if (t <= 0) continue
        if (best && t >= best.t) continue
        const x = ox + dx * t
        const z = oz + dz * t
        const rendered = this.getRenderedSlabPolygon(levelId, slab)
        if (rendered.length < 3 || !pointInPolygon(x, z, rendered)) continue
        let inHole = false
        for (const hole of slab.holes || []) {
          if (hole.length >= 3 && pointInPolygon(x, z, hole)) {
            inHole = true
            break
          }
        }
        if (inHole) continue
        best = { t, elevation, slabId: slab.id }
      }
    }
    if (best) {
      return {
        elevation: best.elevation,
        slabId: best.slabId,
        point: [ox + dx * best.t, oz + dz * best.t],
      }
    }
    const tBase = -oy / dy
    return {
      elevation: 0,
      slabId: null,
      point: tBase > 0 ? [ox + dx * tBase, oz + dz * tBase] : null,
    }
  }

  /**
   * All slabs supporting a footprint, one entry per overlapping slab
   * (highest elevation first; slab id breaks ties deterministically).
   * Commit-side ambiguity check: persist a `supportSlabId` only when the
   * candidates carry ≥ 2 distinct elevations.
   */
  getSupportCandidatesForFootprint(
    levelId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ): SlabSupportCandidate[] {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) return []

    const candidates: SlabSupportCandidate[] = []
    for (const stored of slabMap.values()) {
      const slab = this.effectiveSlabRecord(stored)
      if (!this.slabSupportsFootprint(levelId, slab, position, dimensions, rotation)) continue
      candidates.push({ slabId: slab.id, elevation: slab.elevation ?? 0.05 })
    }
    candidates.sort(
      (a, b) =>
        b.elevation - a.elevation || (a.slabId < b.slabId ? -1 : a.slabId > b.slabId ? 1 : 0),
    )
    return candidates
  }

  /**
   * Elevation of a persisted support host for a footprint, or null when
   * the slab no longer exists on the level or no longer overlaps the
   * footprint (same overlap test as election). Deliberately read-only: a
   * host reshaped away is NOT cleared — callers fall back to election and
   * the stale reference resumes hosting if the slab's polygon returns.
   * Slab deletion is the only writer (`deleteNodesAction` strips it).
   */
  getHostSlabElevationForFootprint(
    levelId: string,
    slabId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ): number | null {
    const stored = this.slabsByLevel.get(levelId)?.get(slabId)
    if (!stored) return null
    const slab = this.effectiveSlabRecord(stored)
    if (!this.slabSupportsFootprint(levelId, slab, position, dimensions, rotation)) return null
    return slab.elevation ?? 0.05
  }

  /**
   * Get the slab elevation for a wall by checking if it overlaps with any slab polygon (excluding holes).
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
    preferredSlabId?: string | null,
  ): number {
    return this.getSlabSupportForWall(levelId, start, end, curveOffset, thickness, preferredSlabId)
      .elevation
  }

  getSlabSupportForWall(
    levelId: string,
    start: [number, number],
    end: [number, number],
    curveOffset = 0,
    thickness = DEFAULT_WALL_THICKNESS,
    preferredSlabId?: string | null,
    maxElevation?: number | null,
  ): WallSlabSupport {
    const slabMap = this.slabsByLevel.get(levelId)
    if (!slabMap) {
      return {
        elevation: 0,
        electedSlabId: null,
        baseElevation: 0,
        baseSegments: [{ start: 0, end: 1, elevation: 0 }],
      }
    }

    return computeWallSlabSupport(
      { start, end, curveOffset, thickness },
      [...slabMap.values()].map((slab) => this.effectiveSlabRecord(slab)),
      this.getLevelWallNodes(levelId).map((wall) => getEffectiveNode(wall)),
      preferredSlabId,
      maxElevation,
    )
  }

  /**
   * Walls on a level, resolved fresh from the scene store (the manager's
   * own wall map is only maintained on create/delete, not on updates).
   * Cached per scene `nodes` record so per-pointer-tick callers
   * (door/window move) don't rescan the node map.
   */
  private readonly levelWallsCache = new WeakMap<object, Map<string, WallNode[]>>()

  private getLevelWallNodes(levelId: string): WallNode[] {
    const nodes = useScene.getState().nodes
    let byLevel = this.levelWallsCache.get(nodes)
    if (!byLevel) {
      byLevel = new Map()
      this.levelWallsCache.set(nodes, byLevel)
    }
    const cached = byLevel.get(levelId)
    if (cached) return cached

    const walls: WallNode[] = []
    for (const node of Object.values(nodes)) {
      if (node.type !== 'wall') continue
      // Walk the parent chain to the owning level (guarded against cycles).
      let current: AnyNode | undefined = node
      let guard = 0
      while (current && current.type !== 'level' && guard < 16) {
        current = current.parentId ? nodes[current.parentId as AnyNode['id']] : undefined
        guard += 1
      }
      if (current?.type === 'level' && current.id === levelId) {
        walls.push(node as WallNode)
      }
    }
    byLevel.set(levelId, walls)
    return walls
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
    this.invalidateRenderedSlabPolygons(levelId)
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
    this.renderedSlabPolygons.clear()
  }
}

// Singleton instance
export const spatialGridManager = new SpatialGridManager()

/**
 * Effective (extruded) height of a wall resolved from a nodes record:
 * {@link resolveWallEffectiveHeight} over the covering-clamped plane top
 * (`getWallPlaneTop`) and the singleton manager's slab election — so the
 * value always agrees with the rendered wall. One shared resolver for the
 * editor overlays (measurement label, action menu, side handles) that used
 * to copy this derivation locally.
 */
export function getWallEffectiveHeightForNodes(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
): number {
  const levelId = resolveNodeLevelId(wall, nodes)
  const support = spatialGridManager.getSlabSupportForWall(
    levelId,
    wall.start,
    wall.end,
    wall.curveOffset ?? 0,
    wall.thickness,
    wall.supportSlabId ?? null,
  )
  return resolveWallEffectiveHeight(wall, getWallPlaneTop(wall, levelId, nodes), support.elevation)
}
