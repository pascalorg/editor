'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getScaledDimensions,
  type ItemNode,
  type LevelNode,
  type Point2D,
  type SlabNode,
  type StairNode,
  type StairSegmentNode,
  sceneRegistry,
  useLiveTransforms,
  type WallNode,
} from '@pascal-app/core'
import { Matrix4, type Mesh, type Object3D, Vector3 } from 'three'

const GRID_COORDINATE_PRECISION = 6
const MAX_BRIDGE_SOURCE_COMPONENT_CELLS = 60
const WALKABLE_BRIDGE_NEIGHBOR_OFFSETS: Array<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

export const WALKABLE_CELL_SIZE = 0.2
export const WALKABLE_CLEARANCE = 0.25
export const WALKABLE_FILL_OPACITY = 0.22
export const WALKABLE_OVERLAY_Y_OFFSET = 0.02
const WALKABLE_PORTAL_RELIEF_EPSILON = WALKABLE_CELL_SIZE * 0.08
const WALKABLE_PORTAL_WIDTH_EPSILON = WALKABLE_CELL_SIZE * 0.08
const WALKABLE_PORTAL_AXIS_EPSILON = 1e-6

type WalkableNodeTransform = {
  position: Point2D
  rotation: number
}

type WalkableBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
}

export type WalkableSlabPolygonEntry = {
  polygon: Point2D[]
  holes: Point2D[][]
  surfaceY?: number
  surfaceYAt?: (point: Point2D) => number
}

export type WalkableSurfaceRun = {
  x: number
  y: number
  width: number
  height: number
  surfaceY: number
}

export type WalkableSurfaceCell = {
  x: number
  y: number
  width: number
  height: number
  surfaceY: number
  cornerSurfaceY: [number, number, number, number]
}

export type WallOverlayDebugCell = WalkableSurfaceCell & {
  blockedByObstacle: boolean
  hasSupportingSurface: boolean
  insidePortal: boolean
  insideWallFootprint: boolean
  withinWallClearance: boolean
}

export type WallOverlayFilters = {
  carveDoorPortals: boolean
  excludeObstacleItems: boolean
  expandByClearance: boolean
  requireSupportingSurface: boolean
}

export const DEFAULT_WALL_OVERLAY_FILTERS: WallOverlayFilters = {
  carveDoorPortals: true,
  excludeObstacleItems: true,
  expandByClearance: true,
  requireSupportingSurface: true,
}

export type WalkableSurfaceOverlay = {
  cellCount: number
  cells: WalkableSurfaceCell[]
  obstacleBlockedCellCount: number
  obstacleBlockedCells: WalkableSurfaceCell[]
  path: string
  runs: WalkableSurfaceRun[]
  wallDebugCellCount: number
  wallDebugCells: WallOverlayDebugCell[]
  wallBlockedCellCount: number
  wallBlockedCells: WalkableSurfaceCell[]
  wallBlockedPath: string
  wallBlockedRuns: WalkableSurfaceRun[]
}

export type WallOpeningLike = {
  position: [number, number, number]
  width: number
}

type WalkablePolygonSample = {
  bounds: WalkableBounds
  polygon: Point2D[]
}

export function toWalkablePlanPolygon(points: Array<[number, number]>): Point2D[] {
  return points.map(([x, y]) => ({ x, y }))
}

export function getSlabSurfaceY(slab: SlabNode): number {
  const elevation = slab.elevation ?? 0.05
  return elevation < 0 ? 0 : elevation
}

function rotatePlanVector(x: number, y: number, rotation: number): [number, number] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [x * cos + y * sin, -x * sin + y * cos]
}

type StairSegmentTransform = {
  position: [number, number, number]
  rotation: number
}

function getPolygonBounds(points: Point2D[]): WalkableBounds {
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
    width: maxX - minX,
    height: maxY - minY,
  }
}

function isPointInsideBounds(point: Point2D, bounds: WalkableBounds, margin = 0): boolean {
  return (
    point.x >= bounds.minX - margin &&
    point.x <= bounds.maxX + margin &&
    point.y >= bounds.minY - margin &&
    point.y <= bounds.maxY + margin
  )
}

