'use client'

import {
  type AnyNodeId,
  type Collection,
  type CollectionId,
  createHomeAssistantBindingNode,
  getHomeAssistantBindingNodes,
  type HomeAssistantBindingPresentation,
  type HomeAssistantCollectionBindingMap,
  type HomeAssistantResourceBinding,
  normalizeHomeAssistantCollectionBinding,
} from '@pascal-app/core/schema'
import {
  buildSmartHomeRoomControlCompositionFromTileGroups,
  CATALOG_ITEMS,
  getSmartHomeBindingControlIds,
  getSmartHomeExcludedResourceIds,
  getSmartHomeRoomControlMode,
  getSmartHomeRoomControlTileGroups,
  isDefaultSmartHomeRoomGroup,
  isHiddenHomeAssistantGroupResourceId,
  normalizeSmartHomeRoomGroupsForBinding,
  repairHomeAssistantBindingResourcesFromGroups,
  type SceneGraph,
  smartHomeRoomGroupsCoverControlIds,
  smartHomeRoomGroupsEqual,
} from '@pascal-app/editor'

const DEFAULT_LAYOUT_FILE = '/api/default-layout'
const LOCAL_STORAGE_KEY = 'pascal-editor-scene'
const LEGACY_EXCLUDED_ASSET_IDS = new Set(['pascal-truck'])
const DEPRECATED_DEMO_COLLECTION_IDS = new Set([
  'collection_demo1_dining_light',
  'collection_demo2_dining_group',
  'collection_demo3_master_fan',
  'collection_demo4_living_script',
])
const DEPRECATED_DEMO_RESOURCE_IDS = new Set([
  'light.pascal_dining_single',
  'light.pascal_dining_group',
  'fan.pascal_master_bedroom',
])

type LegacyHomeAssistantBindingPresentation = HomeAssistantBindingPresentation & {
  rtsExcludedResourceIds?: string[]
  rtsGroups?: string[][]
}

type LegacySceneGraph = SceneGraph & {
  homeAssistantBindings?: HomeAssistantCollectionBindingMap
}

const CATALOG_INTERACTIVE_ASSETS_BY_ID = new Map(
  CATALOG_ITEMS.filter((item) => item.interactive).map((item) => [item.id, item.interactive]),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined
}

function readStringGroups(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const groups = value
    .filter(Array.isArray)
    .map((group) => group.filter((entry): entry is string => typeof entry === 'string'))
    .filter((group) => group.length > 0)

  return groups.length > 0 ? groups : undefined
}

function readLegacyRoomControlComposition(
  value: unknown,
): HomeAssistantBindingPresentation['rtsRoomControls'] {
  if (!isRecord(value)) {
    return undefined
  }

  const excludedResourceIds = readStringArray(value.excludedResourceIds)
  const mode = value.mode === 'user-managed' || value.mode === 'ha-derived' ? value.mode : undefined
  const groups = Array.isArray(value.groups)
    ? value.groups
        .map((group) => {
          if (!isRecord(group)) {
            return null
          }

          const memberResourceIds = readStringArray(group.memberResourceIds)
          if (!(memberResourceIds && memberResourceIds.length > 0)) {
            return null
          }

          return { memberResourceIds }
        })
        .filter((group): group is { memberResourceIds: string[] } => Boolean(group))
    : undefined

  if (!(excludedResourceIds?.length || groups?.length || mode)) {
    return undefined
  }

  return {
    ...(excludedResourceIds?.length ? { excludedResourceIds } : {}),
    ...(groups?.length ? { groups } : {}),
    ...(mode ? { mode } : {}),
  }
}

function readScreenPosition(value: unknown) {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number'
    ? { x: value.x, y: value.y }
    : undefined
}

function readWorldPosition(value: unknown) {
  return isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.z === 'number'
    ? { x: value.x, y: value.y, z: value.z }
    : undefined
}

