'use client'

import {
  CATALOG_ITEMS,
  Editor,
  isHiddenHomeAssistantGroupResourceId,
  type SceneGraph,
  type SidebarTab,
  ViewerToolbarLeft,
  ViewerToolbarRight,
} from '@pascal-app/editor'
import {
  type AnyNodeId,
  type Collection,
  type CollectionId,
  createHomeAssistantBindingNode,
  getHomeAssistantBindingNodes,
  type HomeAssistantAction,
  type HomeAssistantBindingPresentation,
  type HomeAssistantCollectionBindingMap,
  type HomeAssistantCollectionCapability,
  type HomeAssistantResourceBinding,
  normalizeHomeAssistantCollectionBinding,
} from '@pascal-app/core/schema'
import { useCallback } from 'react'

const DEFAULT_LAYOUT_FILE = '/api/default-layout'
const LOCAL_STORAGE_KEY = 'pascal-editor-scene'
const DEMO_SCENE_VERSION_KEY = 'pascal-editor-ha-demo-version'
const DEMO_SCENE_VERSION = 3
const ROOM_GROUPS_STORAGE_KEY = 'pascal-room-control-groups:v1'
const LEGACY_EXCLUDED_ASSET_IDS = new Set(['pascal-truck'])
const DEPRECATED_DEMO_COLLECTION_IDS = new Set(['collection_demo4_living_script'])
const DEPRECATED_DEMO_RESOURCE_IDS = new Set(['script.pascal_living_room_demo'])
const DEMO_COLLECTIONS = [
  {
    id: 'collection_demo1_dining_light',
    itemNodeIds: ['item_4u7v10lcuew1uz5d'],
    controlNodeId: 'item_4u7v10lcuew1uz5d',
    kind: 'device',
    label: 'Ceiling Lamp',
    color: '#f59e0b',
    rtsOrder: 0,
    resource: {
      id: 'light.pascal_dining_single',
      kind: 'entity',
      entityId: 'light.pascal_dining_single',
      label: 'Ceiling Lamp',
      capabilities: ['brightness', 'power'],
    },
  },
  {
    id: 'collection_demo2_dining_group',
    itemNodeIds: ['item_4u7v10lcuew1uz5d', 'item_bsaz99veyhvvk64d', 'item_hl4fnqqei6rw93zv'],
    controlNodeId: 'item_4u7v10lcuew1uz5d',
    kind: 'group',
    label: 'Dining Lights',
    color: '#f59e0b',
    rtsOrder: 1,
    resource: {
      id: 'light.pascal_dining_group',
      kind: 'entity',
      entityId: 'light.pascal_dining_group',
      label: 'Dining Lights',
      capabilities: ['brightness', 'power'],
    },
  },
  {
    id: 'collection_demo3_master_fan',
    itemNodeIds: ['item_17lmti0qxpd9qg2e'],
    controlNodeId: 'item_17lmti0qxpd9qg2e',
    kind: 'device',
    label: 'Ceiling fan',
    color: '#3b82f6',
    rtsOrder: 0,
    resource: {
      id: 'fan.pascal_master_bedroom',
      kind: 'entity',
      entityId: 'fan.pascal_master_bedroom',
      label: 'Ceiling fan',
      capabilities: ['power', 'speed'],
    },
  },
] as const

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

function readStoredRoomGroups(): Record<string, string[][]> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(ROOM_GROUPS_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([collectionId, groups]) => {
        const normalizedGroups = readStringGroups(groups)
        return normalizedGroups?.length ? [[collectionId, normalizedGroups]] : []
      }),
    )
  } catch {
    return {}
  }
}

function writeStoredRoomGroups(groups: Record<string, string[][]>): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const entries = Object.entries(groups).filter(([, value]) => value.length > 0)
    if (entries.length === 0) {
      window.localStorage.removeItem(ROOM_GROUPS_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(ROOM_GROUPS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {}
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

function readDemoSceneVersion(): number {
  if (typeof window === 'undefined') {
    return 0
  }

  try {
    const rawValue = window.localStorage.getItem(DEMO_SCENE_VERSION_KEY)
    return rawValue ? Number.parseInt(rawValue, 10) || 0 : 0
  } catch {
    return 0
  }
}

function writeDemoSceneVersion(version: number): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DEMO_SCENE_VERSION_KEY, `${version}`)
  } catch {}
}

function hasBoundResource(scene: SceneGraph, resourceId: string): boolean {
  return getHomeAssistantBindingNodes(scene.nodes as any).some((bindingNode) =>
    bindingNode.resources.some((resource) => resource.id === resourceId),
  )
}

