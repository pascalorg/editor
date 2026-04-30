'use client'

import type { TemporalState } from 'zundo'
import { temporal } from 'zundo'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { BuildingNode } from '../schema'
import type { Collection, CollectionId } from '../schema/collections'
import {
  generateCollectionId,
  getCollectionAttachmentNodeCollectionId,
  normalizeCollection,
} from '../schema/collections'
import { LevelNode } from '../schema/nodes/level'
import { SiteNode } from '../schema/nodes/site'
import { StairNode as StairNodeSchema } from '../schema/nodes/stair'
import { StairSegmentNode as StairSegmentNodeSchema } from '../schema/nodes/stair-segment'
import type { AnyNode, AnyNodeId } from '../schema/types'
import * as nodeActions from './actions/node-actions'
import { resetSceneHistoryPauseDepth } from './history-control'

function getFiniteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function getEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

function getNullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function normalizeInputRootNodeIds(
  rootNodeIds: unknown,
  nodes: Record<AnyNodeId, AnyNode>,
): AnyNodeId[] {
  if (!Array.isArray(rootNodeIds)) {
    return []
  }

  const seen = new Set<AnyNodeId>()
  return rootNodeIds.flatMap((nodeId) => {
    if (typeof nodeId !== 'string') {
      return []
    }

    const node = nodes[nodeId as AnyNodeId]
    if (!node || node.type === 'home-assistant-binding') {
      return []
    }

    const typedNodeId = nodeId as AnyNodeId
    if (seen.has(typedNodeId)) {
      return []
    }

    seen.add(typedNodeId)
    return [typedNodeId]
  })
}

function getVector3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) {
    return fallback
  }

  return [
    getFiniteNumber(value[0], fallback[0]),
    getFiniteNumber(value[1], fallback[1]),
    getFiniteNumber(value[2], fallback[2]),
  ]
}

function normalizeStairNode(node: Record<string, unknown>) {
  const sanitized = {
    ...node,
    position: getVector3(node.position, [0, 0, 0]),
    rotation: getFiniteNumber(node.rotation, 0),
    stairType: getEnumValue(node.stairType, ['straight', 'curved', 'spiral'] as const, 'straight'),
    fromLevelId: getNullableString(node.fromLevelId),
    toLevelId: getNullableString(node.toLevelId),
    slabOpeningMode: getEnumValue(node.slabOpeningMode, ['none', 'destination'] as const, 'none'),
    openingOffset: getFiniteNumber(node.openingOffset, 0),
    width: getFiniteNumber(node.width, 1),
    totalRise: getFiniteNumber(node.totalRise, 2.5),
    stepCount: getFiniteNumber(node.stepCount, 10),
    thickness: getFiniteNumber(node.thickness, 0.25),
    fillToFloor: getBoolean(node.fillToFloor, true),
    innerRadius: getFiniteNumber(node.innerRadius, 0.9),
    sweepAngle: getFiniteNumber(node.sweepAngle, Math.PI / 2),
    topLandingMode: getEnumValue(node.topLandingMode, ['none', 'integrated'] as const, 'none'),
    topLandingDepth: getFiniteNumber(node.topLandingDepth, 0.9),
    showCenterColumn: getBoolean(node.showCenterColumn, true),
    showStepSupports: getBoolean(node.showStepSupports, true),
    railingMode: getEnumValue(node.railingMode, ['none', 'left', 'right', 'both'] as const, 'none'),
    railingHeight: getFiniteNumber(node.railingHeight, 0.92),
    children: getStringArray(node.children),
  }

  const parsed = StairNodeSchema.safeParse(sanitized)
  return parsed.success ? parsed.data : null
}