function readLegacyHomeAssistantPresentation(
  value: unknown,
): LegacyHomeAssistantBindingPresentation | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const presentation: LegacyHomeAssistantBindingPresentation = {}
  if (typeof value.icon === 'string') {
    presentation.icon = value.icon
  }
  if (typeof value.label === 'string') {
    presentation.label = value.label
  }
  if (typeof value.rtsOrder === 'number') {
    presentation.rtsOrder = value.rtsOrder
  }
  if (value.rtsHidden === true) {
    presentation.rtsHidden = true
  }

  const rtsRoomControls = readLegacyRoomControlComposition(value.rtsRoomControls)
  if (rtsRoomControls) {
    presentation.rtsRoomControls = rtsRoomControls
  }

  const rtsExcludedResourceIds = readStringArray(value.rtsExcludedResourceIds)
  if (rtsExcludedResourceIds?.length) {
    presentation.rtsExcludedResourceIds = rtsExcludedResourceIds
  }

  const rtsGroups = readStringGroups(value.rtsGroups)
  if (rtsGroups?.length) {
    presentation.rtsGroups = rtsGroups
  }

  const rtsScreenPosition = readScreenPosition(value.rtsScreenPosition)
  if (rtsScreenPosition) {
    presentation.rtsScreenPosition = rtsScreenPosition
  }

  const rtsWorldPosition = readWorldPosition(value.rtsWorldPosition)
  if (rtsWorldPosition) {
    presentation.rtsWorldPosition = rtsWorldPosition
  }

  return Object.keys(presentation).length > 0 ? presentation : undefined
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

function readNodeRefId(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  return isRecord(value) && typeof value.id === 'string' ? value.id : null
}

function sceneHasAuthoredBuildingLayout(scene: SceneGraph): boolean {
  for (const siteId of scene.rootNodeIds) {
    const siteNode = scene.nodes[siteId]
    if (!(isRecord(siteNode) && siteNode.type === 'site' && Array.isArray(siteNode.children))) {
      continue
    }

    for (const buildingRef of siteNode.children) {
      const buildingId = readNodeRefId(buildingRef)
      const buildingNode = buildingId ? scene.nodes[buildingId] : null
      if (
        !(
          isRecord(buildingNode) &&
          buildingNode.type === 'building' &&
          Array.isArray(buildingNode.children)
        )
      ) {
        continue
      }

      for (const levelRef of buildingNode.children) {
        const levelId = readNodeRefId(levelRef)
        const levelNode = levelId ? scene.nodes[levelId] : null
        if (
          isRecord(levelNode) &&
          levelNode.type === 'level' &&
          Array.isArray(levelNode.children) &&
          levelNode.children.some((childRef) => {
            const childId = readNodeRefId(childRef)
            return Boolean(childId && scene.nodes[childId])
          })
        ) {
          return true
        }
      }
    }
  }

  return false
}

function readStoredScene(): LegacySceneGraph | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as LegacySceneGraph) : null
  } catch {
    return null
  }
}

function writeStoredScene(scene: SceneGraph): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(scene))
  } catch {}
}

function sanitizeLegacyScene(scene: SceneGraph): SceneGraph {
  const excludedNodeIds = new Set<string>()
  const positionedHomeAssistantCollectionIds = new Set(
    getHomeAssistantBindingNodes(scene.nodes as any)
      .filter(
        (bindingNode) =>
          Boolean(
            bindingNode.presentation?.rtsScreenPosition ||
              bindingNode.presentation?.rtsWorldPosition,
          ) && bindingNode.resources.some((resource) => resource.kind === 'entity'),
      )
      .map((bindingNode) => bindingNode.collectionId),
  )

  for (const [nodeId, rawNode] of Object.entries(scene.nodes ?? {})) {
    if (!(isRecord(rawNode) && rawNode.type === 'item' && isRecord(rawNode.asset))) {
      continue
    }

    const assetId = typeof rawNode.asset.id === 'string' ? rawNode.asset.id : null
    if (assetId && LEGACY_EXCLUDED_ASSET_IDS.has(assetId)) {
      excludedNodeIds.add(nodeId)
    }
  }

  if (excludedNodeIds.size === 0) {
    return scene
  }

  const nextNodes = Object.fromEntries(
    Object.entries(scene.nodes ?? {})
      .filter(([nodeId]) => !excludedNodeIds.has(nodeId))
      .map(([nodeId, rawNode]) => {
        if (!(isRecord(rawNode) && Array.isArray(rawNode.children))) {
          return [nodeId, rawNode]
        }

        const filteredChildren = rawNode.children.filter(
          (childId) => typeof childId !== 'string' || !excludedNodeIds.has(childId),
        )

        if (filteredChildren.length === rawNode.children.length) {
          return [nodeId, rawNode]
        }

        return [
          nodeId,
          {
            ...rawNode,
            children: filteredChildren,
          },
        ]
      }),
  )

  const nextCollections = scene.collections
    ? (Object.fromEntries(
        Object.entries(scene.collections).flatMap(([collectionId, collection]) => {
          const nextNodeIds = collection.nodeIds.filter((nodeId) => !excludedNodeIds.has(nodeId))
          if (
            nextNodeIds.length === 0 &&
            !positionedHomeAssistantCollectionIds.has(collectionId as CollectionId)
          ) {
            return []
          }

          return [
            [
              collectionId as CollectionId,
              {
                ...collection,
                nodeIds: nextNodeIds,
                controlNodeId:
                  collection.controlNodeId && excludedNodeIds.has(collection.controlNodeId)
                    ? nextNodeIds[0]
                    : collection.controlNodeId,
              } satisfies Collection,
            ],
          ]
        }),
      ) as NonNullable<SceneGraph['collections']>)
    : undefined

  return {
    ...scene,
    collections: nextCollections,
    nodes: nextNodes,
    rootNodeIds: scene.rootNodeIds.filter((nodeId) => !excludedNodeIds.has(nodeId)),
  }
}

