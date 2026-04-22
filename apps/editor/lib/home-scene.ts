import type { SceneGraph } from '@pascal-app/editor'
import {
  PASCAL_TRUCK_ASSET,
  PASCAL_TRUCK_DEFAULT_LEVEL_ID,
  PASCAL_TRUCK_ITEM_NODE_ID,
} from '../../../packages/editor/src/lib/pascal-truck'

const DEFAULT_LAYOUT_FILE = '/layout_2026-04-08.json'
const LOCAL_STORAGE_KEY = 'pascal-editor-scene'

type SceneNodeRecord = {
  id?: string
  type?: string
  level?: number
  parentId?: string | null
  children?: string[]
  metadata?: Record<string, unknown>
  asset?: {
    attachTo?: string
    dimensions?: [number, number, number]
    id?: string
    scale?: [number, number, number]
  }
  polygon?: {
    points?: [number, number][]
    type?: string
  }
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

type FootprintObstacle = {
  center: [number, number]
  corners: [number, number][]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUsableSceneGraph(scene: SceneGraph | null | undefined): scene is SceneGraph {
  return (
    !!scene &&
    isRecord(scene.nodes) &&
    Object.keys(scene.nodes).length > 0 &&
    Array.isArray(scene.rootNodeIds) &&
    scene.rootNodeIds.length > 0
  )
}

function readStoredScene(): SceneGraph | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? scrubTransientNodes(JSON.parse(raw) as SceneGraph) : null
  } catch {
    return null
  }
}

function writeStoredScene(scene: SceneGraph): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(scrubTransientNodes(scene)))
  } catch {}
}

function cloneScene(scene: SceneGraph): SceneGraph {
  return JSON.parse(JSON.stringify(scene)) as SceneGraph
}

export function scrubTransientNodes(scene: SceneGraph): SceneGraph {
  const transientNodeIds = new Set<string>()

  for (const [nodeId, rawNode] of Object.entries(scene.nodes)) {
    if (!isRecord(rawNode)) {
      continue
    }

    const metadata = isRecord(rawNode.metadata) ? rawNode.metadata : null
    if (metadata?.isTransient === true) {
      transientNodeIds.add(nodeId)
    }
  }

  if (transientNodeIds.size === 0) {
    return scene
  }

  const nextScene = cloneScene(scene)
  const pendingIds = [...transientNodeIds]
  while (pendingIds.length > 0) {
    const nodeId = pendingIds.pop()
    if (!nodeId) {
      continue
    }

    const rawNode = nextScene.nodes[nodeId]
    if (!isRecord(rawNode)) {
      continue
    }

    if (Array.isArray(rawNode.children)) {
      for (const childId of rawNode.children) {
        if (typeof childId === 'string' && !transientNodeIds.has(childId)) {
          transientNodeIds.add(childId)
          pendingIds.push(childId)
        }
      }
    }
  }

  for (const nodeId of transientNodeIds) {
    delete nextScene.nodes[nodeId]
  }

  nextScene.rootNodeIds = nextScene.rootNodeIds.filter((nodeId) => !transientNodeIds.has(nodeId))

  for (const rawNode of Object.values(nextScene.nodes)) {
    if (!isRecord(rawNode) || !Array.isArray(rawNode.children)) {
      continue
    }

    rawNode.children = rawNode.children.filter(
      (childId): childId is string => typeof childId === 'string' && !transientNodeIds.has(childId),
    )
  }

  return nextScene
}

function resolveSeedLevelId(scene: SceneGraph): string | null {
  const preferredLevel = scene.nodes[PASCAL_TRUCK_DEFAULT_LEVEL_ID]
  if (isRecord(preferredLevel) && preferredLevel.type === 'level') {
    return PASCAL_TRUCK_DEFAULT_LEVEL_ID
  }

  for (const node of Object.values(scene.nodes)) {
    if (
      isRecord(node) &&
      node.type === 'level' &&
      node.level === 0 &&
      typeof node.id === 'string'
    ) {
      return node.id
    }
  }

  return null
}

function getPascalTruckNode(scene: SceneGraph): SceneNodeRecord | null {
  const seededNode = scene.nodes[PASCAL_TRUCK_ITEM_NODE_ID]
  if (
    isRecord(seededNode) &&
    seededNode.type === 'item' &&
    isRecord(seededNode.asset) &&
    seededNode.asset.id === PASCAL_TRUCK_ASSET.id
  ) {
    return seededNode as SceneNodeRecord
  }

  for (const node of Object.values(scene.nodes)) {
    if (
      isRecord(node) &&
      node.type === 'item' &&
      isRecord(node.asset) &&
      node.asset.id === PASCAL_TRUCK_ASSET.id
    ) {
      return node as SceneNodeRecord
    }
  }

  return null
}

function getScaledItemDimensions(node: SceneNodeRecord): [number, number, number] | null {
  const assetDimensions = node.asset?.dimensions
  if (
    !assetDimensions ||
    assetDimensions.length < 3 ||
    assetDimensions.some((value) => typeof value !== 'number')
  ) {
    return null
  }

  const assetScale = node.asset?.scale ?? [1, 1, 1]
  const nodeScale = node.scale ?? [1, 1, 1]
  return [
    assetDimensions[0] * assetScale[0] * nodeScale[0],
    assetDimensions[1] * assetScale[1] * nodeScale[1],
    assetDimensions[2] * assetScale[2] * nodeScale[2],
  ]
}

