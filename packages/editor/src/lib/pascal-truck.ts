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

export function stripPascalTruckFromSceneGraph(
  sceneGraph?: SceneGraph | null,
): {
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

  nextSceneGraph.rootNodeIds = nextSceneGraph.rootNodeIds.filter((rootNodeId) => !truckIds.has(rootNodeId))

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
  const node: ItemNode = sourceTruckNode
    ? {
        ...cloneValue(sourceTruckNode),
        asset: PASCAL_TRUCK_NODE_ASSET,
        children: Array.isArray(sourceTruckNode.children) ? [...sourceTruckNode.children] : [],
        id: PASCAL_TRUCK_ITEM_NODE_ID,
        parentId: parentId ?? sourceTruckNode.parentId,
        position: sourceTruckNode.position ?? PASCAL_TRUCK_SCENE_POSITION,
        rotation: sourceTruckNode.rotation ?? PASCAL_TRUCK_SCENE_ROTATION,
        scale: sourceTruckNode.scale ?? PASCAL_TRUCK_SCENE_SCALE,
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
        position: PASCAL_TRUCK_SCENE_POSITION,
        rotation: PASCAL_TRUCK_SCENE_ROTATION,
        scale: PASCAL_TRUCK_SCENE_SCALE,
        type: 'item',
        visible: true,
      }

  return {
    node,
    parentId,
  }
}
