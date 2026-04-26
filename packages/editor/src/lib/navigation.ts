'use client'

import {
  type AnyNode,
  type BuildingNode,
  type CeilingNode,
  calculateLevelMiters,
  getScaledDimensions,
  getWallPlanFootprint,
  type ItemNode,
  type LevelNode,
  type Point2D,
  type SlabNode,
  type StairNode,
  type StairSegmentNode,
  type WallNode,
} from '@pascal-app/core'
import { measureNavigationPerf } from './navigation-performance'
import {
  buildWalkableStairSurfaceEntries,
  buildWalkableSurfaceOverlay,
  collectLevelDescendants,
  getDoorPortalPolygon,
  getItemPlanTransform,
  getRotatedRectanglePolygon,
  getSlabSurfaceY,
  getWallAttachedItemDoorOpening,
  isFloorBlockingItem,
  isPointInsideDoorPortal,
  toWalkablePlanPolygon,
  WALKABLE_CELL_SIZE,
  WALKABLE_CLEARANCE,
  type WalkableSurfaceCell,
  type WallOverlayDebugCell,
} from './walkable-surface'

const DEFAULT_LEVEL_HEIGHT = 2.5
const NAV_MAX_STEP_HEIGHT = 0.4
const NAV_NEIGHBOR_RADIUS = 1
const NAV_SNAP_RADIUS_CELLS = 2
const NAV_STAIR_TRANSITION_RADIUS_CELLS = 7
const NAV_STAIR_TRANSITION_MAX_HORIZONTAL_DISTANCE = 1.5
const NAV_STAIR_TOP_HEIGHT_TOLERANCE = 0.45
const NAV_LINE_OF_SIGHT_SAMPLE_STEP = WALKABLE_CELL_SIZE * 0.45
const NAV_LINE_OF_SIGHT_SEARCH_RADIUS_CELLS = 1
const NAV_LINE_OF_SIGHT_HEIGHT_TOLERANCE = Math.max(0.22, WALKABLE_CELL_SIZE * 1.15)
const NAV_PORTAL_RELIEF_EPSILON = WALKABLE_CELL_SIZE * 0.08

// The walkable surface is already eroded by this radius, so valid nav points are
// valid robot-center positions for this footprint.
export const NAVIGATION_AGENT_RADIUS = WALKABLE_CLEARANCE

const NAV_DOOR_GROUP_AXIS_ALIGNMENT_DOT = 0.98
const NAV_DOOR_GROUP_GAP_TOLERANCE = Math.max(
  WALKABLE_CELL_SIZE * 0.75,
  NAVIGATION_AGENT_RADIUS * 0.9,
)
const NAV_DOOR_ENTRY_OFFSET = Math.max(WALKABLE_CELL_SIZE * 0.9, NAVIGATION_AGENT_RADIUS * 1.05)

export type NavigationCell = {
  cellIndex: number
  center: [number, number, number]
  cornerHeights: [number, number, number, number]
  gridX: number
  gridY: number
  levelId: LevelNode['id']
  localCenter: Point2D
  surfaceType: 'floor' | 'stair'
}

type NavigationCellSeed = Omit<NavigationCell, 'cellIndex'>

export type NavigationGraph = {
  adjacency: number[][]
  cellSize: number
  cells: NavigationCell[]
  cellsByLevel: Map<LevelNode['id'], number[]>
  cellIndicesByKey: Map<string, number[]>
  collisionByLevel: Map<LevelNode['id'], NavigationCollisionLevel>
  componentIdByCell: Int32Array
  components: number[][]
  doorBridgeEdgeCount: number
  doorBridgeEdges: NavigationDoorBridgeEdge[]
  doorOpenings: NavigationDoorOpening[]
  doorPortals: NavigationDoorPortal[]
  doorPortalCount: number
  largestComponentId: number
  largestComponentSize: number
  levelBaseYById: Map<LevelNode['id'], number>
  obstacleBlockedCellsByLevel: Map<LevelNode['id'], NavigationCellSeed[]>
  stairTransitionEdgeCount: number
  stairSurfaceCount: number
  wallDebugCellsByLevel: Map<LevelNode['id'], WallOverlayDebugCell[]>
  wallBlockedCellsByLevel: Map<LevelNode['id'], WalkableSurfaceCell[]>
  walkableCellCount: number
}

export type NavigationPathResult = {
  cost: number
  elapsedMs: number
  indices: number[]
}

type NavigationLevelResult = {
  cells: NavigationCell[]
  collision: NavigationCollisionLevel
  doorPortals: NavigationDoorPortal[]
  doorPortalCount: number
  obstacleBlockedCells: NavigationCellSeed[]
  stairSurfaceCount: number
  wallDebugCells: WallOverlayDebugCell[]
  wallBlockedCells: WalkableSurfaceCell[]
  walkableCellCount: number
}

type NavigationBuildOptions = {
  includeDoorPortals?: boolean
}

export type NavigationDoorPortal = {
  center: Point2D
  depthAxis: Point2D
  doorId: string
  halfDepth: number
  halfWidth: number
  levelId: LevelNode['id']
  openingId: string
  passageHalfDepth: number
  polygon: Point2D[]
  wallId: string
  widthAxis: Point2D
}

export type NavigationDoorOpening = {
  center: Point2D
  depthAxis: Point2D
  doorIds: string[]
  halfDepth: number
  halfWidth: number
  levelId: LevelNode['id']
  openingId: string
  passageHalfDepth: number
  polygon: Point2D[]
  wallId: string
  widthAxis: Point2D
}

export type NavigationDoorBridgeEdge = {
  cellIndexA: number
  cellIndexB: number
  doorId: string
  openingId: string
}

export type NavigationDoorTransition = {
  approachWorld: [number, number, number]
  departureWorld: [number, number, number]
  doorIds: string[]
  entryWorld: [number, number, number]
  exitWorld: [number, number, number]
  fromCellIndex: number
  fromPathIndex: number
  openingId: string
  pathPosition: number
  progress: number
  toCellIndex: number
  toPathIndex: number
  world: [number, number, number]
}

export type NavigationCollisionPolygonSample = {
  bounds: { maxX: number; maxY: number; minX: number; minY: number }
  levelId: LevelNode['id']
  polygon: Point2D[]
  sourceId: string
  wallId?: string
}

export type NavigationCollisionLevel = {
  obstacleSamples: NavigationCollisionPolygonSample[]
  portalSamples: NavigationCollisionPolygonSample[]
  wallSamples: NavigationCollisionPolygonSample[]
}

export type NavigationPointBlockers = {
  obstacleIds: string[]
  wallIds: string[]
}

type SearchState = {
  cameFrom: Int32Array
  closed: Uint8Array
  fScore: Float64Array
  gScore: Float64Array
}

type NavigationPathCellSample = {
  cellIndex: number
  cumulativeDistance: number
  pathPosition: number
}

type NavigationPathSegmentSample = {
  cumulativeDistance: number
  fromCellIndex: number
  length: number
  pathPosition: number
  toCellIndex: number
}

class MinHeap {
  private heap: Array<{ node: number; score: number }> = []

  get size() {
    return this.heap.length
  }

  push(node: number, score: number) {
    this.heap.push({ node, score })
    this.bubbleUp(this.heap.length - 1)
  }

  pop() {
    if (this.heap.length === 0) {
      return null
    }

    const first = this.heap[0]
    const last = this.heap.pop()

    if (last && this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }

    return first ?? null
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const entry = this.heap[index]
      const parent = this.heap[parentIndex]

      if (!(entry && parent) || entry.score >= parent.score) {
        break
      }

      this.heap[index] = parent
      this.heap[parentIndex] = entry
      index = parentIndex
    }
  }

  private bubbleDown(index: number) {
    const length = this.heap.length

    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      let smallestIndex = index

      const current = this.heap[smallestIndex]
      const left = this.heap[leftIndex]
      const right = this.heap[rightIndex]

      if (left && current && left.score < current.score) {
        smallestIndex = leftIndex
      }

      const smallest = this.heap[smallestIndex]
      if (right && smallest && right.score < smallest.score) {
        smallestIndex = rightIndex
      }

      if (smallestIndex === index) {
        break
      }

      const next = this.heap[smallestIndex]
      if (!(current && next)) {
        break
      }

      this.heap[index] = next
      this.heap[smallestIndex] = current
      index = smallestIndex
    }
  }
}

function getApproxLevelHeight(level: LevelNode, nodes: Record<string, AnyNode>): number {
  let maxTop = 0

  for (const childId of level.children) {
    const child = nodes[childId]
    if (!child) {
      continue
    }

    if (child.type === 'ceiling') {
      maxTop = Math.max(maxTop, (child as CeilingNode).height ?? DEFAULT_LEVEL_HEIGHT)
      continue
    }

    if (child.type === 'wall') {
      maxTop = Math.max(maxTop, child.height ?? DEFAULT_LEVEL_HEIGHT)
    }
  }

  return maxTop > 0 ? maxTop : DEFAULT_LEVEL_HEIGHT
}

function getTargetBuilding(
  nodes: Record<string, AnyNode>,
  rootNodeIds: string[],
  buildingId?: BuildingNode['id'] | null,
): BuildingNode | null {
  if (buildingId) {
    const explicitBuilding = nodes[buildingId]
    if (explicitBuilding?.type === 'building') {
      return explicitBuilding
    }
  }

  const rootNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null
  if (rootNode?.type === 'site') {
    const firstBuilding = rootNode.children
      .map((child) => (typeof child === 'string' ? nodes[child] : child))
      .find((node): node is BuildingNode => node?.type === 'building')

    return firstBuilding ?? null
  }

  return (
    Object.values(nodes).find((node): node is BuildingNode => node?.type === 'building') ?? null
  )
}

function getSortedBuildingLevels(
  nodes: Record<string, AnyNode>,
  rootNodeIds: string[],
  buildingId?: BuildingNode['id'] | null,
): LevelNode[] {
  const building = getTargetBuilding(nodes, rootNodeIds, buildingId)
  if (!building) {
    return []
  }

  return building.children
    .map((childId) => nodes[childId])
    .filter((node): node is LevelNode => node?.type === 'level')
    .sort((left, right) => left.level - right.level)
}

function getLevelBaseYById(levels: LevelNode[], nodes: Record<string, AnyNode>) {
  const levelBaseYById = new Map<LevelNode['id'], number>()
  let cumulativeY = 0

  for (const level of levels) {
    levelBaseYById.set(level.id, cumulativeY)
    cumulativeY += getApproxLevelHeight(level, nodes)
  }

  return levelBaseYById
}