function buildResourceActions(
  definition: (typeof DEMO_COLLECTIONS)[number],
): HomeAssistantAction[] {
  const resourceDomain = definition.resource.id.split('.')[0] ?? 'homeassistant'
  const hasCapability = (capability: HomeAssistantCollectionCapability) =>
    (definition.resource.capabilities as readonly HomeAssistantCollectionCapability[]).includes(
      capability,
    )

  if (definition.resource.kind !== 'entity') {
    return [
      {
        capability: 'trigger',
        domain: resourceDomain,
        fields: [],
        key: `${resourceDomain}.turn_on`,
        label: 'Run',
        service: definition.resource.kind === 'automation' ? 'trigger' : 'turn_on',
      },
    ]
  }

  const actions: HomeAssistantAction[] = []

  if (hasCapability('power')) {
    actions.push(
      {
        capability: 'power',
        domain: resourceDomain,
        fields: hasCapability('brightness')
          ? [
              {
                defaultValue: 100,
                key: 'brightness_pct',
                label: 'Brightness',
                required: false,
                selector: null,
              },
            ]
          : [],
        key: `${resourceDomain}.turn_on`,
        label: 'Turn on',
        service: 'turn_on',
      },
      {
        capability: 'power',
        domain: resourceDomain,
        fields: [],
        key: `${resourceDomain}.turn_off`,
        label: 'Turn off',
        service: 'turn_off',
      },
    )
  }

  if (hasCapability('speed')) {
    actions.push({
      capability: 'speed',
      domain: resourceDomain,
      fields: [
        {
          defaultValue: 66,
          key: 'percentage',
          label: 'Speed',
          required: true,
          selector: null,
        },
      ],
      key: `${resourceDomain}.set_percentage`,
      label: 'Set speed',
      service: 'set_percentage',
    })
  }

  return actions
}

function buildDemoCollection(definition: (typeof DEMO_COLLECTIONS)[number]) {
  return {
    color: definition.color,
    controlNodeId: definition.controlNodeId as AnyNodeId,
    id: definition.id as CollectionId,
    name: definition.label,
    nodeIds: [...definition.itemNodeIds] as AnyNodeId[],
  } satisfies Collection
}

function buildDemoBindingNode(definition: (typeof DEMO_COLLECTIONS)[number]) {
  const actions = buildResourceActions(definition)
  const resourceKind = definition.resource.kind as string
  const binding = normalizeHomeAssistantCollectionBinding({
    aggregation:
      resourceKind === 'automation'
        ? 'trigger_only'
        : definition.itemNodeIds.length > 1
          ? 'all'
          : 'single',
    collectionId: definition.id,
    presentation: {
      label: definition.label,
      rtsOrder: definition.rtsOrder,
    },
    primaryResourceId: definition.resource.id,
    resources: [
      {
        actions,
        capabilities: [...definition.resource.capabilities],
        defaultActionKey: actions[0]?.key ?? null,
        entityId: definition.resource.entityId,
        id: definition.resource.id,
        kind: definition.resource.kind,
        label: definition.resource.label,
      },
    ],
  })

  return binding
    ? createHomeAssistantBindingNode({
        binding,
        name: `${definition.label} Home Assistant binding`,
      })
    : null
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
  const nextStoredRoomGroups = readStoredRoomGroups()

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
          delete nextStoredRoomGroups[rawNode.collectionId]
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

  writeStoredRoomGroups(nextStoredRoomGroups)

  return changed
    ? {
        ...scene,
        collections: nextCollections,
        nodes: nextNodes,
        rootNodeIds: scene.rootNodeIds.filter((nodeId) => nodeId in nextNodes),
      }
    : scene
}

