import type {
  AnyNodeId,
  Collection,
  CollectionCapability,
  CollectionHomeAssistantAction,
  CollectionHomeAssistantActionField,
  CollectionHomeAssistantResourceBinding,
  CollectionId,
  CollectionKind,
  CollectionZoneId,
  ItemNode,
} from '@pascal-app/core/schema'
import { normalizeCollection } from '@pascal-app/core/schema'
import type {
  HomeAssistantAvailableAction,
  HomeAssistantAvailableActionField,
  HomeAssistantDiscoveredDevice,
} from './home-assistant'

export type HomeAssistantImportedResource = CollectionHomeAssistantResourceBinding & {
  description: string
  domain: string | null
  state: string | null
}

const dedupeCapabilities = (capabilities: CollectionCapability[]) =>
  Array.from(new Set(capabilities))

const mapField = (
  field: HomeAssistantAvailableActionField,
): CollectionHomeAssistantActionField => ({
  defaultValue: field.defaultValue,
  key: field.key,
  label: field.label,
  required: field.required,
  selector: field.selector ?? null,
})

const inferCapabilitiesFromAction = (
  action: Pick<HomeAssistantAvailableAction, 'actionKind' | 'domain' | 'fields' | 'service'>,
) => {
  const capabilities: CollectionCapability[] = []

  switch (action.actionKind) {
    case 'connect':
    case 'next':
    case 'pause':
    case 'play':
    case 'previous':
    case 'stop':
      capabilities.push('media')
      break
    case 'power':
    case 'turn_off':
    case 'turn_on':
      capabilities.push('power')
      break
    case 'volume':
      capabilities.push('volume')
      break
    default:
      break
  }

  if (
    action.service === 'set_percentage' ||
    action.fields.some((field) => field.key === 'percentage')
  ) {
    capabilities.push(action.domain === 'fan' ? 'speed' : 'brightness')
  }

  if (
    action.fields.some((field) =>
      ['brightness', 'brightness_pct'].includes(field.key),
    )
  ) {
    capabilities.push('brightness')
  }

  if (
    action.fields.some((field) =>
      ['temperature', 'target_temp_high', 'target_temp_low'].includes(field.key),
    ) || action.service === 'set_temperature'
  ) {
    capabilities.push('temperature')
  }

  if (action.domain === 'scene' || action.domain === 'script' || action.domain === 'automation') {
    capabilities.push('trigger')
  }

  return dedupeCapabilities(capabilities)
}

export const toCollectionHomeAssistantAction = (
  action: HomeAssistantAvailableAction,
): CollectionHomeAssistantAction => ({
  capability: inferCapabilitiesFromAction(action)[0] ?? 'trigger',
  domain: action.domain,
  fields: action.fields.map((field) => mapField(field)),
  key: action.key,
  label: action.label,
  service: action.service,
})

export const toImportedEntityResource = (
  device: HomeAssistantDiscoveredDevice,
): HomeAssistantImportedResource => {
  const actions = device.availableActions.map((action) => toCollectionHomeAssistantAction(action))
  return {
    actions,
    capabilities: dedupeCapabilities(actions.map((action) => action.capability)),
    defaultActionKey: device.defaultActionKey,
    description: device.description,
    domain: device.haEntityId?.split('.')[0] ?? null,
    entityId: device.haEntityId,
    id: device.haEntityId ?? device.id,
    kind: 'entity',
    label: device.name,
    state: null,
  }
}

export const buildCollectionBindingFromResource = (
  resource: HomeAssistantImportedResource,
): Collection['homeAssistant'] => ({
  aggregation: resource.kind === 'entity' ? 'single' : 'trigger_only',
  primaryResourceId: resource.id,
  resources: [
    {
      actions: resource.actions,
      capabilities: resource.capabilities,
      defaultActionKey: resource.defaultActionKey,
      entityId: resource.entityId,
      id: resource.id,
      kind: resource.kind,
      label: resource.label,
    },
  ],
})