function normalizeStairSegmentNode(node: Record<string, unknown>) {
  const sanitized = {
    ...node,
    position: getVector3(node.position, [0, 0, 0]),
    rotation: getFiniteNumber(node.rotation, 0),
    segmentType: getEnumValue(node.segmentType, ['stair', 'landing'] as const, 'stair'),
    width: getFiniteNumber(node.width, 1),
    length: getFiniteNumber(node.length, 3),
    height: getFiniteNumber(node.height, 2.5),
    stepCount: getFiniteNumber(node.stepCount, 10),
    attachmentSide: getEnumValue(node.attachmentSide, ['front', 'left', 'right'] as const, 'front'),
    fillToFloor: getBoolean(node.fillToFloor, true),
    thickness: getFiniteNumber(node.thickness, 0.25),
  }

  const parsed = StairSegmentNodeSchema.safeParse(sanitized)
  return parsed.success ? parsed.data : null
}

function migrateWallSurfaceMaterials(node: Record<string, any>) {
  const hasInterior =
    node.interiorMaterial !== undefined || typeof node.interiorMaterialPreset === 'string'
  const hasExterior =
    node.exteriorMaterial !== undefined || typeof node.exteriorMaterialPreset === 'string'
  const legacyFinish = {
    material: node.material,
    materialPreset: typeof node.materialPreset === 'string' ? node.materialPreset : undefined,
  }

  if (!hasInterior && !hasExterior) {
    if (legacyFinish.material === undefined && legacyFinish.materialPreset === undefined) {
      return node
    }

    return {
      ...node,
      interiorMaterial: legacyFinish.material,
      interiorMaterialPreset: legacyFinish.materialPreset,
      exteriorMaterial: legacyFinish.material,
      exteriorMaterialPreset: legacyFinish.materialPreset,
    }
  }

  if (!hasInterior) {
    return {
      ...node,
      interiorMaterial: node.exteriorMaterial,
      interiorMaterialPreset: node.exteriorMaterialPreset,
    }
  }

  if (!hasExterior) {
    return {
      ...node,
      exteriorMaterial: node.interiorMaterial,
      exteriorMaterialPreset: node.interiorMaterialPreset,
    }
  }

  return node
}

function migrateStairSurfaceMaterials(node: Record<string, any>) {
  const hasRailing =
    node.railingMaterial !== undefined || typeof node.railingMaterialPreset === 'string'
  const hasTread = node.treadMaterial !== undefined || typeof node.treadMaterialPreset === 'string'
  const hasSide = node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string'
  const legacyFinish = {
    material: node.material,
    materialPreset: typeof node.materialPreset === 'string' ? node.materialPreset : undefined,
  }

  const resolveBodyFallback = () => {
    if (node.treadMaterial !== undefined || typeof node.treadMaterialPreset === 'string') {
      return {
        material: node.treadMaterial,
        materialPreset:
          typeof node.treadMaterialPreset === 'string' ? node.treadMaterialPreset : undefined,
      }
    }

    if (node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string') {
      return {
        material: node.sideMaterial,
        materialPreset:
          typeof node.sideMaterialPreset === 'string' ? node.sideMaterialPreset : undefined,
      }
    }

    return legacyFinish
  }

  if (!hasRailing && !hasTread && !hasSide) {
    if (legacyFinish.material === undefined && legacyFinish.materialPreset === undefined) {
      return node
    }

    return {
      ...node,
      railingMaterial: legacyFinish.material,
      railingMaterialPreset: legacyFinish.materialPreset,
      treadMaterial: legacyFinish.material,
      treadMaterialPreset: legacyFinish.materialPreset,
      sideMaterial: legacyFinish.material,
      sideMaterialPreset: legacyFinish.materialPreset,
    }
  }

  const next = { ...node }

  if (!hasTread) {
    const fallback =
      node.sideMaterial !== undefined || typeof node.sideMaterialPreset === 'string'
        ? {
            material: node.sideMaterial,
            materialPreset:
              typeof node.sideMaterialPreset === 'string' ? node.sideMaterialPreset : undefined,
          }
        : resolveBodyFallback()
    next.treadMaterial = fallback.material
    next.treadMaterialPreset = fallback.materialPreset
  }

  if (!hasSide) {
    const fallback =
      node.treadMaterial !== undefined || typeof node.treadMaterialPreset === 'string'
        ? {
            material: node.treadMaterial,
            materialPreset:
              typeof node.treadMaterialPreset === 'string' ? node.treadMaterialPreset : undefined,
          }
        : resolveBodyFallback()
    next.sideMaterial = fallback.material
    next.sideMaterialPreset = fallback.materialPreset
  }

  if (!hasRailing) {
    const fallback = resolveBodyFallback()
    next.railingMaterial = fallback.material
    next.railingMaterialPreset = fallback.materialPreset
  }

  return next
}

