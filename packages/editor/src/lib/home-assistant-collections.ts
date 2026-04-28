import type {
  AnyNodeId,
  Collection,
  CollectionId,
  HomeAssistantAction,
  HomeAssistantActionField,
  HomeAssistantBindingPresentation,
  HomeAssistantCollectionBinding,
  HomeAssistantCollectionCapability,
  HomeAssistantResourceBinding,
  ItemNode,
} from '@pascal-app/core/schema'
import {
  normalizeCollection,
  normalizeHomeAssistantCollectionBinding,
} from '@pascal-app/core/schema'
import type {
  HomeAssistantAvailableAction,
  HomeAssistantAvailableActionField,
  HomeAssistantDiscoveredDevice,
} from './home-assistant'

export type HomeAssistantImportedResource = HomeAssistantResourceBinding & {
  description: string
  domain: string | null
  state: string | null
}

export const HIDDEN_HOME_ASSISTANT_GROUP_RESOURCE_IDS = new Set([
  'light.pascal_kitchen_perimeter_lights_group',
  'light.pascal_kitchen_table_lights_group',
  'light.pascal_living_room_lamps_group',
  'light.pascal_main_floor_lights_group',
])

export function isHiddenHomeAssistantGroupResourceId(resourceId: string | null | undefined) {
  return Boolean(resourceId && HIDDEN_HOME_ASSISTANT_GROUP_RESOURCE_IDS.has(resourceId))
}

const dedupeCapabilities = (capabilities: HomeAssistantCollectionCapability[]) =>
  Array.from(new Set(capabilities))

const mapField = (field: HomeAssistantAvailableActionField): HomeAssistantActionField => ({
  defaultValue: field.defaultValue,
  key: field.key,
  label: field.label,
  required: field.required,
  selector: field.selector ?? null,
})

const inferCapabilitiesFromAction = (
  action: Pick<HomeAssistantAvailableAction, 'actionKind' | 'domain' | 'fields' | 'service'>,
) => {
  const capabilities: HomeAssistantCollectionCapability[] = []

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

  if (action.fields.some((field) => ['brightness', 'brightness_pct'].includes(field.key))) {
    capabilities.push('brightness')
  }

  if (
    action.fields.some((field) =>
      ['temperature', 'target_temp_high', 'target_temp_low'].includes(field.key),
    ) ||
    action.service === 'set_temperature'
  ) {
    capabilities.push('temperature')
  }

  if (action.domain === 'scene' || action.domain === 'script' || action.domain === 'automation') {
    capabilities.push('trigger')
  }

  return dedupeCapabilities(capabilities)
}

export const toHomeAssistantAction = (
  action: HomeAssistantAvailableAction,
): HomeAssistantAction => ({
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
  const actions = device.availableActions.map((action) => toHomeAssistantAction(action))
  const capabilities = dedupeCapabilities([
    ...actions.map((action) => action.capability),
    ...device.availableActions.flatMap((action) => inferCapabilitiesFromAction(action)),
  ])

  return {
    actions,
    capabilities,
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

const toResourceBinding = (
  resource: HomeAssistantImportedResource,
): HomeAssistantResourceBinding => {
  const memberEntityIds = resource.memberEntityIds ?? []
  const isGroup = resource.isGroup === true || memberEntityIds.length > 0

  return {
    actions: resource.actions,
    capabilities: resource.capabilities,
    defaultActionKey: resource.defaultActionKey,
    entityId: resource.entityId,
    id: resource.id,
    ...(isGroup
      ? {
          isGroup: true,
          memberEntityIds,
        }
      : {}),
    kind: resource.kind,
    label: resource.label,
  }
}

export const buildCollectionBindingFromResource = ({
  collectionId,
  presentation,
  resource,
}: {
  collectionId: CollectionId
  presentation?: HomeAssistantBindingPresentation
  resource: HomeAssistantImportedResource
}) =>
  normalizeHomeAssistantCollectionBinding({
    aggregation: resource.kind === 'entity' ? 'single' : 'trigger_only',
    collectionId,
    presentation,
    primaryResourceId: resource.id,
    resources: [toResourceBinding(resource)],
  }) as HomeAssistantCollectionBinding

export const getCollectionBindingDisplayLabel = (
  collection: Collection,
  binding?: HomeAssistantCollectionBinding | null,
) => binding?.presentation?.label?.trim() || collection.name.trim() || 'Collection'

export const collectionHasHomeAssistantBinding = (
  binding: HomeAssistantCollectionBinding | null | undefined,
) => Boolean(binding?.resources?.length)

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
}: {
  color?: string
  controlNodeId?: AnyNodeId
  name: string
  selectedItems: ItemNode[]
}) =>
  normalizeCollection({
    color,
    id: '' as CollectionId,
    name,
    nodeIds: selectedItems.map((item) => item.id),
    controlNodeId: controlNodeId ?? selectedItems[0]?.id,
  })

export const bindResourceToCollectionBinding = ({
  collection,
  existingBinding,
  presentation,
  resource,
}: {
  collection: Collection
  existingBinding?: HomeAssistantCollectionBinding | null
  presentation?: HomeAssistantBindingPresentation
  resource: HomeAssistantImportedResource
}) => {
  const existingResources = existingBinding?.resources ?? []
  const nextResources = existingResources.some((entry) => entry.id === resource.id)
    ? existingResources.map((entry) =>
        entry.id === resource.id ? toResourceBinding(resource) : entry,
      )
    : [...existingResources, toResourceBinding(resource)]

  return normalizeHomeAssistantCollectionBinding({
    aggregation: nextResources.some((entry) => entry.kind !== 'entity')
      ? 'trigger_only'
      : nextResources.length > 1 || collection.nodeIds.length > 1
        ? 'all'
        : 'single',
    collectionId: collection.id,
    presentation,
    primaryResourceId: existingBinding?.primaryResourceId ?? resource.id,
    resources: nextResources,
  }) as HomeAssistantCollectionBinding
}