function stripDeprecatedDemoBindings(scene: SceneGraph): SceneGraph {
  let changed = false
  const nextNodes = Object.fromEntries(
    Object.entries(scene.nodes ?? {}).filter(([nodeId, rawNode]) => {
      if (
        isRecord(rawNode) &&
        rawNode.type === 'home-assistant-binding' &&
        (DEPRECATED_DEMO_COLLECTION_IDS.has(String(rawNode.collectionId)) ||
          (Array.isArray(rawNode.resources) &&
            rawNode.resources.some(
              (resource) =>
                isRecord(resource) &&
                typeof resource.id === 'string' &&
                DEPRECATED_DEMO_RESOURCE_IDS.has(resource.id),
            )))
      ) {
        changed = true
        return false
      }
      return true
    }),
  )

  const nextCollections = scene.collections
    ? Object.fromEntries(
        Object.entries(scene.collections).filter(([collectionId]) => {
          const keep = !DEPRECATED_DEMO_COLLECTION_IDS.has(collectionId)
          if (!keep) {
            changed = true
          }
          return keep
        }),
      )
    : undefined

  if (!changed) {
    return scene
  }

  return {
    ...scene,
    collections: nextCollections,
    nodes: nextNodes,
    rootNodeIds: scene.rootNodeIds.filter((nodeId) => nodeId in nextNodes),
  }
}

function stripHiddenHomeAssistantGroupBindings(scene: SceneGraph): SceneGraph {
  let changed = false
  const removedCollectionIds = new Set<string>()

  const nextNodes = Object.fromEntries(
    Object.entries(scene.nodes ?? {}).filter(([, rawNode]) => {
      if (
        isRecord(rawNode) &&
        rawNode.type === 'home-assistant-binding' &&
        Array.isArray(rawNode.resources) &&
        rawNode.resources.some(
          (resource) =>
            isRecord(resource) &&
            typeof resource.id === 'string' &&
            isHiddenHomeAssistantGroupResourceId(resource.id),
        )
      ) {
        changed = true
        if (typeof rawNode.collectionId === 'string') {
          removedCollectionIds.add(rawNode.collectionId)
        }
        return false
      }

      return true
    }),
  )

  if (!changed) {
    return scene
  }

  const nextCollections = scene.collections
    ? Object.fromEntries(
        Object.entries(scene.collections).filter(([collectionId]) => {
          const keep = !removedCollectionIds.has(collectionId)
          if (!keep) {
            changed = true
          }
          return keep
        }),
      )
    : undefined

  return changed
    ? {
        ...scene,
        collections: nextCollections,
        nodes: nextNodes,
        rootNodeIds: scene.rootNodeIds.filter((nodeId) => nodeId in nextNodes),
      }
    : scene
}