function migrateRoofSurfaceMaterials(node: Record<string, any>) {
  const hasTop = node.topMaterial !== undefined || typeof node.topMaterialPreset === 'string'
  const hasEdge = node.edgeMaterial !== undefined || typeof node.edgeMaterialPreset === 'string'
  const hasWall = node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string'
  const legacyFinish = {
    material: node.material,
    materialPreset: typeof node.materialPreset === 'string' ? node.materialPreset : undefined,
  }

  if (!hasTop && !hasEdge && !hasWall) {
    if (legacyFinish.material === undefined && legacyFinish.materialPreset === undefined) {
      return node
    }

    return {
      ...node,
      topMaterial: legacyFinish.material,
      topMaterialPreset: legacyFinish.materialPreset,
      edgeMaterial: legacyFinish.material,
      edgeMaterialPreset: legacyFinish.materialPreset,
      wallMaterial: legacyFinish.material,
      wallMaterialPreset: legacyFinish.materialPreset,
    }
  }

  const next = { ...node }

  if (!hasTop) {
    next.topMaterial = legacyFinish.material
    next.topMaterialPreset = legacyFinish.materialPreset
  }

  if (!hasEdge) {
    if (node.wallMaterial !== undefined || typeof node.wallMaterialPreset === 'string') {
      next.edgeMaterial = node.wallMaterial
      next.edgeMaterialPreset =
        typeof node.wallMaterialPreset === 'string' ? node.wallMaterialPreset : undefined
    } else {
      next.edgeMaterial = legacyFinish.material
      next.edgeMaterialPreset = legacyFinish.materialPreset
    }
  }

  if (!hasWall) {
    if (node.edgeMaterial !== undefined || typeof node.edgeMaterialPreset === 'string') {
      next.wallMaterial = node.edgeMaterial
      next.wallMaterialPreset =
        typeof node.edgeMaterialPreset === 'string' ? node.edgeMaterialPreset : undefined
    } else {
      next.wallMaterial = legacyFinish.material
      next.wallMaterialPreset = legacyFinish.materialPreset
    }
  }

  return next
}

function migrateNodes(nodes: Record<string, any>): Record<string, AnyNode> {
  const patchedNodes = { ...nodes }
  for (const [id, node] of Object.entries(patchedNodes)) {
    // 1. Item scale migration
    if (node.type === 'item' && !('scale' in node)) {
      patchedNodes[id] = { ...node, scale: [1, 1, 1] }
    }
    // 2. Old roof to new roof + segment migration
    if (node.type === 'roof' && !('children' in node)) {
      const oldRoof = node
      const suffix = id.includes('_') ? id.split('_')[1] : Math.random().toString(36).slice(2)
      const segmentId = `rseg_${suffix}`

      const segment = {
        object: 'node',
        id: segmentId,
        type: 'roof-segment',
        parentId: id,
        visible: oldRoof.visible ?? true,
        metadata: {},
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: oldRoof.length ?? 8,
        depth: (oldRoof.leftWidth ?? 2.2) + (oldRoof.rightWidth ?? 2.2),
        wallHeight: 0,
        roofHeight: oldRoof.height ?? 2.5,
        wallThickness: 0.1,
        deckThickness: 0.1,
        overhang: 0.3,
        shingleThickness: 0.05,
      }

      patchedNodes[segmentId] = segment
      patchedNodes[id] = {
        ...oldRoof,
        children: [segmentId],
      }
    }

    if (node.type === 'stair') {
      const normalized = normalizeStairNode(migrateStairSurfaceMaterials(node))
      if (normalized) {
        patchedNodes[id] = normalized
      }
    }

    if (node.type === 'stair-segment') {
      const normalized = normalizeStairSegmentNode(node)
      if (normalized) {
        patchedNodes[id] = normalized
      }
    }

    if (node.type === 'wall') {
      patchedNodes[id] = migrateWallSurfaceMaterials(patchedNodes[id])
    }

    if (node.type === 'roof') {
      patchedNodes[id] = migrateRoofSurfaceMaterials(patchedNodes[id])
    }
  }
  return patchedNodes as Record<string, AnyNode>
}

