import type { AssetInput, ItemNode } from '@pascal-app/core'
import { MathUtils } from 'three'
import type { SceneGraph } from './scene'

export const PASCAL_TRUCK_ASSET_ID = 'pascal-truck'
export const PASCAL_TRUCK_ITEM_NODE_ID = 'item_pascal_truck_seed'
export const PASCAL_TRUCK_DEFAULT_LEVEL_ID = 'level_9zq0a3e17uf8an2u'

export const PASCAL_TRUCK_ASSET: AssetInput = {
  id: PASCAL_TRUCK_ASSET_ID,
  category: 'outdoor',
  tags: ['floor', 'garage', 'vehicle'],
  name: 'Pascal Truck',
  thumbnail: '/items/pascal-truck/thumbnail.png',
  src: '/items/pascal-truck/model.glb',
  scale: [1, 1, 1],
  offset: [0, 0, 0],
  rotation: [0, 0, 0],
  dimensions: [4.42, 2.5, 2.28],
}

export const PASCAL_TRUCK_SCENE_POSITION: [number, number, number] = [7.25, 0, -11.25]
export const PASCAL_TRUCK_SCENE_ROTATION: [number, number, number] = [0, Math.PI / 2, 0]
export const PASCAL_TRUCK_SCENE_SCALE: [number, number, number] = [1, 1, 1]

export const PASCAL_TRUCK_ENTRY_CLIP_NAME = 'Jumping_Down'
export const PASCAL_TRUCK_ENTRY_CLIP_DURATION_SECONDS = 2.45
export const PASCAL_TRUCK_ENTRY_REVEAL_DURATION_MS = 1500
export const PASCAL_TRUCK_ENTRY_MAX_STEP_MS = 1000
export const PASCAL_TRUCK_ENTRY_REAR_EDGE_INSET = 0.2
export const PASCAL_TRUCK_ENTRY_REAR_TRAVEL_DISTANCE = 0.5
export const PASCAL_TRUCK_ENTRY_REVEAL_TRAVEL_RATIO = 0
export const PASCAL_TRUCK_ENTRY_TRAVEL_END_PROGRESS = 0.78
export const PASCAL_TRUCK_REAR_LOCAL_X_SIGN = 1
export const PASCAL_TRUCK_ENTRY_RELEASE_BLEND_RESPONSE = 8
export const PASCAL_TRUCK_ENTRY_RELEASE_END_WEIGHT = 1e-3

export function getPascalTruckIntroPositionBlend(
  revealProgress: number,
  animationProgress: number,
) {
  const revealTravelProgress =
    (1 - (1 - revealProgress) * (1 - revealProgress)) * PASCAL_TRUCK_ENTRY_REVEAL_TRAVEL_RATIO
  const animationTravelProgress =
    MathUtils.smoothstep(
      MathUtils.clamp(animationProgress / PASCAL_TRUCK_ENTRY_TRAVEL_END_PROGRESS, 0, 1),
      0,
      1,
    ) *
    (1 - PASCAL_TRUCK_ENTRY_REVEAL_TRAVEL_RATIO)

  return Math.min(1, revealTravelProgress + animationTravelProgress)
}

export function getPascalTruckIntroReleaseWeight(releaseElapsedMs: number) {
  return MathUtils.damp(
    1,
    0,
    PASCAL_TRUCK_ENTRY_RELEASE_BLEND_RESPONSE,
    Math.max(0, releaseElapsedMs) / 1000,
  )
}

export function getPascalTruckIntroReleaseDurationMs() {
  return Math.ceil(
    (-Math.log(PASCAL_TRUCK_ENTRY_RELEASE_END_WEIGHT) / PASCAL_TRUCK_ENTRY_RELEASE_BLEND_RESPONSE) *
      1000,
  )
}