function isPointInsidePolygon(point: Point2D, polygon: Point2D[]): boolean {
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

function isPointBlockedByPolygon(point: Point2D, polygon: Point2D[], clearance: number): boolean {
  if (polygon.length < 3) {
    return false
  }

  return (
    isPointInsidePolygon(point, polygon) || getPolygonBoundaryDistance(point, polygon) < clearance
  )
}

function buildRectanglePathSegment(x: number, y: number, width: number, height: number): string {
  return [
    `M ${-x} ${-y}`,
    `L ${-(x + width)} ${-y}`,
    `L ${-(x + width)} ${-(y + height)}`,
    `L ${-x} ${-(y + height)}`,
    'Z',
  ].join(' ')
}

function createWalkableSurfaceCell(
  x: number,
  y: number,
  cellSize: number,
  surfaceY: number,
  surfaceYAt?: (point: Point2D) => number,
): WalkableSurfaceCell {
  const cornerSurfaceY = [
    { x, y },
    { x: x + cellSize, y },
    { x: x + cellSize, y: y + cellSize },
    { x, y: y + cellSize },
  ].map((cornerPoint) => surfaceYAt?.(cornerPoint) ?? surfaceY) as [number, number, number, number]

  return {
    x,
    y,
    width: cellSize,
    height: cellSize,
    surfaceY,
    cornerSurfaceY,
  }
}

function getWalkableCellKey(x: number, y: number): string {
  return `${x.toFixed(GRID_COORDINATE_PRECISION)},${y.toFixed(GRID_COORDINATE_PRECISION)}`
}

export function getRotatedRectanglePolygon(
  center: Point2D,
  width: number,
  depth: number,
  rotation: number,
): Point2D[] {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]

  return corners.map(([localX, localY]) => {
    const [offsetX, offsetY] = rotatePlanVector(localX, localY, rotation)
    return {
      x: center.x + offsetX,
      y: center.y + offsetY,
    }
  })
}

export function getWallOpeningPolygon(wall: WallNode, opening: WallOpeningLike): Point2D[] {
  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)

  if (length < 1e-9) {
    return []
  }

  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX
  const centerDistance = opening.position[0]
  const width = opening.width
  const depth = wall.thickness ?? 0.1
  const centerX = x1 + dirX * centerDistance
  const centerZ = z1 + dirZ * centerDistance
  const halfWidth = width / 2
  const halfDepth = depth / 2

  return [
    {
      x: centerX - dirX * halfWidth + perpX * halfDepth,
      y: centerZ - dirZ * halfWidth + perpZ * halfDepth,
    },
    {
      x: centerX + dirX * halfWidth + perpX * halfDepth,
      y: centerZ + dirZ * halfWidth + perpZ * halfDepth,
    },
    {
      x: centerX + dirX * halfWidth - perpX * halfDepth,
      y: centerZ + dirZ * halfWidth - perpZ * halfDepth,
    },
    {
      x: centerX - dirX * halfWidth - perpX * halfDepth,
      y: centerZ - dirZ * halfWidth - perpZ * halfDepth,
    },
  ]
}

export function getDoorPortalPolygon(
  wall: WallNode,
  door: WallOpeningLike,
  clearance: number,
): Point2D[] {
  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)

  if (length < 1e-9) {
    return []
  }

  // Keep the portal depth generous for navigation, but do not widen it sideways
  // beyond the actual door opening on the wall axis.
  const effectiveWidth = Math.max(door.width + WALKABLE_PORTAL_WIDTH_EPSILON * 2, Number.EPSILON)
  if (effectiveWidth <= 0) {
    return []
  }

  const wallThickness = wall.thickness ?? 0.1
  const centerDistance = door.position[0]
  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX
  const portalApproachDepth = Math.max(clearance * 2 + WALKABLE_CELL_SIZE, WALKABLE_CELL_SIZE * 2.5)
  const portalDepth = wallThickness + portalApproachDepth * 2
  const halfWidth = effectiveWidth / 2
  const halfDepth = portalDepth / 2
  const centerX = x1 + dirX * centerDistance
  const centerZ = z1 + dirZ * centerDistance

  return [
    {
      x: centerX - dirX * halfWidth + perpX * halfDepth,
      y: centerZ - dirZ * halfWidth + perpZ * halfDepth,
    },
    {
      x: centerX + dirX * halfWidth + perpX * halfDepth,
      y: centerZ + dirZ * halfWidth + perpZ * halfDepth,
    },
    {
      x: centerX + dirX * halfWidth - perpX * halfDepth,
      y: centerZ + dirZ * halfWidth - perpZ * halfDepth,
    },
    {
      x: centerX - dirX * halfWidth - perpX * halfDepth,
      y: centerZ - dirZ * halfWidth - perpZ * halfDepth,
    },
  ]
}

export function isPointInsideDoorPortal(
  point: Point2D,
  polygon: Point2D[],
  options?: {
    depthEpsilon?: number
    widthEpsilon?: number
  },
): boolean {
  const first = polygon[0]
  const second = polygon[1]
  const third = polygon[2]

  if (!(first && second && third)) {
    return false
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
    return false
  }

  const center = {
    x: polygon.reduce((sum, corner) => sum + corner.x, 0) / polygon.length,
    y: polygon.reduce((sum, corner) => sum + corner.y, 0) / polygon.length,
  }
  const widthAxis = {
    x: widthVector.x / widthLength,
    y: widthVector.y / widthLength,
  }
  const depthAxis = {
    x: depthVector.x / depthLength,
    y: depthVector.y / depthLength,
  }
  const widthEpsilon = options?.widthEpsilon ?? WALKABLE_PORTAL_AXIS_EPSILON
  const depthEpsilon = options?.depthEpsilon ?? WALKABLE_PORTAL_RELIEF_EPSILON
  const offset = {
    x: point.x - center.x,
    y: point.y - center.y,
  }
  const widthCoord = offset.x * widthAxis.x + offset.y * widthAxis.y
  const depthCoord = offset.x * depthAxis.x + offset.y * depthAxis.y

  return (
    Math.abs(widthCoord) <= widthLength / 2 + widthEpsilon &&
    Math.abs(depthCoord) <= depthLength / 2 + depthEpsilon
  )
}