function getLevelNavigationResult(
  level: LevelNode,
  nodes: Record<string, AnyNode>,
  levelBaseY: number,
  options: NavigationBuildOptions = {},
): NavigationLevelResult {
  const includeDoorPortals = options.includeDoorPortals ?? true
  const walls = level.children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
  const slabs = level.children
    .map((childId) => nodes[childId])
    .filter((node): node is SlabNode => node?.type === 'slab')
  const levelDescendantNodes = measureNavigationPerf('navigation.build.levelDescendantsMs', () =>
    collectLevelDescendants(level, nodes),
  )
  const levelDescendantNodeById = new Map(
    levelDescendantNodes.map((node) => [node.id, node] as const),
  )
  const wallById = new Map(walls.map((wall) => [wall.id, wall] as const))
  const wallMiterData = calculateLevelMiters(walls)
  const wallSamples = measureNavigationPerf('navigation.build.wallSamplesMs', () =>
    walls.flatMap((wall) => {
      const polygon = getWallPlanFootprint(wall, wallMiterData)
      return polygon.length >= 3
        ? [
            {
              bounds: getPolygonBounds(polygon),
              levelId: level.id,
              polygon,
              sourceId: wall.id,
              wallId: wall.id,
            } satisfies NavigationCollisionPolygonSample,
          ]
        : []
    }),
  )
  const wallPolygons = wallSamples.map(({ polygon }) => polygon)
  const slabPolygons = measureNavigationPerf('navigation.build.slabPolygonsMs', () =>
    slabs.flatMap((slab) => {
      const polygon = toWalkablePlanPolygon(slab.polygon)
      if (polygon.length < 3) {
        return []
      }

      const holes = (slab.holes ?? [])
        .map((hole) => toWalkablePlanPolygon(hole))
        .filter((hole) => hole.length >= 3)

      return [
        {
          polygon,
          holes,
          surfaceY: getSlabSurfaceY(slab),
        },
      ]
    }),
  )
  const stairSurfacePolygons = measureNavigationPerf(
    'navigation.build.stairSurfacePolygonsMs',
    () =>
      levelDescendantNodes.flatMap((node) => {
        if (node.type !== 'stair' || node.visible === false) {
          return []
        }

        const segments = (node.children ?? [])
          .map((childId) => levelDescendantNodeById.get(childId))
          .filter(
            (childNode): childNode is StairSegmentNode =>
              childNode?.type === 'stair-segment' && childNode.visible !== false,
          )

        return buildWalkableStairSurfaceEntries(node as StairNode, segments)
      }),
  )
  const itemTransformCache = new Map<string, ReturnType<typeof getItemPlanTransform>>()
  const doorPortalPolygons = measureNavigationPerf('navigation.build.doorPortalPolygonsMs', () =>
    includeDoorPortals
      ? levelDescendantNodes.flatMap((node) => {
          if (node.visible === false || !node.parentId) {
            return []
          }

          const wall = wallById.get(node.parentId as WallNode['id'])
          if (!wall) {
            return []
          }

          const opening =
            node.type === 'door'
              ? node
              : node.type === 'item'
                ? getWallAttachedItemDoorOpening(
                    node as ItemNode,
                    wall,
                    levelDescendantNodeById,
                    itemTransformCache,
                  )
                : null
          if (!opening) {
            return []
          }

          const polygon = getDoorPortalPolygon(wall, opening, WALKABLE_CLEARANCE)
          return polygon.length >= 3
            ? [
                {
                  doorId: node.id,
                  polygon,
                  wallId: wall.id,
                },
              ]
            : []
        })
      : [],
  )
  const portalSamples = measureNavigationPerf('navigation.build.portalSamplesMs', () =>
    doorPortalPolygons
      .map(({ doorId, polygon, wallId }) => ({
        bounds: getPolygonBounds(polygon),
        levelId: level.id,
        polygon,
        sourceId: doorId,
        wallId,
      }))
      .filter(
        ({ bounds, polygon }) =>
          polygon.length >= 3 &&
          Number.isFinite(bounds.minX) &&
          Number.isFinite(bounds.maxX) &&
          Number.isFinite(bounds.minY) &&
          Number.isFinite(bounds.maxY),
      ),
  )
  const doorPortals = measureNavigationPerf('navigation.build.doorPortalsMs', () =>
    doorPortalPolygons.flatMap(({ doorId, polygon, wallId }) => {
      const first = polygon[0]
      const second = polygon[1]
      const third = polygon[2]
      if (!(first && second && third)) {
        return []
      }

      const widthVector = {
        x: second.x - first.x,
        y: second.y - first.y,
      }
      const depthVector = {
        x: third.x - second.x,
        y: third.y - second.y,
      }
      const widthLength = Math.hypot(widthVector.x, widthVector.y)
      const depthLength = Math.hypot(depthVector.x, depthVector.y)

      if (widthLength <= Number.EPSILON || depthLength <= Number.EPSILON) {
        return []
      }

      return [
        {
          center: {
            x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
            y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
          },
          depthAxis: {
            x: depthVector.x / depthLength,
            y: depthVector.y / depthLength,
          },
          doorId,
          halfDepth: depthLength / 2,
          halfWidth: widthLength / 2,
          levelId: level.id,
          openingId: doorId,
          passageHalfDepth: Math.max(
            (wallById.get(wallId)?.thickness ?? 0.1) / 2,
            WALKABLE_CELL_SIZE * 0.25,
          ),
          polygon,
          wallId,
          widthAxis: {
            x: widthVector.x / widthLength,
            y: widthVector.y / widthLength,
          },
        },
      ]
    }),
  )
  const obstacleSamples = measureNavigationPerf('navigation.build.obstacleSamplesMs', () =>
    levelDescendantNodes.flatMap((node) => {
      if (
        node.type !== 'item' ||
        node.visible === false ||
        node.asset.category === 'door' ||
        node.asset.category === 'window' ||
        !isFloorBlockingItem(node as ItemNode, levelDescendantNodeById)
      ) {
        return []
      }

      const transform = getItemPlanTransform(
        node as ItemNode,
        levelDescendantNodeById,
        itemTransformCache,
      )
      if (!transform) {
        return []
      }

      const [width, , depth] = getScaledDimensions(node as ItemNode)
      const polygon = getRotatedRectanglePolygon(
        transform.position,
        width,
        depth,
        transform.rotation,
      )

      return polygon.length >= 3
        ? [
            {
              bounds: getPolygonBounds(polygon),
              levelId: level.id,
              polygon,
              sourceId: node.id,
            } satisfies NavigationCollisionPolygonSample,
          ]
        : []
    }),
  )
  const obstaclePolygons = obstacleSamples.map(({ polygon }) => polygon)

  const overlay = measureNavigationPerf('navigation.build.walkableOverlayMs', () =>
    buildWalkableSurfaceOverlay(
      [...slabPolygons, ...stairSurfacePolygons],
      wallPolygons,
      obstaclePolygons,
      WALKABLE_CELL_SIZE,
      WALKABLE_CLEARANCE,
      doorPortalPolygons.map(({ polygon }) => polygon),
    ),
  )

  if (!overlay) {
    return {
      cells: [],
      collision: {
        obstacleSamples,
        portalSamples,
        wallSamples,
      },
      doorPortals,
      doorPortalCount: doorPortalPolygons.length,
      obstacleBlockedCells: [],
      stairSurfaceCount: stairSurfacePolygons.length,
      wallDebugCells: [],
      wallBlockedCells: [],
      walkableCellCount: 0,
    }
  }

  const createNavigationCellSeed = (cell: WalkableSurfaceCell): NavigationCellSeed => {
    const localCenter = {
      x: cell.x + cell.width / 2,
      y: cell.y + cell.height / 2,
    }

    return {
      center: [localCenter.x, levelBaseY + cell.surfaceY, localCenter.y] as [
        number,
        number,
        number,
      ],
      cornerHeights: [
        levelBaseY + cell.cornerSurfaceY[0],
        levelBaseY + cell.cornerSurfaceY[1],
        levelBaseY + cell.cornerSurfaceY[2],
        levelBaseY + cell.cornerSurfaceY[3],
      ] as [number, number, number, number],
      gridX: Math.round(cell.x / WALKABLE_CELL_SIZE),
      gridY: Math.round(cell.y / WALKABLE_CELL_SIZE),
      levelId: level.id,
      localCenter,
      surfaceType: (stairSurfacePolygons.some(({ polygon }) =>
        isPointInsidePolygon(localCenter, polygon),
      )
        ? 'stair'
        : 'floor') as NavigationCell['surfaceType'],
    }
  }

  const cells: NavigationCell[] = measureNavigationPerf('navigation.build.levelCellsMs', () =>
    overlay.cells.map((cell, cellOffset) => ({
      ...createNavigationCellSeed(cell),
      cellIndex: cellOffset,
    })),
  )
  const obstacleBlockedCells = measureNavigationPerf(
    'navigation.build.obstacleBlockedCellsMs',
    () => overlay.obstacleBlockedCells.map(createNavigationCellSeed),
  )

  return {
    cells,
    collision: {
      obstacleSamples,
      portalSamples,
      wallSamples,
    },
    doorPortals,
    doorPortalCount: doorPortalPolygons.length,
    obstacleBlockedCells,
    stairSurfaceCount: stairSurfacePolygons.length,
    wallDebugCells: overlay.wallDebugCells,
    wallBlockedCells: overlay.wallBlockedCells,
    walkableCellCount: overlay.cellCount,
  }
}

function getCellDistance(a: NavigationCell, b: NavigationCell) {
  return Math.hypot(b.center[0] - a.center[0], b.center[1] - a.center[1], b.center[2] - a.center[2])
}

type NavigationSegmentAppendOptions = {
  endWorldAnchor?: [number, number, number]
  startWorldAnchor?: [number, number, number]
}

function buildNavigationPathSamples(graph: NavigationGraph, pathIndices: number[]) {
  const cells: NavigationPathCellSample[] = []
  const segments: NavigationPathSegmentSample[] = []
  let cumulativeDistance = 0

  for (let index = 0; index < pathIndices.length - 1; index += 1) {
    const fromCellIndex = pathIndices[index]
    const toCellIndex = pathIndices[index + 1]
    if (fromCellIndex === undefined || toCellIndex === undefined) {
      continue
    }

    if (cells.length === 0) {
      cells.push({
        cellIndex: fromCellIndex,
        cumulativeDistance: 0,
        pathPosition: index,
      })
    }

    const fromCell = graph.cells[fromCellIndex]
    const toCell = graph.cells[toCellIndex]
    if (!(fromCell && toCell)) {
      continue
    }

    const length = getCellDistance(fromCell, toCell)
    if (length <= Number.EPSILON) {
      continue
    }

    segments.push({
      cumulativeDistance,
      fromCellIndex,
      length,
      pathPosition: index + 0.5,
      toCellIndex,
    })
    cumulativeDistance += length
    cells.push({
      cellIndex: toCellIndex,
      cumulativeDistance,
      pathPosition: index + 1,
    })
  }

  return {
    cells,
    segments,
    totalLength: cumulativeDistance,
  }
}