export const getCollectionRoomZoneIds = (
  collection: Collection,
  zoneIds: CollectionZoneId[] = [],
) => {
  const normalizedZoneIds = Array.from(
    new Set([...(collection.zoneIds ?? []), ...zoneIds]),
  ).filter((zoneId): zoneId is CollectionZoneId => typeof zoneId === 'string')

  return normalizedZoneIds.length > 0 ? normalizedZoneIds : undefined
}

export const inferCollectionKindFromResource = (
  resource: HomeAssistantImportedResource,
): CollectionKind => (resource.kind === 'entity' ? 'device' : 'automation')

export const getCollectionBindingDisplayLabel = (collection: Collection) =>
  collection.presentation?.label?.trim() || collection.name.trim() || 'Collection'

export const collectionHasHomeAssistantBinding = (collection: Collection | null | undefined) =>
  Boolean(collection?.homeAssistant?.resources?.length)

export const resolveCollectionForSelectedItems = ({
  collections,
  selectedIds,
}: {
  collections: Record<CollectionId, Collection>
  selectedIds: AnyNodeId[]
}) => {
  if (selectedIds.length === 0) {
    return null
  }

  const matchingCollections = Object.values(collections).filter((collection) =>
    selectedIds.every((selectedId) => collection.nodeIds.includes(selectedId)),
  )

  if (matchingCollections.length > 0) {
    return matchingCollections[0] ?? null
  }

  const collectionIds = new Set<CollectionId>()
  for (const collection of Object.values(collections)) {
    if (collection.nodeIds.some((nodeId) => selectedIds.includes(nodeId))) {
      collectionIds.add(collection.id)
    }
  }

  return collectionIds.size === 1 ? collections[Array.from(collectionIds)[0]!] : null
}

export const buildCollectionForSelection = ({
  color,
  controlNodeId,
  name,
  selectedItems,
  zoneIds,
}: {
  color?: string
  controlNodeId?: AnyNodeId
  name: string
  selectedItems: ItemNode[]
  zoneIds?: CollectionZoneId[]
}) =>
  normalizeCollection({
    color,
    id: '' as CollectionId,
    name,
    nodeIds: selectedItems.map((item) => item.id),
    controlNodeId: controlNodeId ?? selectedItems[0]?.id,
    zoneIds,
  })

export const bindResourceToCollection = ({
  collection,
  resource,
  zoneIds,
}: {
  collection: Collection
  resource: HomeAssistantImportedResource
  zoneIds?: CollectionZoneId[]
}) => {
  const existingResources = collection.homeAssistant?.resources ?? []
  const nextResources = existingResources.some((entry) => entry.id === resource.id)
    ? existingResources.map((entry) =>
        entry.id === resource.id
          ? {
              actions: resource.actions,
              capabilities: resource.capabilities,
              defaultActionKey: resource.defaultActionKey,
              entityId: resource.entityId,
              id: resource.id,
              kind: resource.kind,
              label: resource.label,
            }
          : entry,
      )
    : [
        ...existingResources,
        {
          actions: resource.actions,
          capabilities: resource.capabilities,
          defaultActionKey: resource.defaultActionKey,
          entityId: resource.entityId,
          id: resource.id,
          kind: resource.kind,
          label: resource.label,
        },
      ]

  const nextCapabilities = dedupeCapabilities([
    ...(collection.capabilities ?? []),
    ...nextResources.flatMap((entry) => entry.capabilities),
  ])

  const nextKind =
    resource.kind === 'entity'
      ? nextResources.length > 1 || collection.nodeIds.length > 1
        ? 'group'
        : 'device'
      : 'automation'

  return normalizeCollection({
    ...collection,
    capabilities: nextCapabilities,
    homeAssistant: {
      aggregation:
        nextKind === 'automation'
          ? 'trigger_only'
          : nextResources.length > 1
            ? 'all'
            : 'single',
      primaryResourceId: collection.homeAssistant?.primaryResourceId ?? resource.id,
      resources: nextResources,
    },
    kind: nextKind,
    presentation: {
      ...collection.presentation,
      label: collection.presentation?.label ?? resource.label,
    },
    zoneIds: getCollectionRoomZoneIds(collection, zoneIds),
  })
}