export function getWallAttachedItemDoorOpening(
  item: ItemNode,
  wall: WallNode,
  nodeById: ReadonlyMap<string, AnyNode>,
  cache: Map<string, WalkableNodeTransform | null>,
): WallOpeningLike | null {
  if (item.asset.category !== 'door' || item.asset.attachTo !== 'wall') {
    return null
  }

  const sceneOpening = getWallAttachedItemDoorOpeningFromScene(item, wall)
  if (sceneOpening) {
    return sceneOpening
  }

  const transform = getItemPlanTransform(item, nodeById, cache)
  if (!transform) {
    return null
  }

  const wallVectorX = wall.end[0] - wall.start[0]
  const wallVectorY = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(wallVectorX, wallVectorY)

  if (wallLength <= Number.EPSILON) {
    return null
  }

  const [offsetX, offsetY] = rotatePlanVector(
    item.asset.offset[0] ?? 0,
    item.asset.offset[2] ?? 0,
    transform.rotation,
  )
  const openingCenter = {
    x: transform.position.x + offsetX,
    y: transform.position.y + offsetY,
  }
  const wallDirX = wallVectorX / wallLength
  const wallDirY = wallVectorY / wallLength
  const localCenterX = openingCenter.x - wall.start[0]
  const localCenterY = openingCenter.y - wall.start[1]
  const centerDistance = localCenterX * wallDirX + localCenterY * wallDirY
  const [width, , depth] = getScaledDimensions(item)
  const wallRotation = -Math.atan2(wallVectorY, wallVectorX)
  const assetRotationY = item.asset.rotation[1] ?? 0
  const relativeRotation = transform.rotation + assetRotationY - wallRotation
  const openingWidth = Math.max(
    Math.abs(width * Math.cos(relativeRotation)) + Math.abs(depth * Math.sin(relativeRotation)),
    WALKABLE_CELL_SIZE,
  )

  return {
    position: [centerDistance, item.position[1] ?? 0, 0],
    width: openingWidth,
  }
}

function getWallAttachedItemDoorOpeningFromScene(
  item: ItemNode,
  wall: WallNode,
): WallOpeningLike | null {
  const wallObject = sceneRegistry.nodes.get(wall.id) as Object3D | undefined
  const itemObject = sceneRegistry.nodes.get(item.id) as Object3D | undefined
  const cutoutMesh = itemObject?.getObjectByName('cutout') as Mesh | undefined
  const positions = cutoutMesh?.geometry?.getAttribute?.('position')

  if (!(wallObject && itemObject && cutoutMesh && positions && positions.count > 0)) {
    return null
  }

  wallObject.updateMatrixWorld(true)
  cutoutMesh.updateMatrixWorld(true)

  const wallWorldInverse = new Matrix4().copy(wallObject.matrixWorld).invert()
  const cutoutStableWorldMatrix = getStableWallDoorCutoutWorldMatrix(itemObject, cutoutMesh)
  const point = new Vector3()
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY

  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index)
    point.applyMatrix4(cutoutStableWorldMatrix)
    point.applyMatrix4(wallWorldInverse)
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
  }

  if (!(Number.isFinite(minX) && Number.isFinite(maxX) && maxX - minX > Number.EPSILON)) {
    return null
  }

  return {
    position: [minX + (maxX - minX) / 2, item.position[1] ?? 0, 0],
    width: Math.max(maxX - minX, WALKABLE_CELL_SIZE),
  }
}

function getStableWallDoorCutoutWorldMatrix(itemObject: Object3D, cutoutMesh: Mesh) {
  const stableLocalMatrix = new Matrix4()
  const localChain: Object3D[] = []
  let current: Object3D | null = cutoutMesh

  while (current && current !== itemObject) {
    localChain.push(current)
    current = current.parent
  }

  for (let index = localChain.length - 1; index >= 0; index -= 1) {
    const object = localChain[index]
    if (!object) {
      continue
    }

    if (object.name === 'door-leaf-group' || object.name === 'door-leaf-pivot') {
      continue
    }

    stableLocalMatrix.multiply(object.matrix)
  }

  return new Matrix4().multiplyMatrices(itemObject.matrixWorld, stableLocalMatrix)
}

export function collectLevelDescendants(
  levelNode: LevelNode,
  nodes: Record<string, AnyNode>,
): AnyNode[] {
  const descendants: AnyNode[] = []
  const stack = [...levelNode.children].reverse() as AnyNodeId[]

  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId) {
      continue
    }

    const node = nodes[nodeId]
    if (!node) {
      continue
    }

    descendants.push(node)

    if ('children' in node && Array.isArray(node.children) && node.children.length > 0) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index] as AnyNodeId)
      }
    }
  }

  return descendants
}