function getPolygonBounds(points: Point2D[]) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
  }
}

function isPointInsideBounds(
  point: Point2D,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  margin = 0,
) {
  return (
    point.x >= bounds.minX - margin &&
    point.x <= bounds.maxX + margin &&
    point.y >= bounds.minY - margin &&
    point.y <= bounds.maxY + margin
  )
}

function isPointInsidePolygon(point: Point2D, polygon: Point2D[]) {
  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]
    const prior = polygon[previous]

    if (!(current && prior)) {
      continue
    }

    const intersects =
      current.y > point.y !== prior.y > point.y &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function getDistanceToLineSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  )

  return Math.hypot(point.x - (start.x + dx * projection), point.y - (start.y + dy * projection))
}

function getPolygonBoundaryDistance(point: Point2D, polygon: Point2D[]): number {
  if (polygon.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  let minDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]

    if (!(start && end)) {
      continue
    }

    minDistance = Math.min(minDistance, getDistanceToLineSegment(point, start, end))
  }

  return minDistance
}

function getBlockingCollisionSampleIds(
  point: Point2D,
  radius: number,
  samples: NavigationCollisionPolygonSample[],
) {
  const ids: string[] = []

  for (const sample of samples) {
    if (!isCollisionSampleBlockingPoint(point, radius, sample)) {
      continue
    }

    ids.push(sample.sourceId)
  }

  return ids
}

function isCollisionSampleBlockingPoint(
  point: Point2D,
  radius: number,
  sample: NavigationCollisionPolygonSample,
) {
  return (
    isPointInsideBounds(point, sample.bounds, radius) &&
    (isPointInsidePolygon(point, sample.polygon) ||
      getPolygonBoundaryDistance(point, sample.polygon) < radius)
  )
}

function getOpenPortalWallIdsAtPoint(collision: NavigationCollisionLevel, point: Point2D) {
  let openWallIds: Set<string> | null = null

  for (const portalSample of collision.portalSamples) {
    const wallId = portalSample.wallId
    if (
      !wallId ||
      !isPointInsideBounds(point, portalSample.bounds, NAV_PORTAL_RELIEF_EPSILON) ||
      !isPointInsideDoorPortal(point, portalSample.polygon, {
        depthEpsilon: NAV_PORTAL_RELIEF_EPSILON,
      })
    ) {
      continue
    }

    if (!openWallIds) {
      openWallIds = new Set<string>()
    }

    openWallIds.add(wallId)
  }

  return openWallIds
}

function hasBlockingCollisionSample(
  point: Point2D,
  radius: number,
  samples: NavigationCollisionPolygonSample[],
  openWallIds: Set<string> | null = null,
) {
  for (const sample of samples) {
    if (sample.wallId && openWallIds?.has(sample.wallId)) {
      continue
    }

    if (isCollisionSampleBlockingPoint(point, radius, sample)) {
      return true
    }
  }

  return false
}

function hasNavigationPointBlockers(
  graph: NavigationGraph,
  point: [number, number, number],
  levelId: LevelNode['id'] | null,
  radius = NAVIGATION_AGENT_RADIUS,
) {
  if (!levelId) {
    return false
  }

  const collision = graph.collisionByLevel.get(levelId)
  if (!collision) {
    return false
  }

  const planPoint = {
    x: point[0],
    y: point[2],
  }
  const openWallIds = getOpenPortalWallIdsAtPoint(collision, planPoint)

  return (
    hasBlockingCollisionSample(planPoint, radius, collision.wallSamples, openWallIds) ||
    hasBlockingCollisionSample(planPoint, radius, collision.obstacleSamples)
  )
}

export function getNavigationPointBlockers(
  graph: NavigationGraph,
  point: [number, number, number],
  levelId: LevelNode['id'] | null,
  radius = NAVIGATION_AGENT_RADIUS,
): NavigationPointBlockers {
  if (!levelId) {
    return {
      obstacleIds: [],
      wallIds: [],
    }
  }

  const collision = graph.collisionByLevel.get(levelId)
  if (!collision) {
    return {
      obstacleIds: [],
      wallIds: [],
    }
  }

  const planPoint = {
    x: point[0],
    y: point[2],
  }
  const openWallIds = getOpenPortalWallIdsAtPoint(collision, planPoint)
  const wallIds: string[] = []

  for (const wallSample of collision.wallSamples) {
    if (wallSample.wallId && openWallIds?.has(wallSample.wallId)) {
      continue
    }

    if (!isCollisionSampleBlockingPoint(planPoint, radius, wallSample)) {
      continue
    }

    wallIds.push(wallSample.sourceId)
  }

  const obstacleIds = getBlockingCollisionSampleIds(planPoint, radius, collision.obstacleSamples)

  return {
    obstacleIds,
    wallIds,
  }
}

function getCellKey(gridX: number, gridY: number) {
  return `${gridX},${gridY}`
}

function getCellBounds(cell: NavigationCell, cellSize: number) {
  const halfCell = cellSize / 2
  return {
    maxX: cell.center[0] + halfCell,
    maxZ: cell.center[2] + halfCell,
    minX: cell.center[0] - halfCell,
    minZ: cell.center[2] - halfCell,
  }
}

function getCellSurfaceHeightAtPoint(
  cell: NavigationCell,
  pointX: number,
  pointZ: number,
  cellSize: number,
) {
  const bounds = getCellBounds(cell, cellSize)
  const u = Math.max(0, Math.min(1, (pointX - bounds.minX) / cellSize))
  const v = Math.max(0, Math.min(1, (pointZ - bounds.minZ) / cellSize))
  const [h00, h10, h11, h01] = cell.cornerHeights

  return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h11 * u * v + h01 * (1 - u) * v
}

function dotPlan(a: Point2D, b: Point2D) {
  return a.x * b.x + a.y * b.y
}

function buildDoorOpeningPolygon(
  center: Point2D,
  widthAxis: Point2D,
  depthAxis: Point2D,
  halfWidth: number,
  halfDepth: number,
): Point2D[] {
  return [
    {
      x: center.x - widthAxis.x * halfWidth + depthAxis.x * halfDepth,
      y: center.y - widthAxis.y * halfWidth + depthAxis.y * halfDepth,
    },
    {
      x: center.x + widthAxis.x * halfWidth + depthAxis.x * halfDepth,
      y: center.y + widthAxis.y * halfWidth + depthAxis.y * halfDepth,
    },
    {
      x: center.x + widthAxis.x * halfWidth - depthAxis.x * halfDepth,
      y: center.y + widthAxis.y * halfWidth - depthAxis.y * halfDepth,
    },
    {
      x: center.x - widthAxis.x * halfWidth - depthAxis.x * halfDepth,
      y: center.y - widthAxis.y * halfWidth - depthAxis.y * halfDepth,
    },
  ]
}

function groupDoorPortals(doorPortals: NavigationDoorPortal[]) {
  if (doorPortals.length === 0) {
    return {
      doorOpenings: [] as NavigationDoorOpening[],
      groupedDoorPortals: [] as NavigationDoorPortal[],
    }
  }

  const groupedDoorPortals: NavigationDoorPortal[] = []
  const doorOpenings: NavigationDoorOpening[] = []
  const portalsByWall = new Map<string, NavigationDoorPortal[]>()

  for (const doorPortal of doorPortals) {
    const key = `${doorPortal.levelId}:${doorPortal.wallId}`
    const bucket = portalsByWall.get(key)
    if (bucket) {
      bucket.push(doorPortal)
    } else {
      portalsByWall.set(key, [doorPortal])
    }
  }

  for (const wallPortals of portalsByWall.values()) {
    const referencePortal = wallPortals[0]
    if (!referencePortal) {
      continue
    }

    const widthAxis = referencePortal.widthAxis
    const depthAxis = referencePortal.depthAxis
    const origin = referencePortal.center
    const sortedPortals = [...wallPortals]
      .map((portal) => {
        const localOffset = {
          x: portal.center.x - origin.x,
          y: portal.center.y - origin.y,
        }

        return {
          portal,
          depthDot: Math.abs(dotPlan(portal.depthAxis, depthAxis)),
          depthMin: dotPlan(localOffset, depthAxis) - portal.halfDepth,
          depthMax: dotPlan(localOffset, depthAxis) + portal.halfDepth,
          widthDot: Math.abs(dotPlan(portal.widthAxis, widthAxis)),
          widthMin: dotPlan(localOffset, widthAxis) - portal.halfWidth,
          widthMax: dotPlan(localOffset, widthAxis) + portal.halfWidth,
        }
      })
      .sort((left, right) => left.widthMin - right.widthMin)

    let activeGroup: typeof sortedPortals = []
    let groupWidthMin = 0
    let groupWidthMax = 0
    let groupDepthMin = 0
    let groupDepthMax = 0

    const flushActiveGroup = () => {
      if (activeGroup.length === 0) {
        return
      }

      const doorIds = activeGroup.map(({ portal }) => portal.doorId)
      const centerWidth = (groupWidthMin + groupWidthMax) / 2
      const centerDepth = (groupDepthMin + groupDepthMax) / 2
      const center = {
        x: origin.x + widthAxis.x * centerWidth + depthAxis.x * centerDepth,
        y: origin.y + widthAxis.y * centerWidth + depthAxis.y * centerDepth,
      }
      const openingId = doorIds.join('|')
      const opening: NavigationDoorOpening = {
        center,
        depthAxis,
        doorIds,
        halfDepth: Math.max(WALKABLE_CELL_SIZE, (groupDepthMax - groupDepthMin) / 2),
        halfWidth: Math.max(WALKABLE_CELL_SIZE, (groupWidthMax - groupWidthMin) / 2),
        levelId: referencePortal.levelId,
        openingId,
        passageHalfDepth: Math.max(
          ...activeGroup.map(({ portal }) => portal.passageHalfDepth),
          WALKABLE_CELL_SIZE * 0.25,
        ),
        polygon: buildDoorOpeningPolygon(
          center,
          widthAxis,
          depthAxis,
          Math.max(WALKABLE_CELL_SIZE, (groupWidthMax - groupWidthMin) / 2),
          Math.max(WALKABLE_CELL_SIZE, (groupDepthMax - groupDepthMin) / 2),
        ),
        wallId: referencePortal.wallId,
        widthAxis,
      }

      doorOpenings.push(opening)
      groupedDoorPortals.push(
        ...activeGroup.map(({ portal }) => ({
          ...portal,
          openingId,
        })),
      )

      activeGroup = []
    }

    for (const candidate of sortedPortals) {
      const startsNewGroup =
        activeGroup.length === 0 ||
        candidate.widthDot < NAV_DOOR_GROUP_AXIS_ALIGNMENT_DOT ||
        candidate.depthDot < NAV_DOOR_GROUP_AXIS_ALIGNMENT_DOT ||
        candidate.widthMin - groupWidthMax > NAV_DOOR_GROUP_GAP_TOLERANCE ||
        candidate.depthMin - groupDepthMax > WALKABLE_CELL_SIZE * 0.5 ||
        groupDepthMin - candidate.depthMax > WALKABLE_CELL_SIZE * 0.5

      if (startsNewGroup) {
        flushActiveGroup()
        activeGroup = [candidate]
        groupWidthMin = candidate.widthMin
        groupWidthMax = candidate.widthMax
        groupDepthMin = candidate.depthMin
        groupDepthMax = candidate.depthMax
        continue
      }

      activeGroup.push(candidate)
      groupWidthMin = Math.min(groupWidthMin, candidate.widthMin)
      groupWidthMax = Math.max(groupWidthMax, candidate.widthMax)
      groupDepthMin = Math.min(groupDepthMin, candidate.depthMin)
      groupDepthMax = Math.max(groupDepthMax, candidate.depthMax)
    }

    flushActiveGroup()
  }

  return {
    doorOpenings,
    groupedDoorPortals,
  }
}