const PASCAL_TRUCK_NODE_ASSET = {
  ...PASCAL_TRUCK_ASSET,
  dimensions: PASCAL_TRUCK_ASSET.dimensions ?? [4.42, 2.5, 2.28],
  offset: PASCAL_TRUCK_ASSET.offset ?? [0, 0, 0],
  rotation: PASCAL_TRUCK_ASSET.rotation ?? [0, 0, 0],
  scale: PASCAL_TRUCK_ASSET.scale ?? [1, 1, 1],
} as ItemNode['asset']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldPreservePascalTruckPlacement(sourceTruckNode?: ItemNode | null) {
  const metadata = isRecord(sourceTruckNode?.metadata) ? sourceTruckNode.metadata : null
  if (metadata?.manualPlacement !== true) {
    return false
  }

  const seededBy = typeof metadata.seededBy === 'string' ? metadata.seededBy : null
  if (seededBy === 'apps/editor/app/page.tsx') {
    return false
  }

  return true
}

function getScaledItemDimensions(node: Record<string, unknown>): [number, number, number] | null {
  const asset = isRecord(node.asset) ? node.asset : null
  const assetDimensions = Array.isArray(asset?.dimensions) ? asset.dimensions : null
  if (
    !assetDimensions ||
    assetDimensions.length < 3 ||
    assetDimensions.some((value) => typeof value !== 'number')
  ) {
    return null
  }
  const dimensions = assetDimensions as [number, number, number]

  const assetScale: [number, number, number] =
    Array.isArray(asset?.scale) && asset.scale.length >= 3
      ? (asset.scale as [number, number, number])
      : [1, 1, 1]
  const nodeScale: [number, number, number] =
    Array.isArray(node.scale) && node.scale.length >= 3
      ? (node.scale as [number, number, number])
      : [1, 1, 1]

  return [
    dimensions[0] * assetScale[0] * nodeScale[0],
    dimensions[1] * assetScale[1] * nodeScale[1],
    dimensions[2] * assetScale[2] * nodeScale[2],
  ]
}

function getSitePolygonPoints(sceneGraph: SceneGraph): [number, number][] | null {
  for (const node of Object.values(sceneGraph.nodes)) {
    if (
      isRecord(node) &&
      node.type === 'site' &&
      isRecord(node.polygon) &&
      Array.isArray(node.polygon.points) &&
      node.polygon.points.length >= 3
    ) {
      return node.polygon.points as [number, number][]
    }
  }

  return null
}

function getPolygonCenter(points: [number, number][]): [number, number] {
  let sumX = 0
  let sumZ = 0
  for (const [x, z] of points) {
    sumX += x
    sumZ += z
  }
  return [sumX / points.length, sumZ / points.length]
}

function getPolygonAreaAndCentroid(points: [number, number][]) {
  let doubledArea = 0
  let centroidXTimesArea = 0
  let centroidZTimesArea = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!(current && next)) {
      continue
    }

    const cross = current[0] * next[1] - next[0] * current[1]
    doubledArea += cross
    centroidXTimesArea += (current[0] + next[0]) * cross
    centroidZTimesArea += (current[1] + next[1]) * cross
  }

  if (Math.abs(doubledArea) <= Number.EPSILON) {
    return {
      area: 0,
      centroid: getPolygonCenter(points),
    }
  }

  return {
    area: Math.abs(doubledArea) / 2,
    centroid: [centroidXTimesArea / (3 * doubledArea), centroidZTimesArea / (3 * doubledArea)] as [
      number,
      number,
    ],
  }
}

function getLevelGeometryCenter(sceneGraph: SceneGraph, levelId: string): [number, number] | null {
  let weightedCenterX = 0
  let weightedCenterZ = 0
  let totalArea = 0

  for (const rawNode of Object.values(sceneGraph.nodes)) {
    if (!isRecord(rawNode) || rawNode.type !== 'slab' || rawNode.parentId !== levelId) {
      continue
    }

    const polygon = rawNode.polygon
    if (
      !Array.isArray(polygon) ||
      polygon.length < 3 ||
      polygon.some(
        (point) =>
          !Array.isArray(point) ||
          point.length < 2 ||
          typeof point[0] !== 'number' ||
          typeof point[1] !== 'number',
      )
    ) {
      continue
    }

    const { area, centroid } = getPolygonAreaAndCentroid(polygon as [number, number][])
    weightedCenterX += centroid[0] * area
    weightedCenterZ += centroid[1] * area
    totalArea += area
  }

  if (totalArea <= Number.EPSILON) {
    return null
  }

  return [weightedCenterX / totalArea, weightedCenterZ / totalArea]
}