export function computeStairSegmentTransforms(
  segments: StairSegmentNode[],
): StairSegmentTransform[] {
  const transforms: StairSegmentTransform[] = []
  let currentX = 0
  let currentY = 0
  let currentZ = 0
  let currentRotation = 0

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (!segment) {
      continue
    }

    if (index === 0) {
      transforms.push({
        position: [currentX, currentY, currentZ],
        rotation: currentRotation,
      })
      continue
    }

    const previousSegment = segments[index - 1]
    if (!previousSegment) {
      continue
    }

    let attachX = 0
    let attachY = previousSegment.height
    let attachZ = previousSegment.length
    let rotationDelta = 0

    if (segment.attachmentSide === 'left') {
      attachX = previousSegment.width / 2
      attachZ = previousSegment.length / 2
      rotationDelta = Math.PI / 2
    } else if (segment.attachmentSide === 'right') {
      attachX = -previousSegment.width / 2
      attachZ = previousSegment.length / 2
      rotationDelta = -Math.PI / 2
    }

    const [rotatedAttachX, rotatedAttachZ] = rotatePlanVector(attachX, attachZ, currentRotation)
    currentX += rotatedAttachX
    currentY += attachY
    currentZ += rotatedAttachZ
    currentRotation += rotationDelta

    transforms.push({
      position: [currentX, currentY, currentZ],
      rotation: currentRotation,
    })
  }

  return transforms
}

export function getStairSegmentPolygon(
  stair: StairNode,
  segment: StairSegmentNode,
  transform: StairSegmentTransform,
): Point2D[] {
  const halfWidth = segment.width / 2
  const localCorners: Array<[number, number]> = [
    [-halfWidth, 0],
    [halfWidth, 0],
    [halfWidth, segment.length],
    [-halfWidth, segment.length],
  ]

  return localCorners.map(([localX, localY]) => {
    const [segmentX, segmentY] = rotatePlanVector(localX, localY, transform.rotation)
    const groupX = transform.position[0] + segmentX
    const groupY = transform.position[2] + segmentY
    const [worldOffsetX, worldOffsetY] = rotatePlanVector(groupX, groupY, stair.rotation)

    return {
      x: stair.position[0] + worldOffsetX,
      y: stair.position[2] + worldOffsetY,
    }
  })
}

function getStairSegmentSurfaceYAtPoint(
  stair: StairNode,
  segment: StairSegmentNode,
  transform: StairSegmentTransform,
  point: Point2D,
): number {
  const planOffsetX = point.x - stair.position[0]
  const planOffsetY = point.y - stair.position[2]
  const [groupX, groupY] = rotatePlanVector(planOffsetX, planOffsetY, -stair.rotation)
  const [localX, localY] = rotatePlanVector(
    groupX - transform.position[0],
    groupY - transform.position[2],
    -transform.rotation,
  )

  const progress = Math.max(0, Math.min(1, localY / Math.max(segment.length, Number.EPSILON)))
  const baseY = stair.position[1] + transform.position[1]

  if (segment.segmentType !== 'stair') {
    return baseY
  }

  return baseY + segment.height * progress
}

export function buildWalkableStairSurfaceEntries(
  stair: StairNode,
  segments: StairSegmentNode[],
): WalkableSlabPolygonEntry[] {
  const transforms = computeStairSegmentTransforms(segments)

  return segments.flatMap((segment, index) => {
    const transform = transforms[index]
    if (!transform) {
      return []
    }

    const polygon = getStairSegmentPolygon(stair, segment, transform)
    if (polygon.length < 3) {
      return []
    }

    const baseY = stair.position[1] + transform.position[1]

    return [
      {
        polygon,
        holes: [],
        surfaceY: baseY,
        surfaceYAt:
          segment.segmentType === 'stair'
            ? (point: Point2D) => getStairSegmentSurfaceYAtPoint(stair, segment, transform, point)
            : undefined,
      },
    ]
  })
}

export function isFloorBlockingItem(
  item: ItemNode,
  nodeById: ReadonlyMap<string, AnyNode>,
): boolean {
  if (item.asset.attachTo) {
    return false
  }

  const parentNode = item.parentId ? nodeById.get(item.parentId as AnyNodeId) : null
  return parentNode?.type !== 'item'
}