function getSitePolygonPoints(scene: SceneGraph): [number, number][] | null {
  for (const node of Object.values(scene.nodes)) {
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

function getLevelGeometryCenter(scene: SceneGraph, levelId: string): [number, number] | null {
  let weightedCenterX = 0
  let weightedCenterZ = 0
  let totalArea = 0

  for (const rawNode of Object.values(scene.nodes)) {
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
  const corners: [number, number][] = []

  for (const localX of [-halfLength, halfLength]) {
    for (const localZ of [-halfDepth, halfDepth]) {
      corners.push([
        centerX + localX * cosYaw - localZ * sinYaw,
        centerZ + localX * sinYaw + localZ * cosYaw,
      ])
    }
  }

  return corners
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
  scene: SceneGraph,
  levelId: string,
  excludedItemId: string,
): FootprintObstacle[] {
  const obstacles: FootprintObstacle[] = []

  for (const rawNode of Object.values(scene.nodes)) {
    if (!isRecord(rawNode) || rawNode.type !== 'item' || rawNode.id === excludedItemId) {
      continue
    }

    const node = rawNode as SceneNodeRecord
    if (node.parentId !== levelId || node.asset?.attachTo) {
      continue
    }

    const dimensions = getScaledItemDimensions(node)
    const position = node.position
    if (!dimensions || !position) {
      continue
    }

    const yaw = node.rotation?.[1] ?? 0
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

function computePascalTruckSeedTransform(scene: SceneGraph, levelId: string | null) {
  const fallback = {
    position: [7.25, 0, -11.25] as [number, number, number],
    rotation: [0, Math.PI / 2, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  }

  if (!levelId) {
    return fallback
  }

  const sitePolygon = getSitePolygonPoints(scene)
  if (!sitePolygon) {
    return fallback
  }

  const targetCenter = getLevelGeometryCenter(scene, levelId) ?? getPolygonCenter(sitePolygon)
  const obstacles = collectTruckPlacementObstacles(scene, levelId, PASCAL_TRUCK_ITEM_NODE_ID)
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

function injectPascalTruck(scene: SceneGraph): SceneGraph {
  const existingTruck = getPascalTruckNode(scene)
  const existingTruckMetadata =
    existingTruck && isRecord(existingTruck.metadata) ? existingTruck.metadata : null
  const existingTruckManualPlacement = existingTruckMetadata?.manualPlacement === true
  const targetLevelId =
    existingTruck && typeof existingTruck.parentId === 'string'
      ? existingTruck.parentId
      : resolveSeedLevelId(scene)
  if (!targetLevelId) {
    return scene
  }

  if (existingTruck && existingTruckManualPlacement) {
    return scene
  }

  const nextScene = cloneScene(scene)
  const rawLevelNode = nextScene.nodes[targetLevelId]
  if (!isRecord(rawLevelNode)) {
    return scene
  }

  const levelNode = rawLevelNode as SceneNodeRecord
  const levelChildren = Array.isArray(levelNode.children) ? [...levelNode.children] : []
  const truckTransform = computePascalTruckSeedTransform(nextScene, targetLevelId)
  const existingTruckId = typeof existingTruck?.id === 'string' ? existingTruck.id : null

  if (existingTruckId && existingTruckId !== PASCAL_TRUCK_ITEM_NODE_ID) {
    delete nextScene.nodes[existingTruckId]
  }

  if (!levelChildren.includes(PASCAL_TRUCK_ITEM_NODE_ID)) {
    levelChildren.push(PASCAL_TRUCK_ITEM_NODE_ID)
  }

  if (existingTruckId && existingTruckId !== PASCAL_TRUCK_ITEM_NODE_ID) {
    const existingTruckIndex = levelChildren.indexOf(existingTruckId)
    if (existingTruckIndex >= 0) {
      levelChildren.splice(existingTruckIndex, 1)
    }
  }

  nextScene.nodes[targetLevelId] = {
    ...rawLevelNode,
    children: levelChildren,
  }

  nextScene.nodes[PASCAL_TRUCK_ITEM_NODE_ID] = existingTruck
    ? {
        ...existingTruck,
        id: PASCAL_TRUCK_ITEM_NODE_ID,
        parentId: targetLevelId,
        position: truckTransform.position,
        rotation: truckTransform.rotation,
        scale: truckTransform.scale,
        metadata: {
          ...(isRecord(existingTruck.metadata) ? existingTruck.metadata : {}),
          manualPlacement: false,
          seededBy: 'apps/editor/app/page.tsx',
        },
      }
    : {
        id: PASCAL_TRUCK_ITEM_NODE_ID,
        name: PASCAL_TRUCK_ASSET.name,
        type: 'item',
        object: 'node',
        visible: true,
        children: [],
        metadata: {
          manualPlacement: false,
          seededBy: 'apps/editor/app/page.tsx',
        },
        parentId: targetLevelId,
        asset: PASCAL_TRUCK_ASSET,
        position: truckTransform.position,
        rotation: truckTransform.rotation,
        scale: truckTransform.scale,
      }

  return nextScene
}

export async function loadHomeScene(): Promise<SceneGraph | null> {
  const storedScene = readStoredScene()
  if (isUsableSceneGraph(storedScene)) {
    const seededStoredScene = injectPascalTruck(storedScene)
    if (seededStoredScene !== storedScene) {
      writeStoredScene(seededStoredScene)
    }
    return seededStoredScene
  }

  const response = await fetch(DEFAULT_LAYOUT_FILE, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${DEFAULT_LAYOUT_FILE}: ${response.status}`)
  }

  const layoutScene = (await response.json()) as SceneGraph
  if (!isUsableSceneGraph(layoutScene)) {
    return null
  }

  const seededLayoutScene = injectPascalTruck(layoutScene)
  writeStoredScene(seededLayoutScene)
  return seededLayoutScene
}