function hasSupportingNavigationCellAtPoint(
  graph: NavigationGraph,
  point: [number, number, number],
  componentId: number | null = null,
) {
  const [x, y, z] = point
  const gridX = Math.round((x - graph.cellSize / 2) / graph.cellSize)
  const gridY = Math.round((z - graph.cellSize / 2) / graph.cellSize)
  const cellBoundsTolerance = graph.cellSize * 0.08
  const pointClearByLevelId = new Map<LevelNode['id'], boolean>()

  for (
    let offsetX = -NAV_LINE_OF_SIGHT_SEARCH_RADIUS_CELLS;
    offsetX <= NAV_LINE_OF_SIGHT_SEARCH_RADIUS_CELLS;
    offsetX += 1
  ) {
    for (
      let offsetY = -NAV_LINE_OF_SIGHT_SEARCH_RADIUS_CELLS;
      offsetY <= NAV_LINE_OF_SIGHT_SEARCH_RADIUS_CELLS;
      offsetY += 1
    ) {
      const candidateIndices = graph.cellIndicesByKey.get(
        getCellKey(gridX + offsetX, gridY + offsetY),
      )
      if (!candidateIndices) {
        continue
      }

      for (const candidateIndex of candidateIndices) {
        const candidate = graph.cells[candidateIndex]
        if (!candidate) {
          continue
        }

        if (
          componentId !== null &&
          componentId !== undefined &&
          graph.componentIdByCell[candidateIndex] !== componentId
        ) {
          continue
        }

        const bounds = getCellBounds(candidate, graph.cellSize)
        if (
          x < bounds.minX - cellBoundsTolerance ||
          x > bounds.maxX + cellBoundsTolerance ||
          z < bounds.minZ - cellBoundsTolerance ||
          z > bounds.maxZ + cellBoundsTolerance
        ) {
          continue
        }

        const surfaceHeight = getCellSurfaceHeightAtPoint(candidate, x, z, graph.cellSize)
        if (Math.abs(surfaceHeight - y) <= NAV_LINE_OF_SIGHT_HEIGHT_TOLERANCE) {
          let isPointClear = pointClearByLevelId.get(candidate.levelId)
          if (isPointClear === undefined) {
            isPointClear = !hasNavigationPointBlockers(graph, point, candidate.levelId)
            pointClearByLevelId.set(candidate.levelId, isPointClear)
          }

          if (isPointClear) {
            return true
          }
        }
      }
    }
  }

  return false
}

export function isNavigationPointSupported(
  graph: NavigationGraph,
  point: [number, number, number],
  componentId: number | null = null,
) {
  return hasSupportingNavigationCellAtPoint(graph, point, componentId)
}

function hasNavigationWorldLineOfSight(
  graph: NavigationGraph,
  startPoint: [number, number, number],
  endPoint: [number, number, number],
  componentId: number | null = null,
) {
  const distance = Math.hypot(
    endPoint[0] - startPoint[0],
    endPoint[1] - startPoint[1],
    endPoint[2] - startPoint[2],
  )
  const sampleCount = Math.max(2, Math.ceil(distance / NAV_LINE_OF_SIGHT_SAMPLE_STEP))

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const t = sampleIndex / sampleCount
    const samplePoint: [number, number, number] = [
      startPoint[0] + (endPoint[0] - startPoint[0]) * t,
      startPoint[1] + (endPoint[1] - startPoint[1]) * t,
      startPoint[2] + (endPoint[2] - startPoint[2]) * t,
    ]

    if (!isNavigationPointSupported(graph, samplePoint, componentId)) {
      return false
    }
  }

  return true
}

function hasNavigationLineOfSight(
  graph: NavigationGraph,
  startCellIndex: number,
  endCellIndex: number,
) {
  const startCell = graph.cells[startCellIndex]
  const endCell = graph.cells[endCellIndex]
  if (!(startCell && endCell)) {
    return false
  }

  const componentId = graph.componentIdByCell[startCellIndex]
  if (componentId === undefined) {
    return false
  }

  if (componentId !== graph.componentIdByCell[endCellIndex]) {
    return false
  }

  return hasNavigationWorldLineOfSight(graph, startCell.center, endCell.center, componentId)
}

function hasSupportCellForDiagonal(
  sourceCell: NavigationCell,
  gridX: number,
  gridY: number,
  cellIndicesByKey: Map<string, number[]>,
  cells: NavigationCell[],
) {
  const bucket = cellIndicesByKey.get(getCellKey(gridX, gridY))
  if (!bucket) {
    return false
  }

  return bucket.some((candidateIndex) => {
    const candidate = cells[candidateIndex]
    if (!candidate) {
      return false
    }

    if (candidate.levelId !== sourceCell.levelId) {
      return false
    }

    return Math.abs(candidate.center[1] - sourceCell.center[1]) <= NAV_MAX_STEP_HEIGHT
  })
}

function connectNavigationCellNeighbors(
  cell: NavigationCell,
  adjacency: number[][],
  cellIndicesByKey: Map<string, number[]>,
  cells: NavigationCell[],
) {
  for (let offsetX = -NAV_NEIGHBOR_RADIUS; offsetX <= NAV_NEIGHBOR_RADIUS; offsetX += 1) {
    for (let offsetY = -NAV_NEIGHBOR_RADIUS; offsetY <= NAV_NEIGHBOR_RADIUS; offsetY += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue
      }

      const neighborKey = getCellKey(cell.gridX + offsetX, cell.gridY + offsetY)
      const bucket = cellIndicesByKey.get(neighborKey)
      if (!bucket) {
        continue
      }

      if (offsetX !== 0 && offsetY !== 0) {
        const hasHorizontalSupport = hasSupportCellForDiagonal(
          cell,
          cell.gridX + offsetX,
          cell.gridY,
          cellIndicesByKey,
          cells,
        )
        const hasVerticalSupport = hasSupportCellForDiagonal(
          cell,
          cell.gridX,
          cell.gridY + offsetY,
          cellIndicesByKey,
          cells,
        )

        if (!(hasHorizontalSupport && hasVerticalSupport)) {
          continue
        }
      }

      for (const neighborIndex of bucket) {
        if (neighborIndex === cell.cellIndex) {
          continue
        }

        const neighbor = cells[neighborIndex]
        if (!neighbor) {
          continue
        }

        const verticalDelta = Math.abs(neighbor.center[1] - cell.center[1])
        if (verticalDelta > NAV_MAX_STEP_HEIGHT) {
          continue
        }

        const horizontalDelta = Math.hypot(
          neighbor.center[0] - cell.center[0],
          neighbor.center[2] - cell.center[2],
        )
        if (horizontalDelta > WALKABLE_CELL_SIZE * Math.SQRT2 + 1e-6) {
          continue
        }

        const currentNeighbors = adjacency[cell.cellIndex]
        const neighborNeighbors = adjacency[neighborIndex]
        if (!(currentNeighbors && neighborNeighbors)) {
          continue
        }

        if (!currentNeighbors.includes(neighborIndex)) {
          currentNeighbors.push(neighborIndex)
          neighborNeighbors.push(cell.cellIndex)
        }
      }
    }
  }
}