export function getItemPlanTransform(
  item: ItemNode,
  nodeById: ReadonlyMap<string, AnyNode>,
  cache: Map<string, WalkableNodeTransform | null>,
): WalkableNodeTransform | null {
  const cached = cache.get(item.id)
  if (cached !== undefined) {
    return cached
  }

  const localRotation = item.rotation[1] ?? 0
  let result: WalkableNodeTransform | null = null
  const itemMetadata =
    typeof item.metadata === 'object' && item.metadata !== null && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null

  if (itemMetadata?.isTransient === true) {
    const live = useLiveTransforms.getState().get(item.id)
    if (live) {
      result = {
        position: {
          x: live.position[0],
          y: live.position[2],
        },
        rotation: live.rotation,
      }

      cache.set(item.id, result)
      return result
    }
  }

  if (item.parentId) {
    const parentNode = nodeById.get(item.parentId as AnyNodeId)

    if (parentNode?.type === 'wall') {
      const wallRotation = -Math.atan2(
        parentNode.end[1] - parentNode.start[1],
        parentNode.end[0] - parentNode.start[0],
      )
      const wallLocalZ =
        item.asset.attachTo === 'wall-side'
          ? ((parentNode.thickness ?? 0.1) / 2) * (item.side === 'back' ? -1 : 1)
          : item.position[2]
      const [offsetX, offsetY] = rotatePlanVector(item.position[0], wallLocalZ, wallRotation)

      result = {
        position: {
          x: parentNode.start[0] + offsetX,
          y: parentNode.start[1] + offsetY,
        },
        rotation: wallRotation + localRotation,
      }
    } else if (parentNode?.type === 'item') {
      const parentTransform = getItemPlanTransform(parentNode, nodeById, cache)
      if (parentTransform) {
        const [offsetX, offsetY] = rotatePlanVector(
          item.position[0],
          item.position[2],
          parentTransform.rotation,
        )
        result = {
          position: {
            x: parentTransform.position.x + offsetX,
            y: parentTransform.position.y + offsetY,
          },
          rotation: parentTransform.rotation + localRotation,
        }
      }
    } else {
      result = {
        position: { x: item.position[0], y: item.position[2] },
        rotation: localRotation,
      }
    }
  } else {
    result = {
      position: { x: item.position[0], y: item.position[2] },
      rotation: localRotation,
    }
  }

  cache.set(item.id, result)
  return result
}

