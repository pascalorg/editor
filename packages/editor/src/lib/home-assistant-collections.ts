import type {
  AnyNode,
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
import {
  getSmartHomeExcludedResourceIds,
  getSmartHomeRoomControlMode,
  getSmartHomeRoomControlTileGroups,
  getSmartHomeRoomGroupMemberResourceId,
  isSmartHomeDeviceComponentResource,
  isSmartHomeGroupResource,
  smartHomeRoomGroupMemberReferencesResource,
} from './smart-home-composition'

export type HomeAssistantImportedResource = HomeAssistantResourceBinding & {
  description: string
  domain: string | null
  state: string | null
}

const PASCAL_GROUP_RESOURCE_PREFIX = 'pascal-group'

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

export const toResourceBinding = (
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

export function isGroupResource(resource: HomeAssistantImportedResource) {
  return (
    resource.kind === 'entity' &&
    (resource.isGroup === true || (resource.memberEntityIds?.length ?? 0) > 0)
  )
}

export function isDeviceResource(resource: HomeAssistantImportedResource) {
  return resource.kind === 'entity' && !isGroupResource(resource)
}

export function isItemNode(value: unknown): value is ItemNode {
  return Boolean(value && typeof value === 'object' && 'type' in value && value.type === 'item')
}

export function getSelectedItems(nodes: Record<AnyNodeId, AnyNode>, selectedIds: string[]) {
  return selectedIds
    .map((selectedId) => nodes[selectedId as AnyNodeId])
    .filter((node): node is ItemNode => isItemNode(node))
}

export function resolveExactCollectionForItems(
  collections: Record<CollectionId, Collection>,
  items: ItemNode[],
) {
  const itemIds = items.map((item) => item.id)
  if (itemIds.length === 0) {
    return null
  }

  return (
    Object.values(collections).find(
      (collection) =>
        collection.nodeIds.length === itemIds.length &&
        itemIds.every((itemId) => collection.nodeIds.includes(itemId)),
    ) ?? null
  )
}

export function getCollectionNameFromItems(items: ItemNode[]) {
  if (items.length === 0) {
    return 'Home control'
  }

  if (items.length === 1) {
    return items[0]?.name?.trim() || items[0]?.asset.name?.trim() || 'Home control'
  }

  const firstName = items[0]?.name?.trim() || items[0]?.asset.name?.trim() || 'Control group'
  return `${firstName} group`
}

export function toCollectionBinding(
  bindingNode: HomeAssistantCollectionBinding,
): HomeAssistantCollectionBinding {
  return {
    aggregation: bindingNode.aggregation,
    collectionId: bindingNode.collectionId,
    presentation: bindingNode.presentation,
    primaryResourceId: bindingNode.primaryResourceId ?? null,
    resources: bindingNode.resources,
  }
}

export function getStableHomeAssistantCollectionId(resourceId: string): CollectionId {
  const normalizedResourceId =
    resourceId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'resource'
  return `collection_ha_${normalizedResourceId}` as CollectionId
}

export function buildHomeAssistantResourceCollection(
  resource: HomeAssistantImportedResource,
): Collection {
  return normalizeCollection({
    id: getStableHomeAssistantCollectionId(resource.id),
    name: resource.label,
    nodeIds: [],
  })
}

export function getResourceEntityId(resource: HomeAssistantImportedResource) {
  return resource.entityId ?? resource.id
}

function getBindingResourceEntityId(resource: HomeAssistantResourceBinding) {
  return resource.entityId ?? resource.id
}

function getEntityObjectId(entityId: string | null | undefined, fallbackId: string) {
  const value = entityId?.trim() || fallbackId
  const dotIndex = value.indexOf('.')
  const objectId = dotIndex >= 0 ? value.slice(dotIndex + 1) : value

  return objectId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getRoomGroupStemFromIdentity(entityId: string | null | undefined, fallbackId: string) {
  let stem = getEntityObjectId(entityId, fallbackId)
  const suffixPatterns = [
    /_all_lights_group$/,
    /_lights_all_group$/,
    /_lights_group$/,
    /_light_group$/,
    /_all_lights$/,
    /_lights_all$/,
    /_group$/,
    /_lights$/,
    /_light$/,
  ]

  for (const pattern of suffixPatterns) {
    stem = stem.replace(pattern, '')
  }

  return stem.length >= 4 ? stem : null
}

export function getRoomGroupStem(resource: HomeAssistantImportedResource) {
  return getRoomGroupStemFromIdentity(resource.entityId, resource.id)
}

function getBindingRoomGroupStem(resource: HomeAssistantResourceBinding) {
  return getRoomGroupStemFromIdentity(resource.entityId, resource.id)
}

export function bindingResourceMatchesGroup(
  resource: HomeAssistantResourceBinding,
  memberEntityIds: Set<string>,
  groupStem: string | null,
) {
  if (memberEntityIds.has(getBindingResourceEntityId(resource))) {
    return true
  }

  if (!groupStem) {
    return false
  }

  const domain = resource.entityId?.split('.')[0] ?? null
  if (domain !== 'fan') {
    return false
  }

  const objectId = getEntityObjectId(resource.entityId, resource.id)
  return objectId === groupStem || objectId.startsWith(`${groupStem}_`)
}

export function bindingResourceIsExplicitGroupMember(
  resource: HomeAssistantResourceBinding,
  memberEntityIds: Set<string>,
) {
  return memberEntityIds.has(resource.id) || memberEntityIds.has(getBindingResourceEntityId(resource))
}

function excludedResourceIdIsExplicitGroupMember(
  binding: HomeAssistantCollectionBinding,
  resourceId: string,
  memberEntityIds: Set<string>,
) {
  if (memberEntityIds.has(resourceId)) {
    return true
  }

  const resource = binding.resources.find((entry) => entry.id === resourceId)
  return resource ? bindingResourceIsExplicitGroupMember(resource, memberEntityIds) : false
}

export function bindingHasGroupResourceForDevice(
  binding: HomeAssistantCollectionBinding,
  resource: HomeAssistantResourceBinding,
) {
  return binding.resources.some(
    (groupResource) =>
      isSmartHomeGroupResource(groupResource) &&
      bindingResourceMatchesGroup(
        resource,
        new Set(groupResource.memberEntityIds ?? []),
        getBindingRoomGroupStem(groupResource),
      ),
  )
}

export function bindingHasUserManagedGroupComposition({
  binding,
  collectionId,
  groupResourceId,
  groupStem,
  memberEntityIds,
}: {
  binding: HomeAssistantCollectionBinding | null | undefined
  collectionId: CollectionId
  groupResourceId: string
  groupStem: string | null
  memberEntityIds: Set<string>
}) {
  if (!binding) {
    return false
  }

  if (getSmartHomeRoomControlMode(binding.presentation) === 'user-managed') {
    return true
  }

  const excludedResourceIds = getSmartHomeExcludedResourceIds(binding.presentation)
  if (excludedResourceIds.length > 0 && binding.resources.some(isSmartHomeDeviceComponentResource)) {
    const hasUserManagedExclusion = excludedResourceIds.some(
      (resourceId) => !excludedResourceIdIsExplicitGroupMember(binding, resourceId, memberEntityIds),
    )
    if (hasUserManagedExclusion) {
      return true
    }
  }

  const groupedMemberIds = getSmartHomeRoomControlTileGroups({
    collectionId,
    presentation: binding.presentation,
  }).flat()
  if (
    groupedMemberIds.some((memberId) => {
      if (smartHomeRoomGroupMemberReferencesResource(collectionId, memberId, groupResourceId)) {
        return false
      }

      const resourceId = getSmartHomeRoomGroupMemberResourceId(collectionId, memberId)
      if (!resourceId) {
        return true
      }

      const resource = binding.resources.find((entry) => entry.id === resourceId)
      return (
        !resource ||
        !isSmartHomeDeviceComponentResource(resource) ||
        !bindingResourceMatchesGroup(resource, memberEntityIds, groupStem)
      )
    })
  ) {
    return true
  }

  return binding.resources.some(
    (resource) =>
      isSmartHomeDeviceComponentResource(resource) &&
      !bindingResourceMatchesGroup(resource, memberEntityIds, groupStem),
  )
}

function getGroupSpecificity(resource: HomeAssistantImportedResource) {
  return resource.memberEntityIds?.length ?? Number.MAX_SAFE_INTEGER
}

export function compareGroupsBySpecificity(
  left: HomeAssistantImportedResource,
  right: HomeAssistantImportedResource,
) {
  const specificityDelta = getGroupSpecificity(left) - getGroupSpecificity(right)
  if (specificityDelta !== 0) {
    return specificityDelta
  }

  return left.label.localeCompare(right.label)
}

export function getGroupMemberEntityIds(group: HomeAssistantImportedResource | null | undefined) {
  return new Set(group?.memberEntityIds ?? [])
}

function countSharedGroupMembers(
  left: HomeAssistantImportedResource | null | undefined,
  right: HomeAssistantImportedResource | null | undefined,
) {
  if (!(left && right)) {
    return 0
  }

  const leftMembers = getGroupMemberEntityIds(left)
  let sharedCount = 0
  for (const memberEntityId of right.memberEntityIds ?? []) {
    if (leftMembers.has(memberEntityId)) {
      sharedCount += 1
    }
  }

  return sharedCount
}

function groupContainsResource(
  group: HomeAssistantImportedResource | null | undefined,
  resource: HomeAssistantImportedResource,
) {
  if (!group) {
    return false
  }

  return getGroupMemberEntityIds(group).has(getResourceEntityId(resource))
}

export function orderDeviceGroupsBySharedMembers<
  T extends {
    group: HomeAssistantImportedResource | null
    resources: HomeAssistantImportedResource[]
  },
>(groups: T[]) {
  const explicitGroups = groups
    .filter((deviceGroup) => Boolean(deviceGroup.group))
    .sort((left, right) => {
      const specificityDelta =
        getGroupSpecificity(left.group!) - getGroupSpecificity(right.group!)
      if (specificityDelta !== 0) {
        return specificityDelta
      }

      return left.group!.label.localeCompare(right.group!.label)
    })
  const ungroupedGroups = groups.filter((deviceGroup) => !deviceGroup.group)

  if (explicitGroups.length <= 1) {
    return [...explicitGroups, ...ungroupedGroups]
  }

  const orderedGroups: T[] = []
  const remainingGroups = [...explicitGroups]
  orderedGroups.push(remainingGroups.shift()!)

  while (remainingGroups.length > 0) {
    const currentGroup = orderedGroups[orderedGroups.length - 1]!
    let bestIndex = 0
    let bestScore = -1

    remainingGroups.forEach((candidateGroup, index) => {
      const score = countSharedGroupMembers(currentGroup.group, candidateGroup.group)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
        return
      }

      if (score === bestScore) {
        const candidateSpecificity = getGroupSpecificity(candidateGroup.group!)
        const bestSpecificity = getGroupSpecificity(remainingGroups[bestIndex]!.group!)
        if (candidateSpecificity < bestSpecificity) {
          bestIndex = index
        }
      }
    })

    orderedGroups.push(remainingGroups.splice(bestIndex, 1)[0]!)
  }

  return [...orderedGroups, ...ungroupedGroups]
}

export function orderResourcesForNeighborGroups(
  resources: HomeAssistantImportedResource[],
  previousGroup: HomeAssistantImportedResource | null | undefined,
  nextGroup: HomeAssistantImportedResource | null | undefined,
) {
  return [...resources].sort((left, right) => {
    const getBoundaryScore = (resource: HomeAssistantImportedResource) => {
      const touchesPreviousGroup = groupContainsResource(previousGroup, resource)
      const touchesNextGroup = groupContainsResource(nextGroup, resource)

      if (touchesPreviousGroup && !touchesNextGroup) {
        return -1
      }
      if (touchesNextGroup && !touchesPreviousGroup) {
        return 1
      }

      return 0
    }

    const boundaryDelta = getBoundaryScore(left) - getBoundaryScore(right)
    if (boundaryDelta !== 0) {
      return boundaryDelta
    }

    return left.label.localeCompare(right.label)
  })
}

export function toImportedResourceFromBindingResource(
  resource: HomeAssistantResourceBinding,
  displayLabel?: string,
): HomeAssistantImportedResource {
  return {
    ...resource,
    description: 'RTS pill in Pascal',
    domain: resource.entityId?.split('.')[0] ?? resource.actions[0]?.domain ?? null,
    label: displayLabel?.trim() || resource.label,
    state: null,
  }
}

export function getScenePillResource(
  binding: HomeAssistantCollectionBinding,
  collection: Collection | null | undefined,
) {
  const primaryResource =
    binding.resources.find((resource) => resource.id === binding.primaryResourceId) ??
    binding.resources[0]

  if (!primaryResource) {
    return null
  }

  return toImportedResourceFromBindingResource(
    primaryResource,
    binding.presentation?.label?.trim() || collection?.name?.trim() || primaryResource.label,
  )
}

export function createPascalGroupResource(label: string): HomeAssistantImportedResource {
  const idSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return {
    actions: [],
    capabilities: ['power'],
    defaultActionKey: null,
    description: 'Pascal RTS group',
    domain: 'group',
    entityId: null,
    id: `${PASCAL_GROUP_RESOURCE_PREFIX}:${idSuffix}`,
    isGroup: true,
    kind: 'entity',
    label,
    memberEntityIds: [],
    state: null,
  }
}

export function getNextPascalGroupLabel(resources: HomeAssistantImportedResource[]) {
  const baseLabel = 'Pascal group'
  const existingLabels = new Set(resources.map((resource) => resource.label.trim()))

  if (!existingLabels.has(baseLabel)) {
    return baseLabel
  }

  for (let index = 2; index < 1000; index += 1) {
    const label = `${baseLabel} ${index}`
    if (!existingLabels.has(label)) {
      return label
    }
  }

  return `${baseLabel} ${Date.now().toString(36)}`
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