function getCardinalRearDirectionTowardTarget(
  sourceX: number,
  sourceZ: number,
  targetX: number,
  targetZ: number,
) {
  const deltaX = targetX - sourceX
  const deltaZ = targetZ - sourceZ

  if (Math.abs(deltaX) >= Math.abs(deltaZ)) {
    return deltaX >= 0
      ? { directionX: 1, directionZ: 0, yaw: Math.PI }
      : { directionX: -1, directionZ: 0, yaw: 0 }
  }

  return deltaZ >= 0
    ? { directionX: 0, directionZ: 1, yaw: Math.PI * 1.5 }
    : { directionX: 0, directionZ: -1, yaw: Math.PI / 2 }
}

function pointInPolygon2D(x: number, z: number, polygon: [number, number][]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    const intersects =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || Number.EPSILON) + xi
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function getOrientedRectCorners(
  centerX: number,
  centerZ: number,
  halfLength: number,
  halfDepth: number,
  yaw: number,
): [number, number][] {
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const localCorners: [number, number][] = [
    [-halfLength, -halfDepth],
    [halfLength, -halfDepth],
    [halfLength, halfDepth],
    [-halfLength, halfDepth],
  ]

  return localCorners.map(([localX, localZ]) => [
    centerX + localX * cosYaw - localZ * sinYaw,
    centerZ + localX * sinYaw + localZ * cosYaw,
  ])
}

function getPolygonAxes(points: [number, number][]) {
  const axes: [number, number][] = []
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!(current && next)) {
      continue
    }

    const edgeX = next[0] - current[0]
    const edgeZ = next[1] - current[1]
    const length = Math.hypot(edgeX, edgeZ)
    if (length <= Number.EPSILON) {
      continue
    }

    axes.push([-edgeZ / length, edgeX / length])
  }
  return axes
}

function projectPolygon(points: [number, number][], axis: [number, number]) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const point of points) {
    const projection = point[0] * axis[0] + point[1] * axis[1]
    min = Math.min(min, projection)
    max = Math.max(max, projection)
  }

  return { max, min }
}

function polygonsOverlap(a: [number, number][], b: [number, number][]) {
  const axes = [...getPolygonAxes(a), ...getPolygonAxes(b)]
  for (const axis of axes) {
    const projectionA = projectPolygon(a, axis)
    const projectionB = projectPolygon(b, axis)
    if (projectionA.max < projectionB.min || projectionB.max < projectionA.min) {
      return false
    }
  }
  return true
}

function collectTruckPlacementObstacles(
  sceneGraph: SceneGraph,
  levelId: string,
  excludedItemId: string,
) {
  const obstacles: Array<{
    center: [number, number]
    corners: [number, number][]
  }> = []

  for (const rawNode of Object.values(sceneGraph.nodes)) {
    if (!isRecord(rawNode) || rawNode.type !== 'item' || rawNode.id === excludedItemId) {
      continue
    }

    const asset = isRecord(rawNode.asset) ? rawNode.asset : null
    if (rawNode.parentId !== levelId || asset?.attachTo) {
      continue
    }

    const dimensions = getScaledItemDimensions(rawNode)
    const position =
      Array.isArray(rawNode.position) && rawNode.position.length >= 3
        ? (rawNode.position as [number, number, number])
        : null
    if (!dimensions || !position) {
      continue
    }

    const yaw =
      Array.isArray(rawNode.rotation) &&
      rawNode.rotation.length >= 2 &&
      typeof rawNode.rotation[1] === 'number'
        ? rawNode.rotation[1]
        : 0

    obstacles.push({
      center: [position[0], position[2]],
      corners: getOrientedRectCorners(
        position[0],
        position[2],
        dimensions[0] / 2,
        dimensions[2] / 2,
        yaw,
      ),
    })
  }

  return obstacles
}