export function buildWalkableSurfaceOverlay(
  slabPolygons: WalkableSlabPolygonEntry[],
  wallPolygons: Point2D[][],
  obstaclePolygons: Point2D[][],
  cellSize: number,
  clearance: number,
  wallPortalPolygons: Point2D[][] = [],
): WalkableSurfaceOverlay | null {
  const slabSamples = slabPolygons
    .map(({ polygon, holes, surfaceY = 0, surfaceYAt }) => ({
      bounds: getPolygonBounds(polygon),
      holes: holes.map((hole) => ({
        bounds: getPolygonBounds(hole),
        polygon: hole,
      })),
      polygon,
      surfaceY,
      surfaceYAt,
    }))
    .filter(
      ({ bounds, polygon }) =>
        polygon.length >= 3 &&
        Number.isFinite(bounds.minX) &&
        Number.isFinite(bounds.maxX) &&
        Number.isFinite(bounds.minY) &&
        Number.isFinite(bounds.maxY),
    )

  if (slabSamples.length === 0) {
    return null
  }

  const wallSamples = wallPolygons
    .map((polygon) => ({
      bounds: getPolygonBounds(polygon),
      polygon,
    }))
    .filter(
      ({ bounds, polygon }) =>
        polygon.length >= 3 &&
        Number.isFinite(bounds.minX) &&
        Number.isFinite(bounds.maxX) &&
        Number.isFinite(bounds.minY) &&
        Number.isFinite(bounds.maxY),
    )

  const obstacleSamples = obstaclePolygons
    .map((polygon) => ({
      bounds: getPolygonBounds(polygon),
      polygon,
    }))
    .filter(
      ({ bounds, polygon }) =>
        polygon.length >= 3 &&
        Number.isFinite(bounds.minX) &&
        Number.isFinite(bounds.maxX) &&
        Number.isFinite(bounds.minY) &&
        Number.isFinite(bounds.maxY),
    )

  const portalSamples = wallPortalPolygons
    .map((polygon) => ({
      bounds: getPolygonBounds(polygon),
      polygon,
    }))
    .filter(
      ({ bounds, polygon }) =>
        polygon.length >= 3 &&
        Number.isFinite(bounds.minX) &&
        Number.isFinite(bounds.maxX) &&
        Number.isFinite(bounds.minY) &&
        Number.isFinite(bounds.maxY),
    )

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const { bounds } of [...slabSamples, ...wallSamples]) {
    minX = Math.min(minX, bounds.minX)
    maxX = Math.max(maxX, bounds.maxX)
    minY = Math.min(minY, bounds.minY)
    maxY = Math.max(maxY, bounds.maxY)
  }

  if (
    !(
      Number.isFinite(minX) &&
      Number.isFinite(maxX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxY)
    )
  ) {
    return null
  }

  const halfCell = cellSize / 2
  const startX = Math.floor(minX / cellSize) * cellSize
  const endX = Math.ceil(maxX / cellSize) * cellSize
  const startY = Math.floor(minY / cellSize) * cellSize
  const endY = Math.ceil(maxY / cellSize) * cellSize
  const cells: WalkableSurfaceCell[] = []
  const obstacleBlockedCells: WalkableSurfaceCell[] = []
  const bridgeableCells: WalkableSurfaceCell[] = []
  const wallDebugCells: WallOverlayDebugCell[] = []
  const wallBlockedCells: WalkableSurfaceCell[] = []

  const resolveSurface = (point: Point2D) => {
    let topSurface: {
      surfaceY: number
      surfaceYAt?: (point: Point2D) => number
    } | null = null

    for (const { bounds, holes, polygon, surfaceY, surfaceYAt } of slabSamples) {
      if (!isPointInsideBounds(point, bounds)) {
        continue
      }

      if (!isPointInsidePolygon(point, polygon)) {
        continue
      }

      const intersectsHole = holes.some(
        ({ bounds: holeBounds, polygon: holePolygon }) =>
          isPointInsideBounds(point, holeBounds) && isPointInsidePolygon(point, holePolygon),
      )

      if (intersectsHole) {
        continue
      }

      const resolvedSurfaceY = surfaceYAt?.(point) ?? surfaceY
      if (topSurface === null || resolvedSurfaceY > topSurface.surfaceY) {
        topSurface = {
          surfaceY: resolvedSurfaceY,
          surfaceYAt,
        }
      }
    }

    return topSurface
  }

  for (let y = startY; y < endY; y = Number((y + cellSize).toFixed(GRID_COORDINATE_PRECISION))) {
    for (let x = startX; x < endX; x = Number((x + cellSize).toFixed(GRID_COORDINATE_PRECISION))) {
      const point = { x: x + halfCell, y: y + halfCell }
      const surfaceMatch = resolveSurface(point)
      const surfaceY = surfaceMatch?.surfaceY ?? null

      const isInsidePortal = portalSamples.some(
        ({ bounds, polygon }) =>
          isPointInsideBounds(point, bounds, WALKABLE_PORTAL_RELIEF_EPSILON) &&
          isPointInsideDoorPortal(point, polygon),
      )

      const isInsideWallFootprint = wallSamples.some(
        ({ bounds, polygon }) =>
          isPointInsideBounds(point, bounds) &&
          (isPointInsidePolygon(point, polygon) ||
            getPolygonBoundaryDistance(point, polygon) <= WALKABLE_PORTAL_RELIEF_EPSILON),
      )

      const isWithinWallClearance = wallSamples.some(
        ({ bounds, polygon }) =>
          isPointInsideBounds(point, bounds, clearance) &&
          isPointBlockedByPolygon(point, polygon, clearance),
      )

      const isObstacleBlocked = obstacleSamples.some(
        ({ bounds, polygon }) =>
          isPointInsideBounds(point, bounds, clearance) &&
          isPointBlockedByPolygon(point, polygon, clearance),
      )

      const isWallBlocked = surfaceY !== null && isWithinWallClearance && !isInsidePortal

      if (isInsideWallFootprint || isWithinWallClearance) {
        const baseCell = createWalkableSurfaceCell(
          x,
          y,
          cellSize,
          surfaceY ?? 0,
          surfaceMatch?.surfaceYAt,
        )

        wallDebugCells.push({
          ...baseCell,
          blockedByObstacle: isObstacleBlocked,
          hasSupportingSurface: surfaceY !== null,
          insidePortal: isInsidePortal,
          insideWallFootprint: isInsideWallFootprint,
          withinWallClearance: isWithinWallClearance,
        })
      }

      if (surfaceY !== null && !isWallBlocked && !isObstacleBlocked) {
        cells.push(createWalkableSurfaceCell(x, y, cellSize, surfaceY, surfaceMatch?.surfaceYAt))
      }

      if (surfaceY !== null && !isWallBlocked && isObstacleBlocked) {
        obstacleBlockedCells.push(
          createWalkableSurfaceCell(x, y, cellSize, surfaceY, surfaceMatch?.surfaceYAt),
        )
      }

      if (surfaceY !== null && isWallBlocked && !isObstacleBlocked) {
        wallBlockedCells.push(
          createWalkableSurfaceCell(x, y, cellSize, surfaceY, surfaceMatch?.surfaceYAt),
        )
      }

      if (surfaceY !== null && !isWallBlocked) {
        bridgeableCells.push(
          createWalkableSurfaceCell(x, y, cellSize, surfaceY, surfaceMatch?.surfaceYAt),
        )
      }
    }
  }

  const bridgedCells = bridgeDisconnectedWalkableCells(cells, bridgeableCells, cellSize)
  const { pathSegments, runs } = buildWalkableRuns(bridgedCells, cellSize)
  const { pathSegments: wallBlockedPathSegments, runs: wallBlockedRuns } = buildWalkableRuns(
    wallBlockedCells,
    cellSize,
  )

  if (pathSegments.length === 0) {
    return null
  }

  return {
    cellCount: bridgedCells.length,
    cells: bridgedCells,
    obstacleBlockedCellCount: obstacleBlockedCells.length,
    obstacleBlockedCells,
    path: pathSegments.join(' '),
    runs,
    wallDebugCellCount: wallDebugCells.length,
    wallDebugCells,
    wallBlockedCellCount: wallBlockedCells.length,
    wallBlockedCells,
    wallBlockedPath: wallBlockedPathSegments.join(' '),
    wallBlockedRuns,
  }
}