function getNodeChildIds(node: AnyNode): AnyNodeId[] {
  if (!('children' in node) || !Array.isArray(node.children)) {
    return []
  }

  return (node.children as unknown[])
    .map((child) => {
      if (typeof child === 'string') return child
      if (child && typeof child === 'object' && 'id' in child && typeof child.id === 'string') {
        return child.id
      }
      return null
    })
    .filter((id): id is AnyNodeId => typeof id === 'string')
}

function normalizeRootNodeIds(
  nodes: Record<AnyNodeId, AnyNode>,
  rootNodeIds: AnyNodeId[],
): AnyNodeId[] {
  const existingRootIds = rootNodeIds.filter((id) => Boolean(nodes[id]))
  const siteRootIds = existingRootIds.filter((id) => nodes[id]?.type === 'site')

  if (siteRootIds.length > 0) {
    return siteRootIds
  }

  return existingRootIds.filter((id) => nodes[id]?.parentId === null)
}

function collectReachableNodeIds(
  nodes: Record<AnyNodeId, AnyNode>,
  rootNodeIds: AnyNodeId[],
): Set<AnyNodeId> {
  const reachable = new Set<AnyNodeId>()
  const stack = [...rootNodeIds]
  const childIdsByParentId = new Map<AnyNodeId, AnyNodeId[]>()

  for (const node of Object.values(nodes)) {
    if (!node.parentId) continue
    const parentId = node.parentId as AnyNodeId
    const children = childIdsByParentId.get(parentId) ?? []
    children.push(node.id as AnyNodeId)
    childIdsByParentId.set(parentId, children)
  }

  while (stack.length > 0) {
    const id = stack.pop()
    if (!id || reachable.has(id)) continue

    const node = nodes[id]
    if (!node) continue

    reachable.add(id)
    stack.push(...getNodeChildIds(node))
    stack.push(...(childIdsByParentId.get(id) ?? []))
  }

  return reachable
}

function isDetachedDurableNode(node: AnyNode) {
  return node.type === 'home-assistant-binding'
}

export type SceneState = {
  // 1. The Data: A flat dictionary of all nodes
  nodes: Record<AnyNodeId, AnyNode>

  // 2. The Root: Which nodes are at the top level?
  rootNodeIds: AnyNodeId[]

  // 3. The "Dirty" Set: For the Wall/Physics systems
  dirtyNodes: Set<AnyNodeId>

  // 4. Relational metadata — not nodes
  collections: Record<CollectionId, Collection>

  // 5. Read-only lock — when true all create/update/delete operations are no-ops
  readOnly: boolean
  setReadOnly: (readOnly: boolean) => void

  // Actions
  loadScene: () => void
  clearScene: () => void
  unloadScene: () => void
  setScene: (
    nodes: Record<AnyNodeId, AnyNode>,
    rootNodeIds: AnyNodeId[],
    collections?: Record<CollectionId, Collection>,
  ) => void

  markDirty: (id: AnyNodeId) => void
  clearDirty: (id: AnyNodeId) => void

  createNode: (node: AnyNode, parentId?: AnyNodeId) => void
  createNodes: (ops: { node: AnyNode; parentId?: AnyNodeId }[]) => void

  updateNode: (id: AnyNodeId, data: Partial<AnyNode>) => void
  updateNodes: (updates: { id: AnyNodeId; data: Partial<AnyNode> }[]) => void

  deleteNode: (id: AnyNodeId) => void
  deleteNodes: (ids: AnyNodeId[]) => void

  // Collection actions
  createCollection: (name: string, nodeIds?: AnyNodeId[]) => CollectionId
  deleteCollection: (id: CollectionId) => void
  updateCollection: (id: CollectionId, data: Partial<Omit<Collection, 'id'>>) => void
  addToCollection: (id: CollectionId, nodeId: AnyNodeId) => void
  removeFromCollection: (id: CollectionId, nodeId: AnyNodeId) => void
}