function connectDoorPortalCells(
  adjacency: number[][],
  cells: NavigationCell[],
  doorPortals: NavigationDoorPortal[],
  cellSize: number,
) {
  let doorBridgeEdgeCount = 0
  const doorBridgeEdges: NavigationDoorBridgeEdge[] = []
  const sideThreshold = cellSize * 0.12
  const widthTolerance = cellSize * 1.25

  for (const doorPortal of doorPortals) {
    const bridgeEdgeCountBeforePortal = doorBridgeEdgeCount
    const maxBridgeDistance = Math.max(
      cellSize * 2.7,
      Math.min(cellSize * 3.3, doorPortal.halfDepth * 1.25),
    )
    const bounds = getPolygonBounds(doorPortal.polygon)
    const candidateCells = cells
      .filter((cell) => cell.levelId === doorPortal.levelId)
      .flatMap((cell) => {
        const centerPoint = { x: cell.center[0], y: cell.center[2] }
        const isCandidate =
          isPointInsideBounds(centerPoint, bounds, cellSize * 0.5) &&
          (isPointInsidePolygon(centerPoint, doorPortal.polygon) ||
            getPolygonBoundaryDistance(centerPoint, doorPortal.polygon) <= cellSize * 0.75)

        if (!isCandidate) {
          return []
        }

        const localOffset = {
          x: centerPoint.x - doorPortal.center.x,
          y: centerPoint.y - doorPortal.center.y,
        }

        return [
          {
            cellIndex: cell.cellIndex,
            depthCoord:
              localOffset.x * doorPortal.depthAxis.x + localOffset.y * doorPortal.depthAxis.y,
            widthCoord:
              localOffset.x * doorPortal.widthAxis.x + localOffset.y * doorPortal.widthAxis.y,
          },
        ]
      })
    const negativeSideCells = candidateCells.filter((cell) => cell.depthCoord <= -sideThreshold)
    const positiveSideCells = candidateCells.filter((cell) => cell.depthCoord >= sideThreshold)

    if (negativeSideCells.length === 0 || positiveSideCells.length === 0) {
      continue
    }

    const connectPair = (sourceIndex: number, neighborIndex: number) => {
      const neighborNeighbors = adjacency[neighborIndex]
      const currentNeighbors = adjacency[sourceIndex]

      if (!(currentNeighbors && neighborNeighbors)) {
        return
      }

      if (!currentNeighbors.includes(neighborIndex)) {
        currentNeighbors.push(neighborIndex)
        neighborNeighbors.push(sourceIndex)
        doorBridgeEdgeCount += 1
        doorBridgeEdges.push({
          cellIndexA: Math.min(sourceIndex, neighborIndex),
          cellIndexB: Math.max(sourceIndex, neighborIndex),
          doorId: doorPortal.doorId,
          openingId: doorPortal.openingId,
        })
      }
    }

    const bestCenterlinePair = negativeSideCells
      .flatMap((source) => {
        const currentCell = cells[source.cellIndex]
        if (!currentCell) {
          return []
        }

        return positiveSideCells
          .map((target) => {
            const neighborCell = cells[target.cellIndex]
            if (!neighborCell) {
              return null
            }

            const planarDistance = Math.hypot(
              neighborCell.center[0] - currentCell.center[0],
              neighborCell.center[2] - currentCell.center[2],
            )
            const verticalDelta = Math.abs(neighborCell.center[1] - currentCell.center[1])

            if (verticalDelta > NAV_MAX_STEP_HEIGHT || planarDistance > maxBridgeDistance) {
              return null
            }

            const centerlineBias = Math.abs(source.widthCoord) + Math.abs(target.widthCoord)
            const widthDelta = Math.abs(target.widthCoord - source.widthCoord)
            const mirroredDepthDelta = Math.abs(
              Math.abs(target.depthCoord) - Math.abs(source.depthCoord),
            )

            return {
              neighborIndex: target.cellIndex,
              score:
                centerlineBias * 2.4 +
                widthDelta * 0.75 +
                mirroredDepthDelta * 0.7 +
                planarDistance * 0.12,
              sourceIndex: source.cellIndex,
            }
          })
          .filter(
            (
              entry,
            ): entry is {
              neighborIndex: number
              score: number
              sourceIndex: number
            } => Boolean(entry),
          )
      })
      .sort((left, right) => left.score - right.score)[0]

    if (bestCenterlinePair) {
      connectPair(bestCenterlinePair.sourceIndex, bestCenterlinePair.neighborIndex)
    }

    if (doorBridgeEdgeCount !== bridgeEdgeCountBeforePortal) {
      continue
    }

    for (const source of negativeSideCells) {
      const currentCell = cells[source.cellIndex]
      if (!currentCell) {
        continue
      }

      const oppositeMatches = positiveSideCells
        .filter((target) => Math.abs(target.widthCoord - source.widthCoord) <= widthTolerance)
        .map((target) => {
          const neighborCell = cells[target.cellIndex]
          if (!neighborCell) {
            return null
          }

          const mirroredDepthDelta = Math.abs(target.depthCoord + source.depthCoord)
          if (mirroredDepthDelta > cellSize * 0.9) {
            return null
          }

          const planarDistance = Math.hypot(
            neighborCell.center[0] - currentCell.center[0],
            neighborCell.center[2] - currentCell.center[2],
          )
          const verticalDelta = Math.abs(neighborCell.center[1] - currentCell.center[1])

          if (verticalDelta > NAV_MAX_STEP_HEIGHT || planarDistance > maxBridgeDistance) {
            return null
          }

          return {
            cellIndex: target.cellIndex,
            score:
              Math.abs(target.widthCoord - source.widthCoord) +
              mirroredDepthDelta * 0.35 +
              planarDistance * 0.18,
          }
        })
        .filter((entry): entry is { cellIndex: number; score: number } => Boolean(entry))
        .sort((left, right) => left.score - right.score)
        .slice(0, 2)

      for (const target of oppositeMatches) {
        connectPair(source.cellIndex, target.cellIndex)
      }
    }

    if (doorBridgeEdgeCount !== bridgeEdgeCountBeforePortal) {
      continue
    }

    const fallbackPairCandidates = negativeSideCells
      .flatMap((source) => {
        const currentCell = cells[source.cellIndex]
        if (!currentCell) {
          return []
        }

        return positiveSideCells
          .map((target) => {
            const neighborCell = cells[target.cellIndex]
            if (!neighborCell) {
              return null
            }

            const planarDistance = Math.hypot(
              neighborCell.center[0] - currentCell.center[0],
              neighborCell.center[2] - currentCell.center[2],
            )
            const verticalDelta = Math.abs(neighborCell.center[1] - currentCell.center[1])

            if (verticalDelta > NAV_MAX_STEP_HEIGHT || planarDistance > maxBridgeDistance) {
              return null
            }

            const widthDelta = Math.abs(target.widthCoord - source.widthCoord)
            const mirroredDepthDelta = Math.abs(
              Math.abs(target.depthCoord) - Math.abs(source.depthCoord),
            )
            const centerlineBias = Math.abs(source.widthCoord) + Math.abs(target.widthCoord)

            return {
              neighborIndex: target.cellIndex,
              score:
                widthDelta * 1.35 +
                mirroredDepthDelta * 0.45 +
                centerlineBias * 0.65 +
                planarDistance * 0.12,
              sourceIndex: source.cellIndex,
            }
          })
          .filter(
            (
              entry,
            ): entry is {
              neighborIndex: number
              score: number
              sourceIndex: number
            } => Boolean(entry),
          )
      })
      .sort((left, right) => left.score - right.score)

    if (fallbackPairCandidates.length === 0) {
      continue
    }

    const usedSourceIndices = new Set<number>()
    const usedNeighborIndices = new Set<number>()
    const fallbackPairLimit = Math.max(
      1,
      Math.min(
        2,
        negativeSideCells.length,
        positiveSideCells.length,
        Math.round((doorPortal.halfWidth * 2) / cellSize),
      ),
    )

    for (const pair of fallbackPairCandidates) {
      if (usedSourceIndices.has(pair.sourceIndex) || usedNeighborIndices.has(pair.neighborIndex)) {
        continue
      }

      connectPair(pair.sourceIndex, pair.neighborIndex)
      usedSourceIndices.add(pair.sourceIndex)
      usedNeighborIndices.add(pair.neighborIndex)

      if (usedSourceIndices.size >= fallbackPairLimit) {
        break
      }
    }
  }

  return {
    doorBridgeEdgeCount,
    doorBridgeEdges,
  }
}

function connectStairTransitionCells(
  adjacency: number[][],
  cells: NavigationCell[],
  cellIndicesByKey: Map<string, number[]>,
) {
  let stairTransitionEdgeCount = 0
  const stairTopHeightByLevel = new Map<LevelNode['id'], number>()

  for (const cell of cells) {
    if (cell.surfaceType !== 'stair') {
      continue
    }

    const currentTopHeight = stairTopHeightByLevel.get(cell.levelId) ?? Number.NEGATIVE_INFINITY
    if (cell.center[1] > currentTopHeight) {
      stairTopHeightByLevel.set(cell.levelId, cell.center[1])
    }
  }

  const connectPair = (sourceIndex: number, neighborIndex: number) => {
    const currentNeighbors = adjacency[sourceIndex]
    const neighborNeighbors = adjacency[neighborIndex]

    if (!(currentNeighbors && neighborNeighbors)) {
      return
    }

    if (!currentNeighbors.includes(neighborIndex)) {
      currentNeighbors.push(neighborIndex)
      neighborNeighbors.push(sourceIndex)
      stairTransitionEdgeCount += 1
    }
  }

  for (const cell of cells) {
    if (cell.surfaceType !== 'stair') {
      continue
    }

    const levelTopHeight = stairTopHeightByLevel.get(cell.levelId)
    if (
      levelTopHeight === undefined ||
      levelTopHeight - cell.center[1] > NAV_STAIR_TOP_HEIGHT_TOLERANCE
    ) {
      continue
    }

    for (
      let offsetX = -NAV_STAIR_TRANSITION_RADIUS_CELLS;
      offsetX <= NAV_STAIR_TRANSITION_RADIUS_CELLS;
      offsetX += 1
    ) {
      for (
        let offsetY = -NAV_STAIR_TRANSITION_RADIUS_CELLS;
        offsetY <= NAV_STAIR_TRANSITION_RADIUS_CELLS;
        offsetY += 1
      ) {
        const candidateIndices =
          cellIndicesByKey.get(getCellKey(cell.gridX + offsetX, cell.gridY + offsetY)) ?? []

        for (const candidateIndex of candidateIndices) {
          if (candidateIndex === cell.cellIndex) {
            continue
          }

          const candidate = cells[candidateIndex]
          if (!(candidate && candidate.levelId !== cell.levelId)) {
            continue
          }

          const verticalDelta = Math.abs(candidate.center[1] - cell.center[1])
          if (verticalDelta > NAV_MAX_STEP_HEIGHT) {
            continue
          }

          const horizontalDelta = Math.hypot(
            candidate.center[0] - cell.center[0],
            candidate.center[2] - cell.center[2],
          )
          if (horizontalDelta > NAV_STAIR_TRANSITION_MAX_HORIZONTAL_DISTANCE) {
            continue
          }

          connectPair(cell.cellIndex, candidateIndex)
        }
      }
    }
  }

  return stairTransitionEdgeCount
}

function computeConnectedComponents(adjacency: number[][]) {
  const componentIdByCell = new Int32Array(adjacency.length)
  componentIdByCell.fill(-1)

  const components: number[][] = []
  let largestComponentId = -1
  let largestComponentSize = 0

  for (let cellIndex = 0; cellIndex < adjacency.length; cellIndex += 1) {
    if (componentIdByCell[cellIndex] !== -1) {
      continue
    }

    const componentId = components.length
    const stack = [cellIndex]
    const component: number[] = []
    componentIdByCell[cellIndex] = componentId

    while (stack.length > 0) {
      const currentIndex = stack.pop()
      if (currentIndex === undefined) {
        continue
      }

      component.push(currentIndex)

      for (const neighborIndex of adjacency[currentIndex] ?? []) {
        if (componentIdByCell[neighborIndex] !== -1) {
          continue
        }

        componentIdByCell[neighborIndex] = componentId
        stack.push(neighborIndex)
      }
    }

    components.push(component)

    if (component.length > largestComponentSize) {
      largestComponentId = componentId
      largestComponentSize = component.length
    }
  }

  return {
    componentIdByCell,
    components,
    largestComponentId,
    largestComponentSize,
  }
}