function ensureDemoScenes(scene: SceneGraph): SceneGraph {
  const nextCollections = { ...(scene.collections ?? {}) }
  const nextNodes = { ...scene.nodes }
  const nextRootNodeIds = [...scene.rootNodeIds]
  let changed = false

  for (const definition of DEMO_COLLECTIONS) {
    const hasAllItems = definition.itemNodeIds.every((itemNodeId) =>
      Boolean(scene.nodes[itemNodeId]),
    )
    if (!(hasAllItems && !hasBoundResource(scene, definition.resource.id))) {
      continue
    }

    nextCollections[definition.id] = buildDemoCollection(definition)
    const nextBindingNode = buildDemoBindingNode(definition)
    if (nextBindingNode) {
      nextNodes[nextBindingNode.id] = nextBindingNode
      if (!nextRootNodeIds.includes(nextBindingNode.id)) {
        nextRootNodeIds.push(nextBindingNode.id)
      }
    }
    changed = true
  }

  return changed
    ? {
        ...scene,
        collections: nextCollections,
        nodes: nextNodes,
        rootNodeIds: nextRootNodeIds,
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

function getRoomControlTileId(collectionId: string, resourceId: string) {
  return `${collectionId}:home-assistant:${encodeURIComponent(resourceId)}`
}

function getLegacyRoomControlTileId(collectionId: string, resourceId: string) {
  return `${collectionId}:home-assistant:${resourceId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function cloneHomeAssistantResourceBinding(
  resource: HomeAssistantResourceBinding,
): HomeAssistantResourceBinding {
  return {
    ...resource,
    actions: resource.actions.map((action) => ({
      ...action,
      fields: action.fields?.map((field) => ({ ...field })),
    })),
    capabilities: [...resource.capabilities],
    ...(resource.memberEntityIds ? { memberEntityIds: [...resource.memberEntityIds] } : {}),
  }
}

function isHomeAssistantGroupResource(resource: HomeAssistantResourceBinding | null | undefined) {
  return Boolean(
    resource?.kind === 'entity' &&
      (resource.isGroup === true || (resource.memberEntityIds?.length ?? 0) > 0),
  )
}

function resourceHasControllableTarget(resource: HomeAssistantResourceBinding | null | undefined) {
  return Boolean(
    resource?.kind === 'entity' &&
      (resource.entityId?.trim() ||
        (resource.memberEntityIds?.length ?? 0) > 0 ||
        (resource.actions?.length ?? 0) > 0),
  )
}

function isHomeAssistantControllableEntityResource(
  resource: HomeAssistantResourceBinding | null | undefined,
) {
  return Boolean(resource?.kind === 'entity' && resourceHasControllableTarget(resource))
}

function isHomeAssistantDeviceComponentResource(
  resource: HomeAssistantResourceBinding | null | undefined,
): resource is HomeAssistantResourceBinding {
  return Boolean(
    resource?.kind === 'entity' &&
      !isHomeAssistantGroupResource(resource) &&
      resourceHasControllableTarget(resource),
  )
}

function getBindingPillControlResources(resources: HomeAssistantResourceBinding[]) {
  const entityResources = resources.filter((resource) => resource.kind === 'entity')
  const deviceResources = entityResources.filter(isHomeAssistantDeviceComponentResource)
  const controllableResources = entityResources.filter(isHomeAssistantControllableEntityResource)

  return deviceResources.length > 0
    ? deviceResources
    : controllableResources.length > 0
      ? controllableResources
      : entityResources.filter(isHomeAssistantGroupResource).slice(0, 1)
}

function normalizeHomeAssistantRtsGroupsForBinding(
  collectionId: string,
  resources: HomeAssistantResourceBinding[],
  rawGroups: unknown,
) {
  const controlResources = getBindingPillControlResources(resources)
  const controlIds = controlResources.map((resource) => getRoomControlTileId(collectionId, resource.id))
  const validControlIds = new Set(controlIds)
  const aliasMap = new Map<string, string>()
  const rawStringGroups = readStringGroups(rawGroups)

  if (!rawStringGroups?.length) {
    return []
  }

  controlResources.forEach((resource, index) => {
    const currentTileId = getRoomControlTileId(collectionId, resource.id)
    const legacyTileId = getLegacyRoomControlTileId(collectionId, resource.id)
    for (const alias of [
      currentTileId,
      `${currentTileId}:${index}`,
      legacyTileId,
      `${legacyTileId}:${index}`,
    ]) {
      aliasMap.set(alias, currentTileId)
    }
  })

  const assigned = new Set<string>()
  const groups = rawStringGroups
    .map((group) => {
      const members: string[] = []
      for (const rawMemberId of group) {
        const memberId = aliasMap.get(rawMemberId) ?? rawMemberId
        if (!validControlIds.has(memberId) || assigned.has(memberId)) {
          continue
        }
        assigned.add(memberId)
        members.push(memberId)
      }
      return members
    })
    .filter((group) => group.length > 0)

  for (const controlId of controlIds) {
    if (!assigned.has(controlId)) {
      groups.push([controlId])
    }
  }

  return groups
}

function groupsMatch(left: string[][], right: string[][]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isDefaultMergedGroup(groups: string[][], controlIds: string[]) {
  return (
    groups.length === 1 &&
    groups[0]?.length === controlIds.length &&
    controlIds.every((controlId) => groups[0]?.includes(controlId))
  )
}

function groupsCoverControlIds(groups: string[][], controlIds: string[]) {
  const groupedIds = new Set(groups.flat())
  return controlIds.length > 0 && controlIds.every((controlId) => groupedIds.has(controlId))
}

function storedRoomGroupsMatch(
  left: Record<string, string[][]>,
  right: Record<string, string[][]>,
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function getReferencedResourceIdsFromRoomGroups(
  collectionId: string,
  rawGroups: unknown,
  availableResources: HomeAssistantResourceBinding[],
) {
  const rawStringGroups = readStringGroups(rawGroups)
  if (!rawStringGroups?.length) {
    return new Set<string>()
  }

  const prefix = `${collectionId}:home-assistant:`
  const resourceAliases = new Map<string, string>()
  for (const resource of availableResources) {
    const currentTileId = getRoomControlTileId(collectionId, resource.id)
    const legacyTileId = getLegacyRoomControlTileId(collectionId, resource.id)
    resourceAliases.set(currentTileId, resource.id)
    resourceAliases.set(legacyTileId, resource.id)
    resourceAliases.set(`${currentTileId}:0`, resource.id)
    resourceAliases.set(`${legacyTileId}:0`, resource.id)
  }

  const referencedResourceIds = new Set<string>()
  for (const rawMemberId of rawStringGroups.flat()) {
    const aliasedResourceId = resourceAliases.get(rawMemberId)
    if (aliasedResourceId) {
      referencedResourceIds.add(aliasedResourceId)
      continue
    }

    if (!rawMemberId.startsWith(prefix)) {
      continue
    }

    const encodedResourceId = rawMemberId.slice(prefix.length).replace(/:\d+$/, '')
    try {
      referencedResourceIds.add(decodeURIComponent(encodedResourceId))
    } catch {
      referencedResourceIds.add(encodedResourceId)
    }
  }

  return referencedResourceIds
}

function repairHomeAssistantBindingResourcesFromGroups(
  bindingNode: ReturnType<typeof getHomeAssistantBindingNodes>[number],
  allResourcesById: Map<string, HomeAssistantResourceBinding>,
  rawGroups: unknown,
) {
  if (!bindingNode.resources.some(isHomeAssistantGroupResource)) {
    return bindingNode
  }

  const collectionId = bindingNode.collectionId as string
  const referencedResourceIds = getReferencedResourceIdsFromRoomGroups(
    collectionId,
    rawGroups,
    Array.from(allResourcesById.values()),
  )
  if (referencedResourceIds.size === 0) {
    return bindingNode
  }

  const currentControlResourceIds = new Set(
    getBindingPillControlResources(bindingNode.resources).map((resource) => resource.id),
  )
  const nextResourcesById = new Map<string, HomeAssistantResourceBinding>()

  for (const resource of bindingNode.resources) {
    if (
      isHomeAssistantDeviceComponentResource(resource) &&
      !referencedResourceIds.has(resource.id)
    ) {
      continue
    }
    nextResourcesById.set(resource.id, cloneHomeAssistantResourceBinding(resource))
  }

  for (const resourceId of referencedResourceIds) {
    if (nextResourcesById.has(resourceId)) {
      continue
    }
    const referencedResource = allResourcesById.get(resourceId)
    if (!isHomeAssistantDeviceComponentResource(referencedResource)) {
      continue
    }
    nextResourcesById.set(resourceId, cloneHomeAssistantResourceBinding(referencedResource))
  }

  const nextExcludedResourceIds = Array.from(
    new Set([
      ...(bindingNode.presentation?.rtsExcludedResourceIds ?? []),
      ...Array.from(currentControlResourceIds).filter(
        (resourceId) => !referencedResourceIds.has(resourceId),
      ),
    ]),
  )
  const nextResources = Array.from(nextResourcesById.values())
  const nextBinding = normalizeHomeAssistantCollectionBinding({
    aggregation: nextResources.some((resource) => resource.kind !== 'entity')
      ? 'trigger_only'
      : nextResources.filter(isHomeAssistantDeviceComponentResource).length > 1
        ? 'all'
        : 'single',
    collectionId: bindingNode.collectionId,
    presentation: {
      ...(bindingNode.presentation ?? {}),
      rtsExcludedResourceIds: nextExcludedResourceIds,
    },
    primaryResourceId:
      bindingNode.primaryResourceId && nextResourcesById.has(bindingNode.primaryResourceId)
        ? bindingNode.primaryResourceId
        : (nextResources.find(isHomeAssistantDeviceComponentResource)?.id ??
          nextResources[0]?.id ??
          null),
    resources: nextResources,
  })

  return nextBinding ? { ...bindingNode, ...nextBinding } : bindingNode
}

function repairHomeAssistantPersistedState(scene: SceneGraph): SceneGraph {
  const storedRoomGroups = readStoredRoomGroups()
  const nextStoredRoomGroups = { ...storedRoomGroups }
  let nextNodes: SceneGraph['nodes'] | null = null
  const allResourcesById = new Map<string, HomeAssistantResourceBinding>()

  for (const bindingNode of getHomeAssistantBindingNodes(scene.nodes as any)) {
    for (const resource of bindingNode.resources) {
      allResourcesById.set(resource.id, resource)
    }
  }

  for (const bindingNode of getHomeAssistantBindingNodes(scene.nodes as any)) {
    const storedRawGroups = storedRoomGroups[bindingNode.collectionId as string]
    const sceneRawGroups = bindingNode.presentation?.rtsGroups
    const bindingWithRepairedResources = repairHomeAssistantBindingResourcesFromGroups(
      bindingNode,
      allResourcesById,
      readStringGroups(storedRawGroups)?.length ? storedRawGroups : sceneRawGroups,
    )
    const collectionId = bindingNode.collectionId as string
    const controlIds = getBindingPillControlResources(bindingWithRepairedResources.resources).map((resource) =>
      getRoomControlTileId(collectionId, resource.id),
    )
    if (controlIds.length === 0) {
      continue
    }

    const defaultGroups = [controlIds]
    const sceneGroups = normalizeHomeAssistantRtsGroupsForBinding(
      collectionId,
      bindingWithRepairedResources.resources,
      bindingWithRepairedResources.presentation?.rtsGroups,
    )
    const storedGroups = normalizeHomeAssistantRtsGroupsForBinding(
      collectionId,
      bindingWithRepairedResources.resources,
      storedRoomGroups[collectionId],
    )
    const sceneHasCustomGroups =
      sceneGroups.length > 0 &&
      groupsCoverControlIds(sceneGroups, controlIds) &&
      !isDefaultMergedGroup(sceneGroups, controlIds)
    const storedHasCustomGroups =
      storedGroups.length > 0 &&
      groupsCoverControlIds(storedGroups, controlIds) &&
      !isDefaultMergedGroup(storedGroups, controlIds)
    const nextGroups = storedHasCustomGroups
      ? storedGroups
      : sceneGroups.length > 0
        ? sceneGroups
        : defaultGroups

    if (!groupsMatch(storedRoomGroups[collectionId] ?? [], nextGroups)) {
      nextStoredRoomGroups[collectionId] = nextGroups
    }

    if (
      bindingWithRepairedResources !== bindingNode ||
      !groupsMatch(bindingWithRepairedResources.presentation?.rtsGroups ?? [], nextGroups)
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

  if (!storedRoomGroupsMatch(storedRoomGroups, nextStoredRoomGroups)) {
    writeStoredRoomGroups(nextStoredRoomGroups)
  }

  return nextNodes ? { ...scene, nodes: nextNodes } : scene
}

function maybeApplyDemoScenes(scene: SceneGraph): SceneGraph {
  return readDemoSceneVersion() < DEMO_SCENE_VERSION ? ensureDemoScenes(scene) : scene
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
    const demoStoredScene = maybeApplyDemoScenes(sanitizedStoredScene)
    const repairedStoredScene = repairHomeAssistantPersistedState(demoStoredScene)
    if (sceneHasBuilding(repairedStoredScene)) {
      const hydratedStoredScene = hydrateInteractiveAssets(repairedStoredScene)
      if (hydratedStoredScene !== storedScene) {
        writeStoredScene(hydratedStoredScene)
        writeDemoSceneVersion(DEMO_SCENE_VERSION)
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
  const demoLayoutScene = maybeApplyDemoScenes(sanitizedLayoutScene)
  const repairedLayoutScene = repairHomeAssistantPersistedState(demoLayoutScene)
  const hydratedLayoutScene = hydrateInteractiveAssets(repairedLayoutScene)
  writeStoredScene(hydratedLayoutScene)
  writeDemoSceneVersion(DEMO_SCENE_VERSION)
  return hydratedLayoutScene
}

export default function Home() {
  const handleLoad = useCallback(() => loadHomeScene(), [])

  return (
    <div className="h-screen w-screen">
      <Editor
        layoutVersion="v2"
        onLoad={handleLoad}
        projectId="local-editor"
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={<ViewerToolbarRight />}
      />
    </div>
  )
}