// type PartializedStoreState = Pick<SceneState, 'rootNodeIds' | 'nodes'>;

type UseSceneStore = UseBoundStore<StoreApi<SceneState>> & {
  temporal: StoreApi<TemporalState<Pick<SceneState, 'nodes' | 'rootNodeIds' | 'collections'>>>
}

function getCollectionIdsReferencedByAttachmentNodes(nodes: Record<AnyNodeId, AnyNode>) {
  const referencedCollectionIds = new Set<CollectionId>()

  for (const node of Object.values(nodes)) {
    const collectionId = getCollectionAttachmentNodeCollectionId(node)
    if (collectionId) {
      referencedCollectionIds.add(collectionId)
    }
    if (
      node.type === 'home-assistant-binding' &&
      typeof (node as { collectionId?: unknown }).collectionId === 'string'
    ) {
      referencedCollectionIds.add((node as { collectionId: CollectionId }).collectionId)
    }
  }

  return referencedCollectionIds
}

function normalizeCollectionsRecord(
  collections: Record<CollectionId, Collection> | undefined,
  nodes: Record<AnyNodeId, AnyNode>,
) {
  const referencedCollectionIds = getCollectionIdsReferencedByAttachmentNodes(nodes)

  const normalizedCollections = Object.fromEntries(
    Object.entries(collections ?? {}).flatMap(([id, collection]) => {
      const normalizedNodeIds = Array.from(
        new Set(collection.nodeIds.filter((nodeId) => Boolean(nodes[nodeId]))),
      ) as AnyNodeId[]

      if (normalizedNodeIds.length === 0 && !referencedCollectionIds.has(id as CollectionId)) {
        return []
      }

      return [
        [id as CollectionId, normalizeCollection({ ...collection, nodeIds: normalizedNodeIds })],
      ]
    }),
  ) as Record<CollectionId, Collection>

  if (Object.keys(normalizedCollections).length === 0) {
    return normalizedCollections
  }

  for (const [collectionId, collection] of Object.entries(normalizedCollections)) {
    for (const nodeId of collection.nodeIds) {
      const node = nodes[nodeId]
      if (!(node && node.type === 'item')) {
        continue
      }

      const existingIds = Array.isArray(node.collectionIds) ? node.collectionIds : []
      if (existingIds.includes(collectionId as CollectionId)) {
        continue
      }

      nodes[nodeId] = {
        ...node,
        collectionIds: [...existingIds, collectionId as CollectionId],
      } as AnyNode
    }
  }

  return normalizedCollections
}