export function buildNavigationGraph(
  nodes: Record<string, AnyNode>,
  rootNodeIds: string[],
  buildingId?: BuildingNode['id'] | null,
  options: NavigationBuildOptions = {},
): NavigationGraph | null {
  const levels = measureNavigationPerf('navigation.build.levelsMs', () =>
    getSortedBuildingLevels(nodes, rootNodeIds, buildingId),
  )
  if (levels.length === 0) {
    return null
  }

  const levelBaseYById = measureNavigationPerf('navigation.build.levelBaseYMs', () =>
    getLevelBaseYById(levels, nodes),
  )
  const cells: NavigationCell[] = []
  const cellsByLevel = new Map<LevelNode['id'], number[]>()
  const collisionByLevel = new Map<LevelNode['id'], NavigationCollisionLevel>()
  const doorPortals: NavigationDoorPortal[] = []
  const obstacleBlockedCellsByLevel = new Map<LevelNode['id'], NavigationCellSeed[]>()
  const wallDebugCellsByLevel = new Map<LevelNode['id'], WallOverlayDebugCell[]>()
  const wallBlockedCellsByLevel = new Map<LevelNode['id'], WalkableSurfaceCell[]>()
  let doorPortalCount = 0
  let stairSurfaceCount = 0
  let walkableCellCount = 0

  measureNavigationPerf('navigation.build.levelResultsMs', () => {
    for (const level of levels) {
      const levelBaseY = levelBaseYById.get(level.id) ?? 0
      const levelResult = getLevelNavigationResult(level, nodes, levelBaseY, options)
      collisionByLevel.set(level.id, levelResult.collision)
      obstacleBlockedCellsByLevel.set(level.id, levelResult.obstacleBlockedCells)
      wallDebugCellsByLevel.set(level.id, levelResult.wallDebugCells)
      wallBlockedCellsByLevel.set(level.id, levelResult.wallBlockedCells)
      doorPortalCount += levelResult.doorPortalCount
      stairSurfaceCount += levelResult.stairSurfaceCount
      walkableCellCount += levelResult.walkableCellCount
      doorPortals.push(...levelResult.doorPortals)

      const levelCellIndices: number[] = []
      for (const levelCell of levelResult.cells) {
        const cellIndex = cells.length
        cells.push({
          ...levelCell,
          cellIndex,
        })
        levelCellIndices.push(cellIndex)
      }
      cellsByLevel.set(level.id, levelCellIndices)
    }
  })

  if (cells.length === 0) {
    return null
  }

  const { doorOpenings, groupedDoorPortals } = measureNavigationPerf(
    'navigation.build.groupDoorPortalsMs',
    () => groupDoorPortals(doorPortals),
  )

  const cellIndicesByKey = measureNavigationPerf('navigation.build.cellIndicesByKeyMs', () => {
    const nextCellIndicesByKey = new Map<string, number[]>()
    for (const cell of cells) {
      const key = getCellKey(cell.gridX, cell.gridY)
      const bucket = nextCellIndicesByKey.get(key)
      if (bucket) {
        bucket.push(cell.cellIndex)
      } else {
        nextCellIndicesByKey.set(key, [cell.cellIndex])
      }
    }
    return nextCellIndicesByKey
  })

  const adjacency = Array.from({ length: cells.length }, () => [] as number[])

  measureNavigationPerf('navigation.build.adjacencyMs', () => {
    for (const cell of cells) {
      for (let offsetX = -NAV_NEIGHBOR_RADIUS; offsetX <= NAV_NEIGHBOR_RADIUS; offsetX += 1) {
        for (let offsetY = -NAV_NEIGHBOR_RADIUS; offsetY <= NAV_NEIGHBOR_RADIUS; offsetY += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue
          }

          const neighborKey = getCellKey(cell.gridX + offsetX, cell.gridY + offsetY)
          const bucket = cellIndicesByKey.get(neighborKey)
          if (!bucket) {
            continue
          }

          if (offsetX !== 0 && offsetY !== 0) {
            const hasHorizontalSupport = hasSupportCellForDiagonal(
              cell,
              cell.gridX + offsetX,
              cell.gridY,
              cellIndicesByKey,
              cells,
            )
            const hasVerticalSupport = hasSupportCellForDiagonal(
              cell,
              cell.gridX,
              cell.gridY + offsetY,
              cellIndicesByKey,
              cells,
            )

            if (!(hasHorizontalSupport && hasVerticalSupport)) {
              continue
            }
          }

          for (const neighborIndex of bucket) {
            if (neighborIndex <= cell.cellIndex) {
              continue
            }

            const neighbor = cells[neighborIndex]
            if (!neighbor) {
              continue
            }

            const verticalDelta = Math.abs(neighbor.center[1] - cell.center[1])
            if (verticalDelta > NAV_MAX_STEP_HEIGHT) {
              continue
            }

            const horizontalDelta = Math.hypot(
              neighbor.center[0] - cell.center[0],
              neighbor.center[2] - cell.center[2],
            )
            if (horizontalDelta > WALKABLE_CELL_SIZE * Math.SQRT2 + 1e-6) {
              continue
            }

            adjacency[cell.cellIndex]?.push(neighborIndex)
            adjacency[neighborIndex]?.push(cell.cellIndex)
          }
        }
      }
    }
  })

  const { doorBridgeEdgeCount, doorBridgeEdges } = measureNavigationPerf(
    'navigation.build.doorBridgeMs',
    () => connectDoorPortalCells(adjacency, cells, groupedDoorPortals, WALKABLE_CELL_SIZE),
  )
  const stairTransitionEdgeCount = measureNavigationPerf('navigation.build.stairTransitionMs', () =>
    connectStairTransitionCells(adjacency, cells, cellIndicesByKey),
  )

  const { componentIdByCell, components, largestComponentId, largestComponentSize } =
    measureNavigationPerf('navigation.build.connectedComponentsMs', () =>
      computeConnectedComponents(adjacency),
    )

  return {
    adjacency,
    cellSize: WALKABLE_CELL_SIZE,
    cells,
    cellsByLevel,
    cellIndicesByKey,
    collisionByLevel,
    componentIdByCell,
    components,
    doorBridgeEdgeCount,
    doorBridgeEdges,
    doorOpenings,
    doorPortals: groupedDoorPortals,
    doorPortalCount,
    largestComponentId,
    largestComponentSize,
    levelBaseYById,
    obstacleBlockedCellsByLevel,
    stairTransitionEdgeCount,
    stairSurfaceCount,
    wallDebugCellsByLevel,
    wallBlockedCellsByLevel,
    walkableCellCount,
  }
}

export function deriveNavigationGraphWithoutObstacles(
  graph: NavigationGraph,
  obstacleIds: Iterable<string>,
): NavigationGraph {
  const removedObstacleIds = new Set(
    Array.from(obstacleIds).filter((obstacleId): obstacleId is string => obstacleId.length > 0),
  )
  if (removedObstacleIds.size === 0) {
    return graph
  }

  const collisionByLevel = new Map<LevelNode['id'], NavigationCollisionLevel>()
  const touchedLevels = new Set<LevelNode['id']>()
  const removedSamplesByLevel = new Map<LevelNode['id'], NavigationCollisionPolygonSample[]>()

  for (const [levelId, collision] of graph.collisionByLevel) {
    const removedSamples = collision.obstacleSamples.filter((sample) =>
      removedObstacleIds.has(sample.sourceId),
    )
    removedSamplesByLevel.set(levelId, removedSamples)

    if (removedSamples.length === 0) {
      collisionByLevel.set(levelId, collision)
      continue
    }

    touchedLevels.add(levelId)
    collisionByLevel.set(levelId, {
      ...collision,
      obstacleSamples: collision.obstacleSamples.filter(
        (sample) => !removedObstacleIds.has(sample.sourceId),
      ),
    })
  }

  if (touchedLevels.size === 0) {
    return graph
  }

  const cells = graph.cells.slice()
  const adjacency = graph.adjacency.map((neighbors) => neighbors.slice())
  const cellsByLevel = new Map(
    Array.from(
      graph.cellsByLevel,
      ([levelId, cellIndices]) => [levelId, cellIndices.slice()] as const,
    ),
  )
  const cellIndicesByKey = new Map(
    Array.from(graph.cellIndicesByKey, ([key, cellIndices]) => [key, cellIndices.slice()] as const),
  )
  const restoredCellIndices: number[] = []

  for (const levelId of touchedLevels) {
    const collision = collisionByLevel.get(levelId)
    const removedSamples = removedSamplesByLevel.get(levelId) ?? []
    const obstacleBlockedCells = graph.obstacleBlockedCellsByLevel.get(levelId) ?? []

    if (!(collision && removedSamples.length > 0 && obstacleBlockedCells.length > 0)) {
      continue
    }

    for (const blockedCell of obstacleBlockedCells) {
      const existingCellIndices = cellIndicesByKey.get(
        getCellKey(blockedCell.gridX, blockedCell.gridY),
      )
      if (
        existingCellIndices?.some((cellIndex) => {
          const existingCell = cells[cellIndex]
          return existingCell?.levelId === blockedCell.levelId
        })
      ) {
        continue
      }

      if (
        !removedSamples.some((sample) =>
          isCollisionSampleBlockingPoint(blockedCell.localCenter, NAVIGATION_AGENT_RADIUS, sample),
        )
      ) {
        continue
      }

      const openWallIds = getOpenPortalWallIdsAtPoint(collision, blockedCell.localCenter)
      if (
        hasBlockingCollisionSample(
          blockedCell.localCenter,
          NAVIGATION_AGENT_RADIUS,
          collision.wallSamples,
          openWallIds,
        ) ||
        hasBlockingCollisionSample(
          blockedCell.localCenter,
          NAVIGATION_AGENT_RADIUS,
          collision.obstacleSamples,
        )
      ) {
        continue
      }

      const cellIndex = cells.length
      const restoredCell: NavigationCell = {
        ...blockedCell,
        cellIndex,
      }
      cells.push(restoredCell)
      adjacency.push([])
      restoredCellIndices.push(cellIndex)

      const levelCellIndices = cellsByLevel.get(levelId)
      if (levelCellIndices) {
        levelCellIndices.push(cellIndex)
      } else {
        cellsByLevel.set(levelId, [cellIndex])
      }

      const cellKey = getCellKey(restoredCell.gridX, restoredCell.gridY)
      const keyedCellIndices = cellIndicesByKey.get(cellKey)
      if (keyedCellIndices) {
        keyedCellIndices.push(cellIndex)
      } else {
        cellIndicesByKey.set(cellKey, [cellIndex])
      }
    }
  }

  if (restoredCellIndices.length === 0) {
    return {
      ...graph,
      collisionByLevel,
    }
  }

  for (const cellIndex of restoredCellIndices) {
    const cell = cells[cellIndex]
    if (!cell) {
      continue
    }

    connectNavigationCellNeighbors(cell, adjacency, cellIndicesByKey, cells)
  }

  const newDoorBridgeEdges = connectDoorPortalCells(
    adjacency,
    cells,
    graph.doorPortals,
    graph.cellSize,
  )
  const newStairTransitionEdgeCount = connectStairTransitionCells(
    adjacency,
    cells,
    cellIndicesByKey,
  )
  const { componentIdByCell, components, largestComponentId, largestComponentSize } =
    computeConnectedComponents(adjacency)

  return {
    ...graph,
    adjacency,
    cells,
    cellsByLevel,
    cellIndicesByKey,
    collisionByLevel,
    componentIdByCell,
    components,
    doorBridgeEdgeCount: graph.doorBridgeEdgeCount + newDoorBridgeEdges.doorBridgeEdgeCount,
    doorBridgeEdges:
      newDoorBridgeEdges.doorBridgeEdges.length > 0
        ? [...graph.doorBridgeEdges, ...newDoorBridgeEdges.doorBridgeEdges]
        : graph.doorBridgeEdges,
    largestComponentId,
    largestComponentSize,
    stairTransitionEdgeCount: graph.stairTransitionEdgeCount + newStairTransitionEdgeCount,
    walkableCellCount: graph.walkableCellCount + restoredCellIndices.length,
  }
}

