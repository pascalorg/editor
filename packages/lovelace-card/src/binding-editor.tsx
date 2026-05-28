'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type Collection,
  type CollectionId,
  emitter,
  generateCollectionId,
  type ItemEvent,
  type ItemNode,
  resolveLevelId,
  useScene,
} from '@pascal-app/core'
import {
  bindResourceToCollectionBinding,
  buildCollectionBindingFromResource,
  createHomeAssistantBindingNode,
  getHomeAssistantBindingNodeMap,
  getPresentationAfterResourceRemoval,
  type HomeAssistantCollectionBinding,
  type HomeAssistantImportedResource,
  type HomeAssistantResourceBinding,
  isDeviceResource,
  isItemNode,
  normalizeHomeAssistantCollectionBinding,
  resolveExactCollectionForItems,
  toCollectionBinding,
} from '@pascal-app/home-assistant'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HassEntity, HomeAssistantLike, PascalViewerCardHomeAssistantConfig } from './types'

const PAIR_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Ccircle cx='8.5' cy='9.5' r='4.5' fill='%230b0f12' stroke='%2322d3ee' stroke-width='1.8'/%3E%3Ccircle cx='19.5' cy='18.5' r='4.5' fill='%230b0f12' stroke='%23fbbf24' stroke-width='1.8'/%3E%3Cpath d='M11.7 12.2L16.4 15.9' stroke='%23ffffff' stroke-width='1.9' stroke-linecap='round'/%3E%3Cpath d='M14.1 6.4h7.5' stroke='%2322d3ee' stroke-width='1.6' stroke-linecap='round' opacity='0.9'/%3E%3Cpath d='M6.3 20.6h7.5' stroke='%23fbbf24' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\") 8 8, crosshair"
const EDITOR_SELECTION_RETRY_FRAMES = 12

type SceneDraft = {
  collections: Record<CollectionId, Collection>
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
}

type ResourceOwner = {
  binding: HomeAssistantCollectionBinding
  collection: Collection | null
}

const CONTROL_DOMAINS = new Set([
  'climate',
  'cover',
  'fan',
  'humidifier',
  'light',
  'lock',
  'media_player',
  'switch',
  'vacuum',
])

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getEntityDomain(entityId: string) {
  return entityId.split('.', 1)[0] ?? ''
}

function getEntityLabel(entity: HassEntity) {
  const friendlyName = entity.attributes?.friendly_name
  if (typeof friendlyName === 'string' && friendlyName.trim().length > 0) {
    return friendlyName.trim()
  }

  const objectId = entity.entity_id.includes('.')
    ? entity.entity_id.slice(entity.entity_id.indexOf('.') + 1)
    : entity.entity_id
  return titleCase(objectId)
}

function getPowerActions(): HomeAssistantResourceBinding['actions'] {
  return [
    {
      capability: 'power',
      domain: 'homeassistant',
      fields: [],
      key: 'toggle',
      label: 'Toggle',
      service: 'toggle',
    },
    {
      capability: 'power',
      domain: 'homeassistant',
      fields: [],
      key: 'turn_on',
      label: 'Turn on',
      service: 'turn_on',
    },
    {
      capability: 'power',
      domain: 'homeassistant',
      fields: [],
      key: 'turn_off',
      label: 'Turn off',
      service: 'turn_off',
    },
  ]
}