function extractLegacyHomeAssistantBindings(scene: LegacySceneGraph): SceneGraph {
  const nextNodes = { ...scene.nodes }
  const nextRootNodeIds = [...scene.rootNodeIds]
  const existingBindingCollections = new Set(
    getHomeAssistantBindingNodes(nextNodes as any).map((node) => node.collectionId),
  )
  let nextCollections: NonNullable<SceneGraph['collections']> | null = null
  let changed = false

  for (const [collectionId, binding] of Object.entries(scene.homeAssistantBindings ?? {})) {
    if (!(binding && typeof binding === 'object')) {
      continue
    }

    const normalizedBinding = normalizeHomeAssistantCollectionBinding({
      ...(binding as Record<string, unknown>),
      collectionId: (binding.collectionId ??
        collectionId) as keyof HomeAssistantCollectionBindingMap,
    } as any)

    if (!normalizedBinding) {
      continue
    }
    if (existingBindingCollections.has(normalizedBinding.collectionId)) {
      changed = true
      continue
    }

    const bindingNode = createHomeAssistantBindingNode({
      binding: normalizedBinding,
      name: normalizedBinding.presentation?.label ?? `${collectionId} Home Assistant binding`,
    })

    if (!bindingNode) {
      continue
    }

    nextNodes[bindingNode.id] = bindingNode
    if (!nextRootNodeIds.includes(bindingNode.id)) {
      nextRootNodeIds.push(bindingNode.id)
    }
    existingBindingCollections.add(normalizedBinding.collectionId)
    changed = true
  }

  for (const [nodeId, rawNode] of Object.entries(nextNodes)) {
    if (
      !isRecord(rawNode) ||
      rawNode.type === 'home-assistant-binding' ||
      typeof rawNode.collectionId !== 'string' ||
      !Array.isArray(rawNode.resources)
    ) {
      continue
    }

    const legacyPresentation = readLegacyHomeAssistantPresentation(rawNode.presentation)
    const normalizedBinding = normalizeHomeAssistantCollectionBinding({
      aggregation: rawNode.aggregation,
      collectionId: rawNode.collectionId as keyof HomeAssistantCollectionBindingMap,
      presentation: legacyPresentation,
      primaryResourceId:
        typeof rawNode.primaryResourceId === 'string' ? rawNode.primaryResourceId : null,
      resources: rawNode.resources,
    } as any)

    if (!normalizedBinding || existingBindingCollections.has(normalizedBinding.collectionId)) {
      continue
    }

    const bindingNode = createHomeAssistantBindingNode({
      binding: normalizedBinding,
      name:
        typeof rawNode.name === 'string'
          ? rawNode.name
          : `${normalizedBinding.collectionId} Home Assistant binding`,
    })

    if (!bindingNode) {
      continue
    }

    const restoredNodeId = nodeId as AnyNodeId
    nextNodes[restoredNodeId] = {
      ...bindingNode,
      id: restoredNodeId,
      metadata: isRecord(rawNode.metadata) ? rawNode.metadata : bindingNode.metadata,
      parentId: typeof rawNode.parentId === 'string' ? (rawNode.parentId as AnyNodeId) : null,
      visible: rawNode.visible !== false,
    }
    if (!nextRootNodeIds.includes(restoredNodeId)) {
      nextRootNodeIds.push(restoredNodeId)
    }
    existingBindingCollections.add(normalizedBinding.collectionId)
    changed = true
  }

  for (const [collectionId, collection] of Object.entries(scene.collections ?? {})) {
    const legacyCollection = collection as Record<string, unknown>
    if (!isRecord(legacyCollection)) {
      continue
    }

    const legacyBindingCandidate = legacyCollection.homeAssistant
    const legacyResources = Array.isArray(
      (legacyBindingCandidate as { resources?: unknown[] } | undefined)?.resources,
    )
      ? ((legacyBindingCandidate as { resources: HomeAssistantResourceBinding[] }).resources ?? [])
      : []

    if (legacyResources.length === 0) {
      continue
    }

    const legacyHomeAssistantPresentation = readLegacyHomeAssistantPresentation(
      (legacyBindingCandidate as { presentation?: unknown } | undefined)?.presentation,
    )
    const legacyCollectionPresentation = readLegacyHomeAssistantPresentation(
      legacyCollection.presentation,
    )
    const legacyPresentation = {
      ...(legacyHomeAssistantPresentation ?? {}),
      ...(legacyCollectionPresentation ?? {}),
    }

    const normalizedBinding = normalizeHomeAssistantCollectionBinding({
      aggregation:
        typeof (legacyBindingCandidate as { aggregation?: unknown } | undefined)?.aggregation ===
        'string'
          ? ((legacyBindingCandidate as { aggregation?: string }).aggregation as any)
          : 'single',
      collectionId: collectionId as keyof HomeAssistantCollectionBindingMap,
      presentation: Object.keys(legacyPresentation).length > 0 ? legacyPresentation : undefined,
      primaryResourceId:
        typeof (legacyBindingCandidate as { primaryResourceId?: unknown } | undefined)
          ?.primaryResourceId === 'string'
          ? ((legacyBindingCandidate as { primaryResourceId?: string }).primaryResourceId ?? null)
          : null,
      resources: legacyResources,
    })

    if (!normalizedBinding) {
      continue
    }
    if (existingBindingCollections.has(normalizedBinding.collectionId)) {
      changed = true
      continue
    }

    const bindingNode = createHomeAssistantBindingNode({
      binding: normalizedBinding,
      name:
        typeof legacyCollection.name === 'string'
          ? `${legacyCollection.name} Home Assistant binding`
          : `${collectionId} Home Assistant binding`,
    })
    if (bindingNode) {
      nextNodes[bindingNode.id] = bindingNode
      if (!nextRootNodeIds.includes(bindingNode.id)) {
        nextRootNodeIds.push(bindingNode.id)
      }
      existingBindingCollections.add(normalizedBinding.collectionId)
    }
    nextCollections ??= { ...(scene.collections ?? {}) }
    nextCollections[collectionId as CollectionId] = {
      color: typeof legacyCollection.color === 'string' ? legacyCollection.color : undefined,
      controlNodeId:
        typeof legacyCollection.controlNodeId === 'string'
          ? (legacyCollection.controlNodeId as AnyNodeId)
          : undefined,
      id: collectionId as CollectionId,
      name: typeof legacyCollection.name === 'string' ? legacyCollection.name : collectionId,
      nodeIds: Array.isArray(legacyCollection.nodeIds)
        ? legacyCollection.nodeIds.filter(
            (nodeId): nodeId is AnyNodeId => typeof nodeId === 'string',
          )
        : [],
    }
    changed = true
  }

  return changed
    ? {
        collections: nextCollections ?? scene.collections,
        nodes: nextNodes,
        rootNodeIds: nextRootNodeIds,
      }
    : { collections: scene.collections, nodes: scene.nodes, rootNodeIds: scene.rootNodeIds }
}

