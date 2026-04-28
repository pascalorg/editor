'use client'

import {
  CATALOG_ITEMS,
  Editor,
  getSmartHomeBindingControlIds,
  isHiddenHomeAssistantGroupResourceId,
  isDefaultSmartHomeRoomGroup,
  normalizeSmartHomeRoomGroupsForBinding,
  repairHomeAssistantBindingResourcesFromGroups,
  type SceneGraph,
  type SidebarTab,
  smartHomeRoomGroupsCoverControlIds,
  smartHomeRoomGroupsEqual,
  ViewerToolbarLeft,
  ViewerToolbarRight,
} from '@pascal-app/editor'
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
import Link from 'next/link'
import { useCallback } from 'react'

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
const PROJECT_ID = 'local-editor'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
]

const INTERACTIVE_ASSETS_BY_ID = new Map(
  CATALOG_ITEMS.filter((item) => item.interactive).map((item) => [item.id, item]),
)

type LegacySceneGraph = SceneGraph & {
  homeAssistantBindings?: HomeAssistantCollectionBindingMap
}

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
): HomeAssistantBindingPresentation | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const presentation: HomeAssistantBindingPresentation = {}
  if (typeof value.icon === 'string') {
    presentation.icon = value.icon
  }
  if (typeof value.label === 'string') {
    presentation.label = value.label
  }
  if (typeof value.rtsOrder === 'number') {
    presentation.rtsOrder = value.rtsOrder
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

function sceneHasBuilding(scene: SceneGraph): boolean {
  const siteId = scene.rootNodeIds[0]
  const siteNode = siteId ? scene.nodes[siteId] : null
  if (!(isRecord(siteNode) && siteNode.type === 'site' && Array.isArray(siteNode.children))) {
    return false
  }

  return siteNode.children.some((childId) => {
    const childNode = typeof childId === 'string' ? scene.nodes[childId] : null
    return isRecord(childNode) && childNode.type === 'building'
  })
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
          if (nextNodeIds.length === 0) {
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
  let nextNodes: SceneGraph['nodes'] | null = null
  const allResourcesById = new Map<string, HomeAssistantResourceBinding>()

  for (const bindingNode of getHomeAssistantBindingNodes(scene.nodes as any)) {
    for (const resource of bindingNode.resources) {
      allResourcesById.set(resource.id, resource)
    }
  }

  for (const bindingNode of getHomeAssistantBindingNodes(scene.nodes as any)) {
    const sceneRawGroups = bindingNode.presentation?.rtsGroups
    const collectionId = bindingNode.collectionId as string
    const bindingWithRepairedResources = repairHomeAssistantBindingResourcesFromGroups({
      binding: bindingNode,
      detachedResourceIds: bindingNode.presentation?.rtsExcludedResourceIds ?? [],
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
    const sceneGroups = normalizeSmartHomeRoomGroupsForBinding({
      collectionId,
      resources: bindingWithRepairedResources.resources,
      rawGroups: bindingWithRepairedResources.presentation?.rtsGroups,
      appendMissingControls: true,
    })
    const sceneHasCustomGroups =
      sceneGroups.length > 0 &&
      smartHomeRoomGroupsCoverControlIds(sceneGroups, controlIds) &&
      !isDefaultSmartHomeRoomGroup(sceneGroups, controlIds)
    const nextGroups = sceneHasCustomGroups ? sceneGroups : defaultGroups

    if (
      bindingWithRepairedResources !== bindingNode ||
      !smartHomeRoomGroupsEqual(bindingWithRepairedResources.presentation?.rtsGroups ?? [], nextGroups)
    ) {
      nextNodes ??= { ...scene.nodes }
      nextNodes[bindingNode.id] = {
        ...bindingWithRepairedResources,
        presentation: {
          ...(bindingWithRepairedResources.presentation ?? {}),
          rtsGroups: nextGroups,
        },
      }
    }
  }

  return nextNodes ? { ...scene, nodes: nextNodes } : scene
}

function hydrateInteractiveAssets(scene: SceneGraph): SceneGraph {
  let nextNodes: SceneGraph['nodes'] | null = null

  for (const [nodeId, rawNode] of Object.entries(scene.nodes ?? {})) {
    if (!(isRecord(rawNode) && rawNode.type === 'item' && isRecord(rawNode.asset))) {
      continue
    }

    const assetId = typeof rawNode.asset.id === 'string' ? rawNode.asset.id : null
    if (!(assetId && rawNode.asset.interactive == null)) {
      continue
    }

    const latestAsset = INTERACTIVE_ASSETS_BY_ID.get(assetId)
    if (!latestAsset?.interactive) {
      continue
    }

    nextNodes ??= { ...scene.nodes }
    nextNodes[nodeId] = {
      ...rawNode,
      asset: {
        ...rawNode.asset,
        interactive: latestAsset.interactive,
      },
    }
  }

  return nextNodes ? { ...scene, nodes: nextNodes } : scene
}

async function loadHomeScene(): Promise<SceneGraph | null> {
  const storedScene = readStoredScene()
  if (isUsableSceneGraph(storedScene)) {
    const sanitizedStoredScene = stripHiddenHomeAssistantGroupBindings(
      stripDeprecatedDemoBindings(
        extractLegacyHomeAssistantBindings(sanitizeLegacyScene(storedScene)),
      ),
    )
    const repairedStoredScene = repairHomeAssistantPersistedState(sanitizedStoredScene)
    if (sceneHasBuilding(repairedStoredScene)) {
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
  const repairedLayoutScene = repairHomeAssistantPersistedState(sanitizedLayoutScene)
  const hydratedLayoutScene = hydrateInteractiveAssets(repairedLayoutScene)
  writeStoredScene(hydratedLayoutScene)
  return hydratedLayoutScene
}

export default function Home() {
  const handleLoad = useCallback(() => loadHomeScene(), [])

  return (
    <div className="relative h-screen w-screen">
      {PROJECT_ID === 'local-editor' && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="text-muted-foreground">Local editor — scenes are not saved.</span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Open recent scenes
            </Link>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Create new
            </Link>
          </div>
        </div>
      )}
      <Editor
        layoutVersion="v2"
        onLoad={handleLoad}
        projectId={PROJECT_ID}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={<ViewerToolbarRight />}
      />
    </div>
  )
}