function getEntityActions(domain: string): HomeAssistantResourceBinding['actions'] {
  if (domain === 'scene') {
    return [
      {
        capability: 'trigger',
        domain: 'scene',
        fields: [],
        key: 'turn_on',
        label: 'Activate',
        service: 'turn_on',
      },
    ]
  }

  if (domain === 'script') {
    return [
      {
        capability: 'trigger',
        domain: 'script',
        fields: [],
        key: 'turn_on',
        label: 'Run',
        service: 'turn_on',
      },
    ]
  }

  const actions: HomeAssistantResourceBinding['actions'] = [...getPowerActions()]

  if (domain === 'light') {
    actions.push({
      capability: 'brightness',
      domain: 'light',
      fields: [
        {
          key: 'brightness_pct',
          label: 'Brightness',
          required: false,
          selector: { number: { min: 0, max: 100, mode: 'slider' } },
        },
      ],
      key: 'brightness',
      label: 'Brightness',
      service: 'turn_on',
    })
  }

  if (domain === 'fan') {
    actions.push({
      capability: 'speed',
      domain: 'fan',
      fields: [
        {
          key: 'percentage',
          label: 'Speed',
          required: false,
          selector: { number: { min: 0, max: 100, mode: 'slider' } },
        },
      ],
      key: 'speed',
      label: 'Speed',
      service: 'set_percentage',
    })
  }

  if (domain === 'media_player') {
    actions.push(
      {
        capability: 'media',
        domain: 'media_player',
        fields: [],
        key: 'media_play_pause',
        label: 'Play/Pause',
        service: 'media_play_pause',
      },
      {
        capability: 'volume',
        domain: 'media_player',
        fields: [
          {
            key: 'volume_level',
            label: 'Volume',
            required: false,
            selector: { number: { min: 0, max: 1, mode: 'slider', step: 0.01 } },
          },
        ],
        key: 'volume',
        label: 'Volume',
        service: 'volume_set',
      },
    )
  }

  if (domain === 'climate') {
    actions.push({
      capability: 'temperature',
      domain: 'climate',
      fields: [
        {
          key: 'temperature',
          label: 'Temperature',
          required: false,
          selector: { number: { mode: 'box' } },
        },
      ],
      key: 'temperature',
      label: 'Temperature',
      service: 'set_temperature',
    })
  }

  return actions
}

function getEntityCapabilities(domain: string): HomeAssistantResourceBinding['capabilities'] {
  if (domain === 'scene' || domain === 'script' || domain === 'automation') {
    return ['trigger']
  }

  const capabilities: HomeAssistantResourceBinding['capabilities'] = ['power']
  if (domain === 'light') {
    capabilities.push('brightness')
  }
  if (domain === 'fan') {
    capabilities.push('speed')
  }
  if (domain === 'media_player') {
    capabilities.push('media', 'volume')
  }
  if (domain === 'climate') {
    capabilities.push('temperature')
  }
  return capabilities
}

function toImportedResourceFromEntity(entity: HassEntity): HomeAssistantImportedResource | null {
  const domain = getEntityDomain(entity.entity_id)
  if (!CONTROL_DOMAINS.has(domain)) {
    return null
  }

  const actions = getEntityActions(domain)
  return {
    actions,
    capabilities: getEntityCapabilities(domain),
    defaultActionKey: actions[0]?.key ?? null,
    description: entity.entity_id,
    domain,
    entityId: entity.entity_id,
    id: entity.entity_id,
    kind: 'entity',
    label: getEntityLabel(entity),
    state: entity.state,
  }
}

function buildResourceOwners(
  bindings: Record<CollectionId, HomeAssistantCollectionBinding>,
  collections: Record<CollectionId, Collection>,
) {
  const owners = new Map<string, ResourceOwner>()
  for (const binding of Object.values(bindings)) {
    for (const resource of binding.resources) {
      owners.set(resource.id, {
        binding,
        collection: collections[binding.collectionId] ?? null,
      })
    }
  }
  return owners
}

function getCollectionName(item: ItemNode) {
  return item.name?.trim() || item.asset.name?.trim() || 'Home control'
}

function cloneSceneDraft(): SceneDraft {
  const scene = useScene.getState()
  return {
    collections: { ...(scene.collections ?? {}) },
    nodes: { ...(scene.nodes as Record<AnyNodeId, AnyNode>) },
    rootNodeIds: [...scene.rootNodeIds],
  }
}

function extractHomeAssistantConfigFromDraft(
  draft: SceneDraft,
): PascalViewerCardHomeAssistantConfig {
  const bindings = Object.values(getDraftBindingMap(draft)).map((bindingNode) =>
    toCollectionBinding(bindingNode),
  )
  const collectionIds = new Set(bindings.map((binding) => binding.collectionId))
  const collections = Object.fromEntries(
    Array.from(collectionIds).flatMap((collectionId) => {
      const collection = draft.collections[collectionId]
      return collection ? [[collectionId, collection]] : []
    }),
  ) as Record<CollectionId, Collection>

  return { bindings, collections }
}

function writeDraftToScene(draft: SceneDraft) {
  const scene = useScene.getState()
  scene.setReadOnly(false)
  scene.setScene(draft.nodes, draft.rootNodeIds, draft.collections)
  scene.setReadOnly(true)
}

function getDraftBindingMap(draft: SceneDraft) {
  return getHomeAssistantBindingNodeMap(draft.nodes)
}

function getAggregation(
  resources: HomeAssistantResourceBinding[],
  collection: Collection | null | undefined,
) {
  if (resources.some((resource) => resource.kind !== 'entity')) {
    return 'trigger_only'
  }
  return resources.length > 1 || (collection?.nodeIds.length ?? 0) > 1 ? 'all' : 'single'
}