function normalizeCollectionAttachmentNodes(
  nodes: Record<AnyNodeId, AnyNode>,
  collections: Record<CollectionId, Collection>,
  rootNodeIds: AnyNodeId[],
) {
  const nextNodes = { ...nodes }
  const nextRootNodeIds = [...rootNodeIds]
  let changed = false

  for (const [storedNodeId, node] of Object.entries(nodes) as [AnyNodeId, AnyNode][]) {
    if (node.type === 'home-assistant-binding') {
      continue
    }

    const collectionId = getCollectionAttachmentNodeCollectionId(node)
    if (!collectionId) {
      continue
    }

    if (node.id !== storedNodeId) {
      nextNodes[storedNodeId] = { ...node, id: storedNodeId } as AnyNode
      changed = true
    }

    const resources = (node as { resources?: unknown[] }).resources ?? []
    const hasCollection = Boolean(collections[collectionId])
    const hasResources = resources.length > 0

    if (!(hasCollection && hasResources)) {
      delete nextNodes[storedNodeId]
      const rootIndex = nextRootNodeIds.indexOf(storedNodeId)
      if (rootIndex >= 0) {
        nextRootNodeIds.splice(rootIndex, 1)
      }
      changed = true
      continue
    }

    if (!nextRootNodeIds.includes(storedNodeId)) {
      nextRootNodeIds.push(storedNodeId)
      changed = true
    }
  }

  return changed ? { nodes: nextNodes, rootNodeIds: nextRootNodeIds } : { nodes, rootNodeIds }
}