function repairHomeAssistantPersistedState(scene: SceneGraph): SceneGraph {
  let nextCollections: SceneGraph['collections'] | null = null
  let nextNodes: SceneGraph['nodes'] | null = null
  const nextRootNodeIds = scene.rootNodeIds.filter((nodeId) => {
    const node = scene.nodes[nodeId]
    return node && (node as { type?: unknown }).type !== 'home-assistant-binding'
  })
  const allResourcesById = new Map<string, HomeAssistantResourceBinding>()

  for (const bindingNode of getHomeAssistantBindingNodes(scene.nodes as any)) {
    for (const resource of bindingNode.resources) {
      allResourcesById.set(resource.id, resource)
    }
  }

  for (const bindingNode of getHomeAssistantBindingNodes(scene.nodes as any)) {
    const collectionId = bindingNode.collectionId as string
    if (!scene.collections?.[collectionId as CollectionId]) {
      nextCollections ??= { ...(scene.collections ?? {}) }
      nextCollections[collectionId as CollectionId] = {
        id: collectionId as CollectionId,
        name: bindingNode.presentation?.label ?? bindingNode.name ?? collectionId,
        nodeIds: [],
      }
    }
    const sceneRawGroups = getSmartHomeRoomControlTileGroups({
      collectionId,
      presentation: bindingNode.presentation,
    })
    const bindingWithRepairedResources = repairHomeAssistantBindingResourcesFromGroups({
      binding: bindingNode,
      detachedResourceIds: getSmartHomeExcludedResourceIds(bindingNode.presentation),
      rawGroups: sceneRawGroups,
      allResourcesById,
    })
    const controlIds = getSmartHomeBindingControlIds(
      collectionId,
      bindingWithRepairedResources.resources,
    )
    if (controlIds.length === 0) {
      continue
    }

    const defaultGroups = [controlIds]
    const roomControlMode = getSmartHomeRoomControlMode(bindingWithRepairedResources.presentation)
    const storedGroups = getSmartHomeRoomControlTileGroups({
      collectionId,
      presentation: bindingWithRepairedResources.presentation,
    })
    const authoredGroups = normalizeSmartHomeRoomGroupsForBinding({
      collectionId,
      resources: bindingWithRepairedResources.resources,
      rawGroups: storedGroups,
    })
    const derivedGroups = normalizeSmartHomeRoomGroupsForBinding({
      collectionId,
      resources: bindingWithRepairedResources.resources,
      rawGroups: storedGroups,
      appendMissingControls: true,
    })
    const sceneHasCustomGroups =
      derivedGroups.length > 0 &&
      smartHomeRoomGroupsCoverControlIds(derivedGroups, controlIds) &&
      !isDefaultSmartHomeRoomGroup(derivedGroups, controlIds)
    const nextGroups =
      roomControlMode === 'user-managed'
        ? authoredGroups
        : sceneHasCustomGroups
          ? derivedGroups
          : defaultGroups

    if (
      bindingWithRepairedResources !== bindingNode ||
      !smartHomeRoomGroupsEqual(
        getSmartHomeRoomControlTileGroups({
          collectionId,
          presentation: bindingWithRepairedResources.presentation,
        }),
        nextGroups,
      )
    ) {
      nextNodes ??= { ...scene.nodes }
      nextNodes[bindingNode.id] = {
        ...bindingNode,
        ...bindingWithRepairedResources,
        presentation: {
          ...(bindingWithRepairedResources.presentation ?? {}),
          rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
            collectionId,
            excludedResourceIds: getSmartHomeExcludedResourceIds(
              bindingWithRepairedResources.presentation,
            ),
            groups: nextGroups,
            mode:
              roomControlMode === 'user-managed' || sceneHasCustomGroups
                ? 'user-managed'
                : roomControlMode,
            resources: bindingWithRepairedResources.resources,
          }),
        },
      }
    }
  }

  const rootNodeIdsChanged = nextRootNodeIds.length !== scene.rootNodeIds.length

  return nextNodes || nextCollections || rootNodeIdsChanged
    ? {
        ...scene,
        collections: nextCollections ?? scene.collections,
        nodes: nextNodes ?? scene.nodes,
        rootNodeIds: rootNodeIdsChanged ? nextRootNodeIds : scene.rootNodeIds,
      }
    : scene
}