function removeBindingNode(draft: SceneDraft, nodeId: AnyNodeId) {
  delete draft.nodes[nodeId]
  draft.rootNodeIds = draft.rootNodeIds.filter((rootNodeId) => rootNodeId !== nodeId)
}

function upsertBindingNode(
  draft: SceneDraft,
  collection: Collection,
  binding: HomeAssistantCollectionBinding,
) {
  const existingBindingNode = getDraftBindingMap(draft)[collection.id]
  const nextNode = createHomeAssistantBindingNode({
    binding,
    id: existingBindingNode?.id,
    name: collection.name,
  })

  if (!nextNode) {
    return
  }

  draft.nodes[nextNode.id as AnyNodeId] = nextNode as unknown as AnyNode
  if (!draft.rootNodeIds.includes(nextNode.id as AnyNodeId)) {
    draft.rootNodeIds.push(nextNode.id as AnyNodeId)
  }
}

function ensureCollectionForItem(draft: SceneDraft, item: ItemNode) {
  const existingCollection = resolveExactCollectionForItems(draft.collections, [item])
  if (existingCollection) {
    return existingCollection
  }

  const collectionId = generateCollectionId()
  const collection: Collection = {
    controlNodeId: item.id as AnyNodeId,
    id: collectionId,
    name: getCollectionName(item),
    nodeIds: [item.id as AnyNodeId],
  }
  const existingCollectionIds = Array.isArray(item.collectionIds) ? item.collectionIds : []

  draft.collections[collectionId] = collection
  draft.nodes[item.id as AnyNodeId] = {
    ...item,
    collectionIds: Array.from(new Set([...existingCollectionIds, collectionId])),
  } as AnyNode

  return collection
}

function removeResourceFromBinding(
  draft: SceneDraft,
  collectionId: CollectionId,
  resourceId: string,
) {
  const bindingNode = getDraftBindingMap(draft)[collectionId]
  if (!bindingNode) {
    return
  }

  const nextResources = bindingNode.resources.filter((resource) => resource.id !== resourceId)
  if (nextResources.length === bindingNode.resources.length) {
    return
  }

  if (nextResources.length === 0) {
    removeBindingNode(draft, bindingNode.id as AnyNodeId)
    return
  }

  const collection = draft.collections[collectionId]
  const nextBinding = normalizeHomeAssistantCollectionBinding({
    ...toCollectionBinding(bindingNode),
    aggregation: getAggregation(nextResources, collection),
    presentation: getPresentationAfterResourceRemoval(
      bindingNode.presentation,
      bindingNode.collectionId,
      resourceId,
      nextResources,
    ),
    primaryResourceId:
      bindingNode.primaryResourceId === resourceId
        ? (nextResources[0]?.id ?? null)
        : (bindingNode.primaryResourceId ?? nextResources[0]?.id ?? null),
    resources: nextResources,
  })

  if (nextBinding && collection) {
    upsertBindingNode(draft, collection, nextBinding)
  }
}

function removeResourceFromOtherBindings(
  draft: SceneDraft,
  resource: HomeAssistantImportedResource,
  targetCollectionId: CollectionId,
) {
  for (const bindingNode of Object.values(getDraftBindingMap(draft))) {
    if (bindingNode.collectionId === targetCollectionId) {
      continue
    }
    removeResourceFromBinding(draft, bindingNode.collectionId, resource.id)
  }
}

function findSelectedBinding(
  selectedItemId: AnyNodeId | null,
  bindings: Record<CollectionId, HomeAssistantCollectionBinding>,
  collections: Record<CollectionId, Collection>,
) {
  if (!selectedItemId) {
    return null
  }

  const collection =
    Object.values(collections).find(
      (candidate) => candidate.nodeIds.includes(selectedItemId) && bindings[candidate.id],
    ) ?? null
  if (!collection) {
    return null
  }

  const binding = bindings[collection.id]
  return binding ? { binding, collection } : null
}

function isPairableItem(event: ItemEvent) {
  const { node } = event
  if (node.asset.category === 'door' || node.asset.category === 'window') {
    return false
  }

  const selectedLevelId = useViewer.getState().selection.levelId
  if (!selectedLevelId) {
    return true
  }

  return resolveLevelId(node, useScene.getState().nodes) === selectedLevelId
}