const useScene: UseSceneStore = create<SceneState>()(
  temporal(
    (set, get) => ({
      // 1. Flat dictionary of all nodes
      nodes: {},

      // 2. Root node IDs
      rootNodeIds: [],

      // 3. Dirty set
      dirtyNodes: new Set<AnyNodeId>(),

      // 4. Collections
      collections: {} as Record<CollectionId, Collection>,

      // 5. Read-only lock
      readOnly: false,
      setReadOnly: (readOnly: boolean) => set({ readOnly }),

      unloadScene: () => {
        set({
          nodes: {},
          rootNodeIds: [],
          dirtyNodes: new Set<AnyNodeId>(),
          collections: {},
        })
      },

      clearScene: () => {
        get().unloadScene()
        get().loadScene() // Default scene
      },

      setScene: (nodes, rootNodeIds, collections) => {
        // Apply backward compatibility migrations
        const patchedNodes = migrateNodes(nodes)

        // Remove orphans: nodes whose parentId points to a non-existent node
        const cleanedNodes = { ...patchedNodes }
        for (const node of Object.values(cleanedNodes)) {
          if (
            node.type !== 'home-assistant-binding' &&
            node.parentId &&
            !cleanedNodes[node.parentId]
          ) {
            console.warn(
              '[Scene] Removing orphan node',
              node.id,
              '(parentId',
              node.parentId,
              'not found)',
            )
            delete cleanedNodes[node.id]
          }
        }

        const inputRootNodeIds = normalizeInputRootNodeIds(rootNodeIds, cleanedNodes)
        const normalizedCollections = normalizeCollectionsRecord(collections, cleanedNodes)
        const normalizedScene = normalizeCollectionAttachmentNodes(
          cleanedNodes,
          normalizedCollections,
          inputRootNodeIds,
        )
        const normalizedRootNodeIds = normalizeRootNodeIds(
          normalizedScene.nodes,
          normalizedScene.rootNodeIds,
        )
        const normalizedNodes = { ...normalizedScene.nodes }
        const reachableNodeIds = collectReachableNodeIds(normalizedNodes, normalizedRootNodeIds)
        if (normalizedRootNodeIds.length > 0) {
          for (const node of Object.values(normalizedNodes)) {
            if (reachableNodeIds.has(node.id as AnyNodeId)) continue
            if (isDetachedDurableNode(node)) continue
            console.warn('[Scene] Removing unreachable node', node.id)
            delete normalizedNodes[node.id]
          }
        }

        set({
          nodes: normalizedNodes,
          rootNodeIds: normalizedRootNodeIds,
          dirtyNodes: new Set<AnyNodeId>(),
          collections: normalizedCollections,
        })
        // Mark all nodes as dirty to trigger re-validation
        Object.values(normalizedNodes).forEach((node) => {
          get().markDirty(node.id)
        })
      },

      loadScene: () => {
        if (get().rootNodeIds.length > 0) {
          // Assign all nodes as dirty to force re-validation
          Object.values(get().nodes).forEach((node) => {
            get().markDirty(node.id)
          })
          return // Scene already loaded
        }

        // Create hierarchy: Site → Building → Level
        const level0 = LevelNode.parse({
          level: 0,
          children: [],
        })

        const building = BuildingNode.parse({
          children: [level0.id],
        })

        const site = SiteNode.parse({
          children: [building],
        })

        // Define all nodes flat
        const nodes: Record<AnyNodeId, AnyNode> = {
          [site.id]: site,
          [building.id]: building,
          [level0.id]: level0,
        }

        // Site is the root
        const rootNodeIds = [site.id]

        set({ nodes, rootNodeIds })
      },

      markDirty: (id) => {
        get().dirtyNodes.add(id)
      },

      clearDirty: (id) => {
        get().dirtyNodes.delete(id)
      },

      createNodes: (ops) => nodeActions.createNodesAction(set, get, ops),
      createNode: (node, parentId) => nodeActions.createNodesAction(set, get, [{ node, parentId }]),

      updateNodes: (updates) => nodeActions.updateNodesAction(set, get, updates),
      updateNode: (id, data) => nodeActions.updateNodesAction(set, get, [{ id, data }]),

      // --- DELETE ---

      deleteNodes: (ids) => nodeActions.deleteNodesAction(set, get, ids),

      deleteNode: (id) => nodeActions.deleteNodesAction(set, get, [id]),

      // --- COLLECTIONS ---

      createCollection: (name, nodeIds = []) => {
        if (get().readOnly) return '' as CollectionId
        const id = generateCollectionId()
        const collection = normalizeCollection({ id, name, nodeIds })
        set((state) => {
          const nextCollections = { ...state.collections, [id]: collection }
          // Denormalize: stamp collectionId onto each node
          const nextNodes = { ...state.nodes }
          for (const nodeId of nodeIds) {
            const node = nextNodes[nodeId]
            if (!node) continue
            const existing =
              ('collectionIds' in node ? (node.collectionIds as CollectionId[]) : undefined) ?? []
            nextNodes[nodeId] = { ...node, collectionIds: [...existing, id] } as AnyNode
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
        return id
      },

      deleteCollection: (id) => {
        if (get().readOnly) return
        set((state) => {
          const col = state.collections[id]
          const nextCollections = { ...state.collections }
          delete nextCollections[id]
          // Remove collectionId from all member nodes
          const nextNodes = { ...state.nodes }
          let nextRootIds = [...state.rootNodeIds]
          for (const nodeId of col?.nodeIds ?? []) {
            const node = nextNodes[nodeId]
            if (!(node && 'collectionIds' in node)) continue
            nextNodes[nodeId] = {
              ...node,
              collectionIds: (node.collectionIds as CollectionId[]).filter((cid) => cid !== id),
            } as AnyNode
          }

          for (const node of Object.values(nextNodes)) {
            if (getCollectionAttachmentNodeCollectionId(node) !== id) {
              continue
            }

            delete nextNodes[node.id]
            nextRootIds = nextRootIds.filter((rootId) => rootId !== node.id)
          }

          return { collections: nextCollections, nodes: nextNodes, rootNodeIds: nextRootIds }
        })
      },

      updateCollection: (id, data) => {
        if (get().readOnly) return
        set((state) => {
          const col = state.collections[id]
          if (!col) return state
          return {
            collections: {
              ...state.collections,
              [id]: normalizeCollection({ ...col, ...data }),
            },
          }
        })
      },

      addToCollection: (id, nodeId) => {
        if (get().readOnly) return
        set((state) => {
          const col = state.collections[id]
          if (!col || col.nodeIds.includes(nodeId)) return state
          const nextCollections = {
            ...state.collections,
            [id]: normalizeCollection({ ...col, nodeIds: [...col.nodeIds, nodeId] }),
          }
          const node = state.nodes[nodeId]
          if (!node) return { collections: nextCollections }
          const existing =
            ('collectionIds' in node ? (node.collectionIds as CollectionId[]) : undefined) ?? []
          const nextNodes = {
            ...state.nodes,
            [nodeId]: { ...node, collectionIds: [...existing, id] } as AnyNode,
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
      },

      removeFromCollection: (id, nodeId) => {
        if (get().readOnly) return
        set((state) => {
          const col = state.collections[id]
          if (!col) return state
          const nextCollections = {
            ...state.collections,
            [id]: normalizeCollection({ ...col, nodeIds: col.nodeIds.filter((n) => n !== nodeId) }),
          }
          const node = state.nodes[nodeId]
          if (!(node && 'collectionIds' in node)) return { collections: nextCollections }
          const nextNodes = {
            ...state.nodes,
            [nodeId]: {
              ...node,
              collectionIds: (node.collectionIds as CollectionId[]).filter((cid) => cid !== id),
            } as AnyNode,
          }
          return { collections: nextCollections, nodes: nextNodes }
        })
      },
    }),
    {
      partialize: (state) => {
        const { nodes, rootNodeIds, collections } = state
        return { nodes, rootNodeIds, collections }
      },
      limit: 50, // Limit to last 50 actions
    },
  ),
)

export default useScene

// Track previous temporal state lengths and node snapshot for diffing
let prevPastLength = 0
let prevFutureLength = 0
let prevNodesSnapshot: Record<AnyNodeId, AnyNode> | null = null

export function clearSceneHistory() {
  useScene.temporal.getState().clear()
  resetSceneHistoryPauseDepth()
  prevPastLength = 0
  prevFutureLength = 0
  prevNodesSnapshot = null
}

// Subscribe to the temporal store (Undo/Redo events)
useScene.temporal.subscribe((state) => {
  const currentPastLength = state.pastStates.length
  const currentFutureLength = state.futureStates.length

  // Undo: futureStates increases (state moved from past to future)
  // Redo: pastStates increases while futureStates decreases (state moved from future to past)
  const didUndo = currentFutureLength > prevFutureLength
  const didRedo = currentPastLength > prevPastLength && currentFutureLength < prevFutureLength

  if (didUndo || didRedo) {
    // Capture the previous snapshot before RAF fires
    const snapshotBefore = prevNodesSnapshot

    // Defer to a microtask so the scene store has settled before we diff,
    // but still mark walls/items dirty before the next paint.
    queueMicrotask(() => {
      const currentNodes = useScene.getState().nodes
      const { markDirty } = useScene.getState()

      if (snapshotBefore) {
        // Diff: only mark nodes that actually changed
        for (const [id, node] of Object.entries(currentNodes) as [AnyNodeId, AnyNode][]) {
          if (snapshotBefore[id] !== node) {
            markDirty(id)
            // Also mark parent so merged geometries update
            if (node.parentId) markDirty(node.parentId as AnyNodeId)
          }
        }
        // Nodes that were deleted (exist in prev but not current)
        for (const [id, node] of Object.entries(snapshotBefore) as [AnyNodeId, AnyNode][]) {
          if (!currentNodes[id]) {
            const parentId = node.parentId as AnyNodeId | undefined
            if (parentId) {
              markDirty(parentId)
              // Mark sibling nodes dirty so they can update their geometry
              // (e.g. adjacent walls need to recalculate miter/junction geometry)
              const parent = currentNodes[parentId]
              if (parent && 'children' in parent && Array.isArray(parent.children)) {
                for (const childId of parent.children) {
                  markDirty(childId as AnyNodeId)
                }
              }
            }
          }
        }
      } else {
        // No snapshot to diff against — fall back to marking all
        for (const node of Object.values(currentNodes)) {
          markDirty(node.id)
        }
      }
    })
  }

  // Update tracked lengths and snapshot
  prevPastLength = currentPastLength
  prevFutureLength = currentFutureLength
  prevNodesSnapshot = useScene.getState().nodes
})