function hydrateInteractiveAssets(scene: SceneGraph): SceneGraph {
  const sceneInteractiveAssetsById = new Map<string, unknown>()
  let nextNodes: SceneGraph['nodes'] | null = null

  for (const rawNode of Object.values(scene.nodes ?? {})) {
    if (!(isRecord(rawNode) && rawNode.type === 'item' && isRecord(rawNode.asset))) {
      continue
    }

    const assetId = typeof rawNode.asset.id === 'string' ? rawNode.asset.id : null
    if (assetId && rawNode.asset.interactive != null && !sceneInteractiveAssetsById.has(assetId)) {
      sceneInteractiveAssetsById.set(assetId, rawNode.asset.interactive)
    }
  }

  for (const [nodeId, rawNode] of Object.entries(scene.nodes ?? {})) {
    if (!(isRecord(rawNode) && rawNode.type === 'item' && isRecord(rawNode.asset))) {
      continue
    }

    const assetId = typeof rawNode.asset.id === 'string' ? rawNode.asset.id : null
    if (!(assetId && rawNode.asset.interactive == null)) {
      continue
    }

    const latestInteractive =
      sceneInteractiveAssetsById.get(assetId) ?? CATALOG_INTERACTIVE_ASSETS_BY_ID.get(assetId)
    if (!latestInteractive) {
      continue
    }

    nextNodes ??= { ...scene.nodes }
    nextNodes[nodeId] = {
      ...rawNode,
      asset: {
        ...rawNode.asset,
        interactive: latestInteractive,
      },
    }
  }

  return nextNodes ? { ...scene, nodes: nextNodes } : scene
}