function createSearchState(cellCount: number): SearchState {
  const cameFrom = new Int32Array(cellCount)
  cameFrom.fill(-1)

  const closed = new Uint8Array(cellCount)
  const gScore = new Float64Array(cellCount)
  gScore.fill(Number.POSITIVE_INFINITY)

  const fScore = new Float64Array(cellCount)
  fScore.fill(Number.POSITIVE_INFINITY)

  return {
    cameFrom,
    closed,
    fScore,
    gScore,
  }
}

function reconstructPath(cameFrom: Int32Array, goalIndex: number) {
  const path: number[] = []
  let current = goalIndex

  while (current >= 0) {
    path.push(current)
    current = cameFrom[current] ?? -1
  }

  path.reverse()
  return path
}

function getHeuristic(graph: NavigationGraph, startIndex: number, goalIndex: number) {
  const start = graph.cells[startIndex]
  const goal = graph.cells[goalIndex]
  if (!(start && goal)) {
    return Number.POSITIVE_INFINITY
  }

  return getCellDistance(start, goal)
}

export function findNavigationPath(
  graph: NavigationGraph,
  startIndex: number,
  goalIndex: number,
): NavigationPathResult | null {
  return measureNavigationPerf('navigation.pathfindMs', () => {
    const startTime = performance.now()

    if (startIndex === goalIndex) {
      return {
        cost: 0,
        elapsedMs: 0,
        indices: [startIndex],
      }
    }

    const start = graph.cells[startIndex]
    const goal = graph.cells[goalIndex]
    if (!(start && goal)) {
      return null
    }

    const searchState = createSearchState(graph.cells.length)
    const openSet = new MinHeap()

    searchState.gScore[startIndex] = 0
    searchState.fScore[startIndex] = getHeuristic(graph, startIndex, goalIndex)
    openSet.push(startIndex, searchState.fScore[startIndex])

    while (openSet.size > 0) {
      const currentEntry = openSet.pop()
      if (!currentEntry) {
        break
      }

      const currentIndex = currentEntry.node
      if (searchState.closed[currentIndex]) {
        continue
      }

      if (currentIndex === goalIndex) {
        const goalCost = searchState.gScore[goalIndex] ?? Number.POSITIVE_INFINITY
        return {
          cost: goalCost,
          elapsedMs: performance.now() - startTime,
          indices: reconstructPath(searchState.cameFrom, goalIndex),
        }
      }

      searchState.closed[currentIndex] = 1

      const neighbors = graph.adjacency[currentIndex] ?? []
      const currentCell = graph.cells[currentIndex]
      if (!currentCell) {
        continue
      }

      for (const neighborIndex of neighbors) {
        if (searchState.closed[neighborIndex]) {
          continue
        }

        const neighborCell = graph.cells[neighborIndex]
        if (!neighborCell) {
          continue
        }

        const currentGScore = searchState.gScore[currentIndex] ?? Number.POSITIVE_INFINITY
        const tentativeGScore = currentGScore + getCellDistance(currentCell, neighborCell)

        const neighborGScore = searchState.gScore[neighborIndex] ?? Number.POSITIVE_INFINITY
        if (tentativeGScore >= neighborGScore) {
          continue
        }

        searchState.cameFrom[neighborIndex] = currentIndex
        searchState.gScore[neighborIndex] = tentativeGScore
        searchState.fScore[neighborIndex] =
          tentativeGScore + getHeuristic(graph, neighborIndex, goalIndex)
        openSet.push(neighborIndex, searchState.fScore[neighborIndex])
      }
    }

    return null
  })
}

export function findClosestNavigationCell(
  graph: NavigationGraph,
  point: [number, number, number],
  preferredLevelId?: LevelNode['id'] | null,
  componentId?: number | null,
): number | null {
  const [x, y, z] = point
  const gridX = Math.round((x - graph.cellSize / 2) / graph.cellSize)
  const gridY = Math.round((z - graph.cellSize / 2) / graph.cellSize)
  const targetLevelId = preferredLevelId ?? null
  const targetComponentId = componentId ?? null
  let bestCellIndex: number | null = null
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  const updateBestCandidate = (cellIndex: number) => {
    const cell = graph.cells[cellIndex]
    if (!cell) {
      return
    }

    if (targetLevelId && cell.levelId !== targetLevelId) {
      return
    }

    if (
      targetComponentId !== null &&
      targetComponentId !== undefined &&
      graph.componentIdByCell[cellIndex] !== targetComponentId
    ) {
      return
    }

    const dx = cell.center[0] - x
    const dy = (cell.center[1] - y) * 1.5
    const dz = cell.center[2] - z
    const distanceSquared = dx * dx + dy * dy + dz * dz

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared
      bestCellIndex = cell.cellIndex
    }
  }

  for (let offsetX = -NAV_SNAP_RADIUS_CELLS; offsetX <= NAV_SNAP_RADIUS_CELLS; offsetX += 1) {
    for (let offsetY = -NAV_SNAP_RADIUS_CELLS; offsetY <= NAV_SNAP_RADIUS_CELLS; offsetY += 1) {
      const key = getCellKey(gridX + offsetX, gridY + offsetY)
      const candidateIndices = graph.cellIndicesByKey.get(key)
      if (!candidateIndices) {
        continue
      }

      for (const candidateIndex of candidateIndices) {
        updateBestCandidate(candidateIndex)
      }
    }
  }

  if (bestCellIndex !== null) {
    return bestCellIndex
  }

  const levelCellIndices = targetLevelId ? (graph.cellsByLevel.get(targetLevelId) ?? null) : null
  const componentCellIndices =
    targetComponentId !== null && targetComponentId >= 0
      ? (graph.components[targetComponentId] ?? null)
      : null
  const fallbackIndices =
    levelCellIndices && componentCellIndices
      ? levelCellIndices.length <= componentCellIndices.length
        ? levelCellIndices
        : componentCellIndices
      : (levelCellIndices ?? componentCellIndices)

  if (fallbackIndices) {
    for (const cellIndex of fallbackIndices) {
      updateBestCandidate(cellIndex)
    }

    return bestCellIndex
  }

  for (let cellIndex = 0; cellIndex < graph.cells.length; cellIndex += 1) {
    updateBestCandidate(cellIndex)
  }

  return bestCellIndex
}

function getDoorOpeningPassagePoints(
  opening: NavigationDoorOpening,
  fromCell: NavigationCell,
  toCell: NavigationCell,
  cellSize: number,
) {
  const fromOffset = {
    x: fromCell.center[0] - opening.center.x,
    y: fromCell.center[2] - opening.center.y,
  }
  const toOffset = {
    x: toCell.center[0] - opening.center.x,
    y: toCell.center[2] - opening.center.y,
  }
  const segmentOffset = {
    x: toCell.center[0] - fromCell.center[0],
    y: toCell.center[2] - fromCell.center[2],
  }
  const fromDepth = dotPlan(fromOffset, opening.depthAxis)
  const toDepth = dotPlan(toOffset, opening.depthAxis)
  const fromWidth = dotPlan(fromOffset, opening.widthAxis)
  const toWidth = dotPlan(toOffset, opening.widthAxis)
  let fromSide = Math.sign(fromDepth)
  let toSide = Math.sign(toDepth)

  if (fromSide === 0 && toSide !== 0) {
    fromSide = -toSide
  }
  if (toSide === 0 && fromSide !== 0) {
    toSide = -fromSide
  }

  if (fromSide === 0 && toSide === 0) {
    const segmentDepthDelta = dotPlan(segmentOffset, opening.depthAxis)
    if (Math.abs(segmentDepthDelta) > Number.EPSILON) {
      fromSide = segmentDepthDelta > 0 ? -1 : 1
      toSide = -fromSide
    } else {
      fromSide = -1
      toSide = 1
    }
  } else if (fromSide === toSide) {
    toSide = -fromSide
  }

  const passageOffset = Math.max(
    opening.passageHalfDepth + Math.max(cellSize * 0.25, NAVIGATION_AGENT_RADIUS * 0.35),
    NAV_DOOR_ENTRY_OFFSET,
  )
  const centerlineOffsetBase =
    passageOffset + Math.max(cellSize * 0.4, NAVIGATION_AGENT_RADIUS * 0.5)
  const centerlineOffsetLimit = Math.max(
    centerlineOffsetBase,
    passageOffset + Math.max(cellSize * 1.1, NAVIGATION_AGENT_RADIUS * 0.9),
  )
  const approachOffset = Math.max(
    centerlineOffsetBase,
    Math.min(centerlineOffsetLimit, Math.abs(fromDepth)),
  )
  const departureOffset = Math.max(
    centerlineOffsetBase,
    Math.min(centerlineOffsetLimit, Math.abs(toDepth)),
  )
  const crossingWidth = 0
  const centerY = Math.min(fromCell.center[1], toCell.center[1])
  const buildWorldPoint = (depthScale: number): [number, number, number] => [
    opening.center.x + opening.widthAxis.x * crossingWidth + opening.depthAxis.x * depthScale,
    centerY,
    opening.center.y + opening.widthAxis.y * crossingWidth + opening.depthAxis.y * depthScale,
  ]

  return {
    approachWorld: buildWorldPoint(fromSide * approachOffset),
    departureWorld: buildWorldPoint(toSide * departureOffset),
    entryWorld: buildWorldPoint(fromSide * passageOffset),
    exitWorld: buildWorldPoint(toSide * passageOffset),
    world: buildWorldPoint(0),
  }
}