export function filterWallOverlayCells(
  cells: WallOverlayDebugCell[],
  filters: WallOverlayFilters,
): WalkableSurfaceCell[] {
  return cells
    .filter((cell) => {
      if (
        (filters.expandByClearance ? cell.withinWallClearance : cell.insideWallFootprint) === false
      ) {
        return false
      }

      if (filters.requireSupportingSurface && !cell.hasSupportingSurface) {
        return false
      }

      if (filters.carveDoorPortals && cell.insidePortal) {
        return false
      }

      if (filters.excludeObstacleItems && cell.blockedByObstacle) {
        return false
      }

      return true
    })
    .map((cell) => ({
      cornerSurfaceY: cell.cornerSurfaceY,
      height: cell.height,
      surfaceY: cell.surfaceY,
      width: cell.width,
      x: cell.x,
      y: cell.y,
    }))
}

export function buildOverlayPathFromCells(cells: WalkableSurfaceCell[], cellSize: number) {
  const { pathSegments, runs } = buildWalkableRuns(cells, cellSize)
  return {
    path: pathSegments.join(' '),
    runs,
  }
}

function bridgeDisconnectedWalkableCells(
  cells: WalkableSurfaceCell[],
  bridgeableCells: WalkableSurfaceCell[],
  cellSize: number,
): WalkableSurfaceCell[] {
  if (cells.length === 0) {
    return cells
  }

  const walkableCellByKey = new Map<string, WalkableSurfaceCell>()
  for (const cell of cells) {
    walkableCellByKey.set(getWalkableCellKey(cell.x, cell.y), cell)
  }

  const bridgeableCellByKey = new Map<string, WalkableSurfaceCell>()
  for (const cell of bridgeableCells) {
    bridgeableCellByKey.set(getWalkableCellKey(cell.x, cell.y), cell)
  }

  const components = buildWalkableComponents([...walkableCellByKey.values()], cellSize)
    .filter((component) => component.keys.length > 0)
    .sort((left, right) => left.keys.length - right.keys.length)

  for (const component of components) {
    if (component.keys.length === 0 || component.keys.length > MAX_BRIDGE_SOURCE_COMPONENT_CELLS) {
      continue
    }

    const sourceKeys = new Set(component.keys.filter((key) => walkableCellByKey.has(key)))
    if (sourceKeys.size === 0) {
      continue
    }

    const targetKeys = new Set([...walkableCellByKey.keys()].filter((key) => !sourceKeys.has(key)))
    if (targetKeys.size === 0) {
      continue
    }

    const bridgeKeys = findMinimalBridgeKeys(
      sourceKeys,
      targetKeys,
      walkableCellByKey,
      bridgeableCellByKey,
      cellSize,
    )

    for (const bridgeKey of bridgeKeys) {
      const bridgeCell = bridgeableCellByKey.get(bridgeKey)
      if (bridgeCell) {
        walkableCellByKey.set(bridgeKey, bridgeCell)
      }
    }
  }

  return [...walkableCellByKey.values()]
}

function buildWalkableComponents(cells: WalkableSurfaceCell[], cellSize: number) {
  const cellByKey = new Map<string, WalkableSurfaceCell>()
  for (const cell of cells) {
    cellByKey.set(getWalkableCellKey(cell.x, cell.y), cell)
  }

  const visited = new Set<string>()

  return cells
    .map((cell) => getWalkableCellKey(cell.x, cell.y))
    .flatMap((startKey) => {
      if (visited.has(startKey)) {
        return []
      }

      const stack = [startKey]
      const keys: string[] = []
      visited.add(startKey)

      while (stack.length > 0) {
        const currentKey = stack.pop()
        if (!currentKey) {
          continue
        }

        const currentCell = cellByKey.get(currentKey)
        if (!currentCell) {
          continue
        }

        keys.push(currentKey)

        for (const [offsetX, offsetY] of WALKABLE_BRIDGE_NEIGHBOR_OFFSETS) {
          const neighborKey = getWalkableCellKey(
            currentCell.x + offsetX * cellSize,
            currentCell.y + offsetY * cellSize,
          )
          if (!cellByKey.has(neighborKey) || visited.has(neighborKey)) {
            continue
          }

          visited.add(neighborKey)
          stack.push(neighborKey)
        }
      }

      return [
        {
          keys,
        },
      ]
    })
}