function mergeDetachedHomeAssistantState(
  layoutScene: SceneGraph,
  storedScene: SceneGraph | null,
): SceneGraph {
  if (!storedScene) {
    return layoutScene
  }

  const storedBindingNodes = getHomeAssistantBindingNodes(storedScene.nodes as any)
  if (storedBindingNodes.length === 0) {
    return layoutScene
  }

  const nextNodes = { ...layoutScene.nodes }
  const nextCollections = { ...(layoutScene.collections ?? {}) }
  let changed = false

  for (const bindingNode of storedBindingNodes) {
    const layoutNode = nextNodes[bindingNode.id]
    if (!(isRecord(layoutNode) && layoutNode.type === 'home-assistant-binding')) {
      nextNodes[bindingNode.id] = bindingNode
      changed = true
    }

    const collectionId = bindingNode.collectionId as CollectionId
    const storedCollection = storedScene.collections?.[collectionId]
    const storedCollectionNodeIds = Array.isArray(storedCollection?.nodeIds)
      ? storedCollection.nodeIds
      : []
    const nextNodeIds = storedCollectionNodeIds.filter((nodeId) => Boolean(nextNodes[nodeId]))
    const storedCollectionName =
      typeof storedCollection?.name === 'string' ? storedCollection.name : undefined
    const storedCollectionColor =
      typeof storedCollection?.color === 'string' ? storedCollection.color : undefined
    const storedControlNodeId =
      typeof storedCollection?.controlNodeId === 'string'
        ? storedCollection.controlNodeId
        : undefined

    nextCollections[collectionId] = {
      id: collectionId,
      name:
        storedCollectionName ?? bindingNode.presentation?.label ?? bindingNode.name ?? collectionId,
      nodeIds: nextNodeIds ?? [],
      ...(storedCollectionColor ? { color: storedCollectionColor } : {}),
      ...(storedControlNodeId && nextNodes[storedControlNodeId]
        ? { controlNodeId: storedControlNodeId }
        : {}),
    }
    changed = true
  }

  return changed
    ? {
        ...layoutScene,
        collections: nextCollections,
        nodes: nextNodes,
        rootNodeIds: layoutScene.rootNodeIds.filter((nodeId) => nextNodes[nodeId]),
      }
    : layoutScene
}

export async function loadHomeScene(): Promise<SceneGraph | null> {
  const storedScene = readStoredScene()
  let repairedStoredScene: SceneGraph | null = null

  if (isUsableSceneGraph(storedScene)) {
    const sanitizedStoredScene = stripHiddenHomeAssistantGroupBindings(
      stripDeprecatedDemoBindings(
        extractLegacyHomeAssistantBindings(sanitizeLegacyScene(storedScene)),
      ),
    )
    repairedStoredScene = repairHomeAssistantPersistedState(sanitizedStoredScene)
    if (sceneHasAuthoredBuildingLayout(repairedStoredScene)) {
      const hydratedStoredScene = hydrateInteractiveAssets(repairedStoredScene)
      if (hydratedStoredScene !== storedScene) {
        writeStoredScene(hydratedStoredScene)
      }
      return hydratedStoredScene
    }
  }

  const response = await fetch(DEFAULT_LAYOUT_FILE, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${DEFAULT_LAYOUT_FILE}: ${response.status}`)
  }

  const layoutScene = (await response.json()) as LegacySceneGraph
  if (!isUsableSceneGraph(layoutScene)) {
    return null
  }

  const sanitizedLayoutScene = stripHiddenHomeAssistantGroupBindings(
    stripDeprecatedDemoBindings(
      extractLegacyHomeAssistantBindings(sanitizeLegacyScene(layoutScene)),
    ),
  )
  const repairedLayoutScene = repairHomeAssistantPersistedState(
    mergeDetachedHomeAssistantState(sanitizedLayoutScene, repairedStoredScene),
  )
  const hydratedLayoutScene = hydrateInteractiveAssets(repairedLayoutScene)
  writeStoredScene(hydratedLayoutScene)
  return hydratedLayoutScene
}