function clearPreview() {
  useViewer.getState().setPreviewSelectedIds([])
}

function selectEditorItem(nodeId: AnyNodeId | null) {
  const viewer = useViewer.getState()
  viewer.setSelection({
    selectedIds: nodeId ? [nodeId] : [],
    zoneId: null,
  })
  viewer.setHoveredId(nodeId)
}

function selectEditorItemAfterSceneUpdate(nodeId: AnyNodeId | null) {
  if (typeof window === 'undefined') {
    selectEditorItem(nodeId)
    return
  }

  let frames = 0
  const applySelection = () => {
    selectEditorItem(nodeId)
    frames += 1
    if (frames < EDITOR_SELECTION_RETRY_FRAMES) {
      window.requestAnimationFrame(applySelection)
    }
  }
  applySelection()
}

export function PascalBindingEditorOverlay({
  hass,
  onHomeAssistantConfigChange,
}: {
  hass: HomeAssistantLike | null
  onHomeAssistantConfigChange?: (config: PascalViewerCardHomeAssistantConfig) => void
}) {
  const sceneNodes = useScene((state) => state.nodes)
  const sceneCollections = useScene((state) => state.collections ?? {})
  const [query, setQuery] = useState('')
  const [pendingResourceId, setPendingResourceId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<AnyNodeId | null>(null)
  const pendingResourceIdRef = useRef<string | null>(null)

  const resources = useMemo(
    () =>
      Object.values(hass?.states ?? {})
        .filter((entity): entity is HassEntity => Boolean(entity?.entity_id))
        .flatMap((entity) => {
          const resource = toImportedResourceFromEntity(entity)
          return resource ? [resource] : []
        })
        .sort((left, right) => {
          const domainDelta = (left.domain ?? '').localeCompare(right.domain ?? '')
          return domainDelta === 0 ? left.label.localeCompare(right.label) : domainDelta
        }),
    [hass?.states],
  )
  const resourceById = useMemo(
    () => new Map(resources.map((resource) => [resource.id, resource] as const)),
    [resources],
  )
  const homeAssistantBindings = useMemo(
    () => getHomeAssistantBindingNodeMap(sceneNodes),
    [sceneNodes],
  )
  const resourceOwners = useMemo(
    () => buildResourceOwners(homeAssistantBindings, sceneCollections),
    [homeAssistantBindings, sceneCollections],
  )
  const selectedBinding = useMemo(
    () => findSelectedBinding(selectedItemId, homeAssistantBindings, sceneCollections),
    [homeAssistantBindings, sceneCollections, selectedItemId],
  )
  const filteredResources = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    const source = trimmed
      ? resources.filter(
          (resource) =>
            resource.label.toLowerCase().includes(trimmed) ||
            resource.id.toLowerCase().includes(trimmed) ||
            (resource.domain ?? '').toLowerCase().includes(trimmed),
        )
      : resources
    return source.slice(0, 48)
  }, [query, resources])

  useEffect(() => {
    pendingResourceIdRef.current = pendingResourceId
  }, [pendingResourceId])

  const commitDraft = useCallback(
    (draft: SceneDraft) => {
      writeDraftToScene(draft)
      onHomeAssistantConfigChange?.(extractHomeAssistantConfigFromDraft(draft))
    },
    [onHomeAssistantConfigChange],
  )

  const bindResourceToItem = useCallback(
    (resource: HomeAssistantImportedResource, item: ItemNode) => {
      if (!isDeviceResource(resource)) {
        return
      }

      const draft = cloneSceneDraft()
      const collection = ensureCollectionForItem(draft, item)
      removeResourceFromOtherBindings(draft, resource, collection.id)

      const existingBindingNode = getDraftBindingMap(draft)[collection.id]
      const nextBinding = existingBindingNode
        ? bindResourceToCollectionBinding({
            collection,
            existingBinding: toCollectionBinding(existingBindingNode),
            presentation: existingBindingNode.presentation,
            resource,
          })
        : buildCollectionBindingFromResource({
            collectionId: collection.id,
            presentation: { label: collection.name },
            resource,
          })

      upsertBindingNode(draft, collection, nextBinding)
      commitDraft(draft)
      setSelectedItemId(null)
      setPendingResourceId(null)
      clearPreview()
      selectEditorItemAfterSceneUpdate(null)
    },
    [commitDraft],
  )

  const unbindResource = useCallback(
    (collectionId: CollectionId, resourceId: string) => {
      const nextSelectedItemId =
        selectedItemId ??
        sceneCollections[collectionId]?.controlNodeId ??
        sceneCollections[collectionId]?.nodeIds[0] ??
        null
      const draft = cloneSceneDraft()
      removeResourceFromBinding(draft, collectionId, resourceId)
      commitDraft(draft)
      if (nextSelectedItemId) {
        setSelectedItemId(nextSelectedItemId)
        selectEditorItemAfterSceneUpdate(nextSelectedItemId)
      }
    },
    [commitDraft, sceneCollections, selectedItemId],
  )

  useEffect(() => {
    const previousCursor = typeof document !== 'undefined' ? document.body.style.cursor : ''
    if (typeof document !== 'undefined') {
      document.body.style.cursor = pendingResourceId ? PAIR_CURSOR : previousCursor
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.cursor = previousCursor
      }
    }
  }, [pendingResourceId])

  useEffect(() => {
    const onEnter = (event: ItemEvent) => {
      if (!pendingResourceIdRef.current || !isPairableItem(event)) {
        return
      }
      event.stopPropagation()
      const itemId = event.node.id as AnyNodeId
      const viewer = useViewer.getState()
      viewer.setHoveredId(itemId)
      viewer.setPreviewSelectedIds([itemId])
    }

    const onLeave = (event: ItemEvent) => {
      if (!pendingResourceIdRef.current) {
        return
      }
      event.stopPropagation()
      const previewIds = useViewer.getState().previewSelectedIds
      if (previewIds.length === 1 && previewIds[0] === event.node.id) {
        clearPreview()
      }
      if (useViewer.getState().hoveredId === event.node.id) {
        useViewer.getState().setHoveredId(null)
      }
    }

    const onClick = (event: ItemEvent) => {
      if (!isPairableItem(event)) {
        return
      }

      event.stopPropagation()
      const itemId = event.node.id as AnyNodeId
      setSelectedItemId(itemId)
      selectEditorItem(itemId)
      const pendingResource = pendingResourceIdRef.current
        ? resourceById.get(pendingResourceIdRef.current)
        : null
      if (pendingResource) {
        bindResourceToItem(pendingResource, event.node)
        setPendingResourceId(null)
        clearPreview()
      }
    }

    const onGridClick = () => {
      setPendingResourceId(null)
      setSelectedItemId(null)
      selectEditorItem(null)
      clearPreview()
    }

    emitter.on('item:enter', onEnter)
    emitter.on('item:leave', onLeave)
    emitter.on('item:click', onClick)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('item:enter', onEnter)
      emitter.off('item:leave', onLeave)
      emitter.off('item:click', onClick)
      emitter.off('grid:click', onGridClick)
      selectEditorItem(null)
      clearPreview()
    }
  }, [bindResourceToItem, resourceById])

  const pendingResource = pendingResourceId ? resourceById.get(pendingResourceId) : null
  const selectedNode = selectedItemId ? sceneNodes[selectedItemId] : null
  const selectedItem = isItemNode(selectedNode) ? selectedNode : null

  return (
    <div style={overlayStyle}>
      <div style={selectionPanelStyle}>
        <div style={selectionTitleStyle}>
          {selectedItem ? getCollectionName(selectedItem) : 'Select a Pascal object'}
        </div>
        {selectedBinding ? (
          <div style={boundListStyle}>
            {selectedBinding.binding.resources.map((resource) => (
              <button
                key={resource.id}
                onClick={() => unbindResource(selectedBinding.collection.id, resource.id)}
                style={boundChipStyle}
                type="button"
              >
                <span style={chipLabelStyle}>{resource.label}</span>
                <span style={chipActionStyle}>Unbind</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={hintStyle}>
            {pendingResource
              ? `Click the ${pendingResource.label} target in Pascal.`
              : 'Pick an HA entity, then click its Pascal object.'}
          </div>
        )}
      </div>

      <div style={pickerStyle}>
        <div style={pickerHeaderStyle}>
          <input
            aria-label="Search Home Assistant entities"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search HA entities"
            style={searchStyle}
            value={query}
          />
          <button
            disabled={!pendingResourceId}
            onClick={() => setPendingResourceId(null)}
            style={{
              ...smallButtonStyle,
              opacity: pendingResourceId ? 1 : 0.45,
            }}
            type="button"
          >
            Clear
          </button>
        </div>
        <div style={resourceListStyle}>
          {filteredResources.map((resource) => {
            const owner = resourceOwners.get(resource.id)
            const isPending = pendingResourceId === resource.id
            return (
              <div
                key={resource.id}
                style={{
                  ...resourceRowStyle,
                  borderColor: isPending ? '#fbbf24' : 'rgba(255,255,255,0.13)',
                }}
              >
                <button
                  onClick={() => {
                    if (selectedItem) {
                      bindResourceToItem(resource, selectedItem)
                      setPendingResourceId(null)
                      return
                    }
                    setPendingResourceId(resource.id)
                  }}
                  style={resourceMainButtonStyle}
                  type="button"
                >
                  <span style={resourceLabelStyle}>{resource.label}</span>
                  <span style={resourceMetaStyle}>
                    {resource.domain} - {owner?.collection?.name ?? resource.id}
                  </span>
                </button>
                {owner ? (
                  <button
                    aria-label={`Unbind ${resource.label}`}
                    onClick={() => unbindResource(owner.binding.collectionId, resource.id)}
                    style={rowActionButtonStyle}
                    type="button"
                  >
                    Unbind
                  </button>
                ) : (
                  <button
                    aria-label={`Bind ${resource.label}`}
                    onClick={() => {
                      if (selectedItem) {
                        bindResourceToItem(resource, selectedItem)
                        setPendingResourceId(null)
                        return
                      }
                      setPendingResourceId(resource.id)
                    }}
                    style={rowActionButtonStyle}
                    type="button"
                  >
                    Bind
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  inset: 0,
  pointerEvents: 'none',
  position: 'absolute',
  zIndex: 20,
}

const panelBaseStyle: React.CSSProperties = {
  backdropFilter: 'blur(14px)',
  background: 'rgba(10, 14, 22, 0.78)',
  border: '1px solid rgba(255,255,255,0.13)',
  boxShadow: '0 18px 42px rgba(0,0,0,0.34)',
  color: '#f8fafc',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
  pointerEvents: 'auto',
}

const selectionPanelStyle: React.CSSProperties = {
  ...panelBaseStyle,
  borderRadius: 8,
  left: 12,
  maxWidth: 'min(360px, calc(100% - 24px))',
  padding: 10,
  position: 'absolute',
  top: 12,
}

const selectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.2,
  marginBottom: 8,
}

const hintStyle: React.CSSProperties = {
  color: 'rgba(226,232,240,0.82)',
  fontSize: 12,
  lineHeight: 1.35,
}

const boundListStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
}

const boundChipStyle: React.CSSProperties = {
  alignItems: 'center',
  background: 'rgba(14,165,233,0.18)',
  border: '1px solid rgba(125,211,252,0.36)',
  borderRadius: 6,
  color: '#e0f2fe',
  cursor: 'pointer',
  display: 'flex',
  gap: 8,
  maxWidth: '100%',
  minHeight: 28,
  padding: '5px 8px',
}

const chipLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const chipActionStyle: React.CSSProperties = {
  color: '#fecdd3',
  flex: '0 0 auto',
  fontSize: 11,
}

const pickerStyle: React.CSSProperties = {
  ...panelBaseStyle,
  borderRadius: 8,
  bottom: 12,
  left: 12,
  maxHeight: 'min(42%, 300px)',
  maxWidth: 'min(520px, calc(100% - 24px))',
  minWidth: 'min(420px, calc(100% - 24px))',
  overflow: 'hidden',
  position: 'absolute',
}

const pickerHeaderStyle: React.CSSProperties = {
  alignItems: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  display: 'flex',
  gap: 8,
  padding: 8,
}

const searchStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  color: '#fff',
  flex: '1 1 auto',
  fontSize: 13,
  height: 32,
  minWidth: 0,
  outline: 'none',
  padding: '0 10px',
}

const smallButtonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.12)',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
  flex: '0 0 auto',
  fontSize: 12,
  height: 32,
  padding: '0 10px',
}

const resourceListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 238,
  overflow: 'auto',
  padding: 8,
}

const resourceRowStyle: React.CSSProperties = {
  alignItems: 'center',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.13)',
  borderRadius: 7,
  display: 'flex',
  gap: 8,
  minHeight: 44,
  padding: 5,
}

const resourceMainButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minWidth: 0,
  padding: '2px 4px',
  textAlign: 'left',
}

const resourceLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const resourceMetaStyle: React.CSSProperties = {
  color: 'rgba(226,232,240,0.65)',
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const rowActionButtonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.13)',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
  flex: '0 0 auto',
  fontSize: 12,
  height: 30,
  padding: '0 8px',
}