function findMinimalBridgeKeys(
  sourceKeys: ReadonlySet<string>,
  targetKeys: ReadonlySet<string>,
  walkableCellByKey: ReadonlyMap<string, WalkableSurfaceCell>,
  bridgeableCellByKey: ReadonlyMap<string, WalkableSurfaceCell>,
  cellSize: number,
) {
  const bestBlockedCost = new Map<string, number>()
  const bestStepCount = new Map<string, number>()
  const previousByKey = new Map<string, string | null>()
  const open: Array<{ blockedCost: number; key: string; stepCount: number }> = []
  const closed = new Set<string>()

  for (const sourceKey of sourceKeys) {
    bestBlockedCost.set(sourceKey, 0)
    bestStepCount.set(sourceKey, 0)
    previousByKey.set(sourceKey, null)
    open.push({
      blockedCost: 0,
      key: sourceKey,
      stepCount: 0,
    })
  }

  const popBestEntry = () => {
    if (open.length === 0) {
      return null
    }

    let bestIndex = 0
    for (let index = 1; index < open.length; index += 1) {
      const candidate = open[index]
      const best = open[bestIndex]
      if (!candidate || !best) {
        continue
      }

      if (
        candidate.blockedCost < best.blockedCost ||
        (candidate.blockedCost === best.blockedCost && candidate.stepCount < best.stepCount)
      ) {
        bestIndex = index
      }
    }

    const [entry] = open.splice(bestIndex, 1)
    return entry ?? null
  }

  let goalKey: string | null = null

  while (open.length > 0) {
    const current = popBestEntry()
    if (!current || closed.has(current.key)) {
      continue
    }

    if (targetKeys.has(current.key)) {
      goalKey = current.key
      break
    }

    closed.add(current.key)

    const currentCell = bridgeableCellByKey.get(current.key)
    if (!currentCell) {
      continue
    }

    for (const [offsetX, offsetY] of WALKABLE_BRIDGE_NEIGHBOR_OFFSETS) {
      const neighborKey = getWalkableCellKey(
        currentCell.x + offsetX * cellSize,
        currentCell.y + offsetY * cellSize,
      )
      if (!bridgeableCellByKey.has(neighborKey) || closed.has(neighborKey)) {
        continue
      }

      const nextBlockedCost = current.blockedCost + (walkableCellByKey.has(neighborKey) ? 0 : 1)
      const nextStepCount = current.stepCount + 1
      const previousBlockedCost = bestBlockedCost.get(neighborKey) ?? Number.POSITIVE_INFINITY
      const previousStepCount = bestStepCount.get(neighborKey) ?? Number.POSITIVE_INFINITY

      if (
        nextBlockedCost > previousBlockedCost ||
        (nextBlockedCost === previousBlockedCost && nextStepCount >= previousStepCount)
      ) {
        continue
      }

      bestBlockedCost.set(neighborKey, nextBlockedCost)
      bestStepCount.set(neighborKey, nextStepCount)
      previousByKey.set(neighborKey, current.key)
      open.push({
        blockedCost: nextBlockedCost,
        key: neighborKey,
        stepCount: nextStepCount,
      })
    }
  }

  if (!goalKey) {
    return []
  }

  const bridgeKeys: string[] = []
  let currentKey: string | null = goalKey
  while (currentKey) {
    if (!walkableCellByKey.has(currentKey) && !sourceKeys.has(currentKey)) {
      bridgeKeys.push(currentKey)
    }
    currentKey = previousByKey.get(currentKey) ?? null
  }

  bridgeKeys.reverse()
  return bridgeKeys
}

function buildWalkableRuns(cells: WalkableSurfaceCell[], cellSize: number) {
  const sortedCells = [...cells].sort((left, right) =>
    left.y === right.y ? left.x - right.x : left.y - right.y,
  )
  const pathSegments: string[] = []
  const runs: WalkableSurfaceRun[] = []
  let activeY: number | null = null
  let runStartX: number | null = null
  let runSurfaceY = 0
  let previousX: number | null = null

  const flushRun = () => {
    if (runStartX === null || activeY === null || previousX === null) {
      runStartX = null
      previousX = null
      return
    }

    const width = previousX + cellSize - runStartX
    if (width <= 0) {
      runStartX = null
      previousX = null
      return
    }

    pathSegments.push(buildRectanglePathSegment(runStartX, activeY, width, cellSize))
    runs.push({
      x: runStartX,
      y: activeY,
      width,
      height: cellSize,
      surfaceY: runSurfaceY,
    })
    runStartX = null
    previousX = null
  }

  for (const cell of sortedCells) {
    const sameRow = activeY !== null && Math.abs(cell.y - activeY) <= 1e-6
    const contiguousX = previousX !== null && Math.abs(cell.x - (previousX + cellSize)) <= 1e-6
    const sameSurface = Math.abs(cell.surfaceY - runSurfaceY) <= 1e-6

    if (!(sameRow && contiguousX && sameSurface)) {
      flushRun()
      activeY = cell.y
      runStartX = cell.x
      runSurfaceY = cell.surfaceY
    }

    previousX = cell.x
  }

  flushRun()

  return {
    pathSegments,
    runs,
  }
}