function isNavigationPathSegmentInsideDoorOpening(
  opening: NavigationDoorOpening,
  fromCell: NavigationCell,
  toCell: NavigationCell,
  cellSize: number,
) {
  if (fromCell.levelId !== opening.levelId || toCell.levelId !== opening.levelId) {
    return false
  }

  const fromPoint = { x: fromCell.center[0], y: fromCell.center[2] }
  const toPoint = { x: toCell.center[0], y: toCell.center[2] }
  const portalOptions = {
    depthEpsilon: Math.max(cellSize * 0.35, NAVIGATION_AGENT_RADIUS * 0.35),
    widthEpsilon: Math.max(cellSize * 0.55, NAVIGATION_AGENT_RADIUS * 0.5),
  }
  const fromInsidePortal = isPointInsideDoorPortal(fromPoint, opening.polygon, portalOptions)
  const toInsidePortal = isPointInsideDoorPortal(toPoint, opening.polygon, portalOptions)

  const fromOffset = {
    x: fromPoint.x - opening.center.x,
    y: fromPoint.y - opening.center.y,
  }
  const toOffset = {
    x: toPoint.x - opening.center.x,
    y: toPoint.y - opening.center.y,
  }
  const fromDepth = dotPlan(fromOffset, opening.depthAxis)
  const toDepth = dotPlan(toOffset, opening.depthAxis)
  const depthDelta = toDepth - fromDepth
  const depthEpsilon = portalOptions.depthEpsilon
  const fromSide = Math.abs(fromDepth) <= depthEpsilon ? 0 : Math.sign(fromDepth)
  const toSide = Math.abs(toDepth) <= depthEpsilon ? 0 : Math.sign(toDepth)
  const hasOppositeSideCrossing =
    fromSide !== 0 && toSide !== 0 && fromSide !== toSide && Math.abs(depthDelta) > depthEpsilon
  const hasDoorwayEndpointCrossing =
    Math.abs(depthDelta) > Number.EPSILON &&
    ((fromInsidePortal && fromSide === 0 && toSide !== 0 && fromDepth * toDepth <= 0) ||
      (toInsidePortal && toSide === 0 && fromSide !== 0 && fromDepth * toDepth <= 0) ||
      (fromInsidePortal &&
        toInsidePortal &&
        fromSide === 0 &&
        toSide === 0 &&
        fromDepth * toDepth <= 0 &&
        Math.abs(depthDelta) > cellSize * 0.05))
  const crossesOpeningPlane = hasOppositeSideCrossing || hasDoorwayEndpointCrossing

  if (!crossesOpeningPlane) {
    return false
  }

  const fromWidth = dotPlan(fromOffset, opening.widthAxis)
  const toWidth = dotPlan(toOffset, opening.widthAxis)
  const crossingT = Math.min(Math.max(-fromDepth / depthDelta, 0), 1)
  const crossingWidth = fromWidth + (toWidth - fromWidth) * crossingT
  const crossingPoint = {
    x: opening.center.x + opening.widthAxis.x * crossingWidth,
    y: opening.center.y + opening.widthAxis.y * crossingWidth,
  }

  return isPointInsideDoorPortal(crossingPoint, opening.polygon, portalOptions)
}

export function getNavigationDoorTransitions(
  graph: NavigationGraph,
  pathIndices: number[],
): NavigationDoorTransition[] {
  if (pathIndices.length < 2 || graph.doorOpenings.length === 0) {
    return []
  }

  const { segments, totalLength } = buildNavigationPathSamples(graph, pathIndices)
  if (segments.length === 0 || totalLength <= Number.EPSILON) {
    return []
  }

  const openingIdByBridgeKey = new Map<string, string>()
  for (const doorBridgeEdge of graph.doorBridgeEdges) {
    openingIdByBridgeKey.set(
      `${doorBridgeEdge.cellIndexA}:${doorBridgeEdge.cellIndexB}`,
      doorBridgeEdge.openingId,
    )
  }

  const doorOpeningById = new Map(
    graph.doorOpenings.map((doorOpening) => [doorOpening.openingId, doorOpening]),
  )
  const earliestTransitionByOpeningId = new Map<string, NavigationDoorTransition>()

  for (const segment of segments) {
    const pairKey = `${Math.min(segment.fromCellIndex, segment.toCellIndex)}:${Math.max(segment.fromCellIndex, segment.toCellIndex)}`
    const fromCell = graph.cells[segment.fromCellIndex]
    const toCell = graph.cells[segment.toCellIndex]
    if (!(fromCell && toCell)) {
      continue
    }

    const bridgeOpeningId = openingIdByBridgeKey.get(pairKey)
    const doorOpening =
      (bridgeOpeningId ? doorOpeningById.get(bridgeOpeningId) : undefined) ??
      graph.doorOpenings.find((opening) =>
        isNavigationPathSegmentInsideDoorOpening(opening, fromCell, toCell, graph.cellSize),
      )

    if (!doorOpening || earliestTransitionByOpeningId.has(doorOpening.openingId)) {
      continue
    }

    earliestTransitionByOpeningId.set(doorOpening.openingId, {
      doorIds: doorOpening.doorIds,
      openingId: doorOpening.openingId,
      ...getDoorOpeningPassagePoints(doorOpening, fromCell, toCell, graph.cellSize),
      fromCellIndex: segment.fromCellIndex,
      fromPathIndex: Math.floor(segment.pathPosition),
      pathPosition: segment.pathPosition,
      progress: (segment.cumulativeDistance + segment.length * 0.5) / totalLength,
      toCellIndex: segment.toCellIndex,
      toPathIndex: Math.ceil(segment.pathPosition),
    })
  }

  return [...earliestTransitionByOpeningId.values()].sort(
    (left, right) => left.pathPosition - right.pathPosition,
  )
}

function getNavigationCellCenters(graph: NavigationGraph, pathIndices: number[]) {
  return pathIndices.flatMap((cellIndex) => {
    const cell = graph.cells[cellIndex]
    return cell ? [cell.center] : []
  })
}

function getSegmentComponentId(graph: NavigationGraph, pathIndices: number[]) {
  for (const cellIndex of pathIndices) {
    const componentId = graph.componentIdByCell[cellIndex]
    if (componentId !== undefined && componentId >= 0) {
      return componentId
    }
  }

  return null
}

function pushUniqueNavigationPoint(
  points: Array<[number, number, number]>,
  point: [number, number, number],
) {
  const lastPoint = points[points.length - 1]
  if (
    lastPoint &&
    Math.hypot(lastPoint[0] - point[0], lastPoint[1] - point[1], lastPoint[2] - point[2]) <= 1e-4
  ) {
    return
  }

  points.push(point)
}

export function getNavigationPathWorldPoints(
  graph: NavigationGraph,
  pathIndices: number[],
): Array<[number, number, number]> {
  const doorTransitions = getNavigationDoorTransitions(graph, pathIndices)
  const points: Array<[number, number, number]> = []

  if (pathIndices.length === 0) {
    return points
  }

  const appendSimplifiedNavigationSegment = (
    segmentPathIndices: number[],
    options: NavigationSegmentAppendOptions = {},
  ) => {
    const { endWorldAnchor, startWorldAnchor } = options
    const validSegmentPathIndices = segmentPathIndices.filter(
      (cellIndex): cellIndex is number =>
        cellIndex !== undefined && Boolean(graph.cells[cellIndex]),
    )
    const simplifiedSegmentPathIndices =
      validSegmentPathIndices.length > 0
        ? simplifyNavigationPath(graph, validSegmentPathIndices)
        : []
    const segmentPoints = getNavigationCellCenters(graph, simplifiedSegmentPathIndices)
    const componentId = getSegmentComponentId(
      graph,
      simplifiedSegmentPathIndices.length > 0
        ? simplifiedSegmentPathIndices
        : validSegmentPathIndices,
    )

    if (
      startWorldAnchor &&
      endWorldAnchor &&
      hasNavigationWorldLineOfSight(graph, startWorldAnchor, endWorldAnchor, componentId)
    ) {
      pushUniqueNavigationPoint(points, startWorldAnchor)
      pushUniqueNavigationPoint(points, endWorldAnchor)
      return
    }

    let startTrimIndex = 0
    if (startWorldAnchor) {
      while (startTrimIndex < segmentPoints.length - 1) {
        const nextPoint = segmentPoints[startTrimIndex + 1]
        if (
          !(
            nextPoint &&
            hasNavigationWorldLineOfSight(graph, startWorldAnchor, nextPoint, componentId)
          )
        ) {
          break
        }

        startTrimIndex += 1
      }
    }

    let endTrimIndex = segmentPoints.length - 1
    if (endWorldAnchor) {
      while (endTrimIndex > startTrimIndex) {
        const previousPoint = segmentPoints[endTrimIndex - 1]
        if (
          !(
            previousPoint &&
            hasNavigationWorldLineOfSight(graph, previousPoint, endWorldAnchor, componentId)
          )
        ) {
          break
        }

        endTrimIndex -= 1
      }
    }

    if (startWorldAnchor) {
      pushUniqueNavigationPoint(points, startWorldAnchor)
    }

    for (let pointIndex = startTrimIndex; pointIndex <= endTrimIndex; pointIndex += 1) {
      const point = segmentPoints[pointIndex]
      if (point) {
        pushUniqueNavigationPoint(points, point)
      }
    }

    if (endWorldAnchor) {
      pushUniqueNavigationPoint(points, endWorldAnchor)
    }
  }

  if (doorTransitions.length === 0) {
    appendSimplifiedNavigationSegment(pathIndices)
    return points
  }

  let segmentStartPathIndex = 0
  let currentStartWorldAnchor: [number, number, number] | undefined

  for (const transition of doorTransitions) {
    const segmentEndPathIndex = Math.max(segmentStartPathIndex, transition.fromPathIndex)
    appendSimplifiedNavigationSegment(
      pathIndices.slice(segmentStartPathIndex, segmentEndPathIndex + 1),
      {
        endWorldAnchor: transition.approachWorld,
        startWorldAnchor: currentStartWorldAnchor,
      },
    )
    pushUniqueNavigationPoint(points, transition.entryWorld)
    pushUniqueNavigationPoint(points, transition.world)
    pushUniqueNavigationPoint(points, transition.exitWorld)
    pushUniqueNavigationPoint(points, transition.departureWorld)

    segmentStartPathIndex = Math.min(
      pathIndices.length - 1,
      Math.max(segmentStartPathIndex, transition.toPathIndex),
    )
    currentStartWorldAnchor = transition.departureWorld
  }

  appendSimplifiedNavigationSegment(pathIndices.slice(segmentStartPathIndex), {
    startWorldAnchor: currentStartWorldAnchor,
  })

  return points
}

export function simplifyNavigationPath(graph: NavigationGraph, pathIndices: number[]): number[] {
  if (pathIndices.length <= 2) {
    return [...pathIndices]
  }

  const simplifiedPath = [pathIndices[0]!]
  let anchorIndex = 0

  while (anchorIndex < pathIndices.length - 1) {
    let bestVisibleIndex = anchorIndex + 1

    for (
      let candidateIndex = anchorIndex + 2;
      candidateIndex < pathIndices.length;
      candidateIndex += 1
    ) {
      const anchorCellIndex = pathIndices[anchorIndex]
      const candidateCellIndex = pathIndices[candidateIndex]

      if (
        anchorCellIndex === undefined ||
        candidateCellIndex === undefined ||
        !hasNavigationLineOfSight(graph, anchorCellIndex, candidateCellIndex)
      ) {
        break
      }

      bestVisibleIndex = candidateIndex
    }

    const nextCellIndex = pathIndices[bestVisibleIndex]
    if (nextCellIndex === undefined) {
      break
    }

    simplifiedPath.push(nextCellIndex)
    anchorIndex = bestVisibleIndex
  }

  return simplifiedPath
}