function computePascalTruckSeedTransform(sceneGraph: SceneGraph, levelId: string | null) {
  const fallback = {
    position: PASCAL_TRUCK_SCENE_POSITION,
    rotation: PASCAL_TRUCK_SCENE_ROTATION,
    scale: PASCAL_TRUCK_SCENE_SCALE,
  }

  if (!levelId) {
    return fallback
  }

  const sitePolygon = getSitePolygonPoints(sceneGraph)
  if (!sitePolygon) {
    return fallback
  }

  const targetCenter = getLevelGeometryCenter(sceneGraph, levelId) ?? getPolygonCenter(sitePolygon)
  const obstacles = collectTruckPlacementObstacles(sceneGraph, levelId, PASCAL_TRUCK_ITEM_NODE_ID)
  const [truckLength, , truckDepth] = PASCAL_TRUCK_ASSET.dimensions ?? [4.42, 2.5, 2.28]
  const edgeSamples = [0.18, 0.35, 0.5, 0.65, 0.82]
  const insetDistances = [truckLength / 2 + 0.15, truckLength / 2 + 0.45, truckLength / 2 + 0.75]

  let bestCandidate: {
    clearanceScore: number
    position: [number, number, number]
    rotation: [number, number, number]
  } | null = null

  for (let index = 0; index < sitePolygon.length; index += 1) {
    const start = sitePolygon[index]
    const end = sitePolygon[(index + 1) % sitePolygon.length]
    if (!(start && end)) {
      continue
    }

    const edgeLength = Math.hypot(end[0] - start[0], end[1] - start[1])
    if (edgeLength <= Number.EPSILON) {
      continue
    }

    for (const sample of edgeSamples) {
      const borderX = start[0] + (end[0] - start[0]) * sample
      const borderZ = start[1] + (end[1] - start[1]) * sample
      const { directionX, directionZ, yaw } = getCardinalRearDirectionTowardTarget(
        borderX,
        borderZ,
        targetCenter[0],
        targetCenter[1],
      )

      for (const inset of insetDistances) {
        const centerX = borderX + directionX * inset
        const centerZ = borderZ + directionZ * inset
        const corners = getOrientedRectCorners(
          centerX,
          centerZ,
          truckLength / 2,
          truckDepth / 2,
          yaw,
        )

        if (!corners.every(([x, z]) => pointInPolygon2D(x, z, sitePolygon))) {
          continue
        }

        if (obstacles.some((obstacle) => polygonsOverlap(corners, obstacle.corners))) {
          continue
        }

        const clearanceScore = obstacles.reduce((minDistance, obstacle) => {
          const distance = Math.hypot(centerX - obstacle.center[0], centerZ - obstacle.center[1])
          return Math.min(minDistance, distance)
        }, Number.POSITIVE_INFINITY)

        if (!bestCandidate || clearanceScore > bestCandidate.clearanceScore) {
          bestCandidate = {
            clearanceScore,
            position: [centerX, 0, centerZ],
            rotation: [0, yaw, 0],
          }
        }
      }
    }
  }

  return bestCandidate
    ? {
        position: bestCandidate.position,
        rotation: bestCandidate.rotation,
        scale: [1, 1, 1] as [number, number, number],
      }
    : fallback
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

export function isPascalTruckNode(node: unknown): node is ItemNode {
  return (
    isRecord(node) &&
    node.type === 'item' &&
    isRecord(node.asset) &&
    (node.asset.id === PASCAL_TRUCK_ASSET_ID ||
      node.asset.src === PASCAL_TRUCK_ASSET.src ||
      (typeof node.asset.src === 'string' && node.asset.src.endsWith(PASCAL_TRUCK_ASSET.src)))
  )
}

function resolvePascalTruckLevelId(
  sceneGraph: SceneGraph,
  preferredLevelId?: string | null,
): string | null {
  if (
    preferredLevelId &&
    isRecord(sceneGraph.nodes[preferredLevelId]) &&
    sceneGraph.nodes[preferredLevelId].type === 'level'
  ) {
    return preferredLevelId
  }

  const preferredLevel = sceneGraph.nodes[PASCAL_TRUCK_DEFAULT_LEVEL_ID]
  if (isRecord(preferredLevel) && preferredLevel.type === 'level') {
    return PASCAL_TRUCK_DEFAULT_LEVEL_ID
  }

  let fallbackLevelId: string | null = null
  for (const node of Object.values(sceneGraph.nodes)) {
    if (!isRecord(node) || node.type !== 'level' || typeof node.id !== 'string') {
      continue
    }

    fallbackLevelId ??= node.id
    if (node.level === 0) {
      return node.id
    }
  }

  return fallbackLevelId
}

export function stripPascalTruckFromSceneGraph(sceneGraph?: SceneGraph | null): {
  sceneGraph: SceneGraph | null | undefined
  truckNode: ItemNode | null
} {
  if (!sceneGraph) {
    return { sceneGraph, truckNode: null }
  }

  const truckNode = Object.values(sceneGraph.nodes).find((node) => isPascalTruckNode(node)) ?? null
  if (!truckNode) {
    return { sceneGraph, truckNode: null }
  }

  const truckIds = new Set(
    Object.entries(sceneGraph.nodes)
      .filter(([, node]) => isPascalTruckNode(node))
      .map(([id]) => id),
  )
  const nextSceneGraph = cloneValue(sceneGraph)

  for (const truckId of truckIds) {
    delete nextSceneGraph.nodes[truckId]
  }

  for (const [nodeId, node] of Object.entries(nextSceneGraph.nodes)) {
    if (!isRecord(node) || !Array.isArray(node.children)) {
      continue
    }

    const nextChildren = node.children.filter(
      (childId) => typeof childId !== 'string' || !truckIds.has(childId),
    )
    if (nextChildren.length !== node.children.length) {
      nextSceneGraph.nodes[nodeId] = {
        ...node,
        children: nextChildren,
      }
    }
  }

  nextSceneGraph.rootNodeIds = nextSceneGraph.rootNodeIds.filter(
    (rootNodeId) => !truckIds.has(rootNodeId),
  )

  return {
    sceneGraph: nextSceneGraph,
    truckNode: cloneValue(truckNode),
  }
}

export function buildPascalTruckNodeForScene(
  sceneGraph: SceneGraph,
  sourceTruckNode?: ItemNode | null,
): {
  node: ItemNode
  parentId: string | null
} {
  const parentId = resolvePascalTruckLevelId(sceneGraph, sourceTruckNode?.parentId)
  const preserveManualPlacement = shouldPreservePascalTruckPlacement(sourceTruckNode)
  const seededTransform = computePascalTruckSeedTransform(sceneGraph, parentId)
  const node: ItemNode = sourceTruckNode
    ? {
        ...cloneValue(sourceTruckNode),
        asset: PASCAL_TRUCK_NODE_ASSET,
        children: Array.isArray(sourceTruckNode.children) ? [...sourceTruckNode.children] : [],
        id: PASCAL_TRUCK_ITEM_NODE_ID,
        parentId: parentId ?? sourceTruckNode.parentId,
        position:
          preserveManualPlacement && Array.isArray(sourceTruckNode.position)
            ? sourceTruckNode.position
            : seededTransform.position,
        rotation:
          preserveManualPlacement && Array.isArray(sourceTruckNode.rotation)
            ? sourceTruckNode.rotation
            : seededTransform.rotation,
        scale:
          preserveManualPlacement && Array.isArray(sourceTruckNode.scale)
            ? sourceTruckNode.scale
            : seededTransform.scale,
        visible: sourceTruckNode.visible ?? true,
      }
    : {
        asset: PASCAL_TRUCK_NODE_ASSET,
        children: [],
        id: PASCAL_TRUCK_ITEM_NODE_ID,
        metadata: {
          manualPlacement: false,
          seededBy: 'packages/editor/src/components/editor/index.tsx',
        },
        name: PASCAL_TRUCK_ASSET.name,
        object: 'node',
        parentId: parentId ?? PASCAL_TRUCK_DEFAULT_LEVEL_ID,
        position: seededTransform.position,
        rotation: seededTransform.rotation,
        scale: seededTransform.scale,
        type: 'item',
        visible: true,
      }

  return {
    node,
    parentId,
  }
}
