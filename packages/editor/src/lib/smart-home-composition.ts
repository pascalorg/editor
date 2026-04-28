import type {
  CollectionId,
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
  HomeAssistantRoomControlComposition,
} from '@pascal-app/core/schema'
import { normalizeHomeAssistantCollectionBinding } from '@pascal-app/core/schema'

export function getSmartHomeRoomControlTileId(
  collectionId: CollectionId | string,
  resourceId: string,
) {
  return `${collectionId}:home-assistant:${encodeURIComponent(resourceId)}`
}

export function getLegacySmartHomeRoomControlTileId(
  collectionId: CollectionId | string,
  resourceId: string,
) {
  return `${collectionId}:home-assistant:${resourceId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

export function normalizeSmartHomeStringGroups(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[][]
  }

  return value
    .filter(Array.isArray)
    .map((group) => group.filter((entry): entry is string => typeof entry === 'string'))
    .filter((group) => group.length > 0)
}

export function getSmartHomeExcludedResourceIds(
  presentation: HomeAssistantCollectionBinding['presentation'],
) {
  return (
    presentation?.rtsRoomControls?.excludedResourceIds ?? presentation?.rtsExcludedResourceIds ?? []
  )
}

export function isSmartHomeBindingPresentationHidden(
  presentation: HomeAssistantCollectionBinding['presentation'],
) {
  return presentation?.rtsHidden === true
}

export function getSmartHomeRoomControlResourceGroups(
  presentation: HomeAssistantCollectionBinding['presentation'],
) {
  return presentation?.rtsRoomControls?.groups?.map((group) => group.memberResourceIds) ?? []
}

export function getSmartHomeRoomControlTileGroups({
  collectionId,
  presentation,
}: {
  collectionId: CollectionId | string
  presentation: HomeAssistantCollectionBinding['presentation']
}) {
  const resourceGroups = getSmartHomeRoomControlResourceGroups(presentation)
  if (resourceGroups.length > 0) {
    return resourceGroups.map((group) =>
      group.map((resourceId) => getSmartHomeRoomControlTileId(collectionId, resourceId)),
    )
  }

  return normalizeSmartHomeStringGroups(presentation?.rtsGroups)
}

export function buildSmartHomeRoomControlCompositionFromTileGroups({
  collectionId,
  excludedResourceIds = [],
  groups,
  resources = [],
}: {
  collectionId: CollectionId | string
  excludedResourceIds?: readonly string[]
  groups: string[][]
  resources?: readonly HomeAssistantResourceBinding[]
}): HomeAssistantRoomControlComposition | undefined {
  const resourceAliases = new Map<string, string>()
  for (const resource of resources) {
    const currentTileId = getSmartHomeRoomControlTileId(collectionId, resource.id)
    const legacyTileId = getLegacySmartHomeRoomControlTileId(collectionId, resource.id)
    resourceAliases.set(currentTileId, resource.id)
    resourceAliases.set(legacyTileId, resource.id)
    resourceAliases.set(`${currentTileId}:0`, resource.id)
    resourceAliases.set(`${legacyTileId}:0`, resource.id)
  }

  const resourceGroups = groups
    .map((group, index) => {
      const memberResourceIds = Array.from(
        new Set(
          group
            .map((memberId) => {
              const canonicalMemberId = memberId.replace(/:\d+$/, '')
              return (
                resourceAliases.get(memberId) ??
                resourceAliases.get(canonicalMemberId) ??
                getSmartHomeRoomGroupMemberResourceId(collectionId, memberId)
              )
            })
            .filter((resourceId): resourceId is string => Boolean(resourceId)),
        ),
      )

      return {
        id: `group-${index + 1}`,
        memberResourceIds,
      }
    })
    .filter((group) => group.memberResourceIds.length > 0)
  const excluded = Array.from(new Set(excludedResourceIds))

  if (resourceGroups.length === 0 && excluded.length === 0) {
    return undefined
  }

  return {
    ...(excluded.length > 0 ? { excludedResourceIds: excluded } : {}),
    ...(resourceGroups.length > 0 ? { groups: resourceGroups } : {}),
  }
}

export function cloneSmartHomeResourceBinding(
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

export function isSmartHomeGroupResource(
  resource: HomeAssistantResourceBinding | null | undefined,
) {
  return Boolean(
    resource?.kind === 'entity' &&
      (resource.isGroup === true || (resource.memberEntityIds?.length ?? 0) > 0),
  )
}

export function smartHomeResourceHasControllableTarget(
  resource: HomeAssistantResourceBinding | null | undefined,
) {
  return Boolean(
    resource?.kind === 'entity' &&
      (resource.entityId?.trim() ||
        (resource.memberEntityIds?.length ?? 0) > 0 ||
        (resource.actions?.length ?? 0) > 0),
  )
}

export function isSmartHomeControllableEntityResource(
  resource: HomeAssistantResourceBinding | null | undefined,
) {
  return Boolean(resource?.kind === 'entity' && smartHomeResourceHasControllableTarget(resource))
}

export function isSmartHomeDeviceComponentResource(
  resource: HomeAssistantResourceBinding | null | undefined,
): resource is HomeAssistantResourceBinding {
  return Boolean(
    resource?.kind === 'entity' &&
      !isSmartHomeGroupResource(resource) &&
      smartHomeResourceHasControllableTarget(resource),
  )
}

export function getSmartHomeBindingControlResources(resources: HomeAssistantResourceBinding[]) {
  const entityResources = resources.filter((resource) => resource.kind === 'entity')
  const deviceResources = entityResources.filter(isSmartHomeDeviceComponentResource)
  const controllableResources = entityResources.filter(isSmartHomeControllableEntityResource)

  return deviceResources.length > 0
    ? deviceResources
    : controllableResources.length > 0
      ? controllableResources
      : entityResources.filter(isSmartHomeGroupResource).slice(0, 1)
}

export function getSmartHomeBindingControlIds(
  collectionId: CollectionId | string,
  resources: HomeAssistantResourceBinding[],
) {
  return getSmartHomeBindingControlResources(resources).map((resource) =>
    getSmartHomeRoomControlTileId(collectionId, resource.id),
  )
}

export function normalizeSmartHomeRoomGroupsForBinding({
  appendMissingControls = false,
  collectionId,
  rawGroups,
  resources,
}: {
  appendMissingControls?: boolean
  collectionId: CollectionId | string
  rawGroups: unknown
  resources: HomeAssistantResourceBinding[]
}) {
  const controlResources = getSmartHomeBindingControlResources(resources)
  const controlIds = controlResources.map((resource) =>
    getSmartHomeRoomControlTileId(collectionId, resource.id),
  )
  const validControlIds = new Set(controlIds)
  const aliasMap = new Map<string, string>()
  const rawStringGroups = normalizeSmartHomeStringGroups(rawGroups)

  if (rawStringGroups.length === 0) {
    return [] as string[][]
  }

  controlResources.forEach((resource, index) => {
    const currentTileId = getSmartHomeRoomControlTileId(collectionId, resource.id)
    const legacyTileId = getLegacySmartHomeRoomControlTileId(collectionId, resource.id)
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

  if (appendMissingControls) {
    for (const controlId of controlIds) {
      if (!assigned.has(controlId)) {
        groups.push([controlId])
      }
    }
  }

  return groups
}

export function smartHomeRoomGroupsEqual(left: string[][], right: string[][]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function isDefaultSmartHomeRoomGroup(groups: string[][], controlIds: string[]) {
  return (
    groups.length === 1 &&
    groups[0]?.length === controlIds.length &&
    controlIds.every((controlId) => groups[0]?.includes(controlId))
  )
}

export function smartHomeRoomGroupsCoverControlIds(groups: string[][], controlIds: string[]) {
  const groupedIds = new Set(groups.flat())
  return controlIds.length > 0 && controlIds.every((controlId) => groupedIds.has(controlId))
}

export function isDefaultSmartHomeRoomGroupForBinding(
  groups: string[][],
  collectionId: CollectionId | string,
  resources: HomeAssistantResourceBinding[],
) {
  return isDefaultSmartHomeRoomGroup(groups, getSmartHomeBindingControlIds(collectionId, resources))
}

export function smartHomeRoomGroupsCoverBindingControls(
  groups: string[][],
  collectionId: CollectionId | string,
  resources: HomeAssistantResourceBinding[],
) {
  return smartHomeRoomGroupsCoverControlIds(
    groups,
    getSmartHomeBindingControlIds(collectionId, resources),
  )
}

export function getSmartHomeRoomGroupMemberResourceId(
  collectionId: CollectionId | string,
  memberId: string,
) {
  const prefix = `${collectionId}:home-assistant:`
  if (!memberId.startsWith(prefix)) {
    return null
  }

  const encodedResourceId = memberId.slice(prefix.length).replace(/:\d+$/, '')
  try {
    return decodeURIComponent(encodedResourceId)
  } catch {
    return encodedResourceId
  }
}

export function smartHomeRoomGroupMemberReferencesResource(
  collectionId: CollectionId | string,
  memberId: string,
  resourceId: string,
) {
  const currentId = getSmartHomeRoomControlTileId(collectionId, resourceId)
  const legacyId = getLegacySmartHomeRoomControlTileId(collectionId, resourceId)

  return (
    memberId === currentId ||
    memberId === legacyId ||
    memberId.startsWith(`${currentId}:`) ||
    memberId.startsWith(`${legacyId}:`)
  )
}

export function getSmartHomeReferencedResourceIdsFromRoomGroups({
  availableResources,
  collectionId,
  rawGroups,
}: {
  availableResources: HomeAssistantResourceBinding[]
  collectionId: CollectionId | string
  rawGroups: unknown
}) {
  const rawStringGroups = normalizeSmartHomeStringGroups(rawGroups)
  if (rawStringGroups.length === 0) {
    return new Set<string>()
  }

  const resourceAliases = new Map<string, string>()
  for (const resource of availableResources) {
    const currentTileId = getSmartHomeRoomControlTileId(collectionId, resource.id)
    const legacyTileId = getLegacySmartHomeRoomControlTileId(collectionId, resource.id)
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

    const resourceId = getSmartHomeRoomGroupMemberResourceId(collectionId, rawMemberId)
    if (resourceId) {
      referencedResourceIds.add(resourceId)
    }
  }

  return referencedResourceIds
}

export function getSmartHomeGroupMemberDeviceResourceIds({
  allResourcesById,
  resources,
}: {
  allResourcesById: Map<string, HomeAssistantResourceBinding>
  resources: HomeAssistantResourceBinding[]
}) {
  const memberEntityIds = new Set(
    resources
      .filter(isSmartHomeGroupResource)
      .flatMap((resource) => resource.memberEntityIds ?? []),
  )
  const resourceIds = new Set<string>()

  for (const memberEntityId of memberEntityIds) {
    const directResource = allResourcesById.get(memberEntityId)
    if (isSmartHomeDeviceComponentResource(directResource)) {
      resourceIds.add(directResource.id)
    }
  }

  for (const resource of allResourcesById.values()) {
    if (
      isSmartHomeDeviceComponentResource(resource) &&
      resource.entityId &&
      memberEntityIds.has(resource.entityId)
    ) {
      resourceIds.add(resource.id)
    }
  }

  return resourceIds
}

export function repairHomeAssistantBindingResourcesFromGroups({
  allResourcesById,
  binding,
  detachedResourceIds = [],
  rawGroups,
}: {
  allResourcesById: Map<string, HomeAssistantResourceBinding>
  binding: HomeAssistantCollectionBinding
  detachedResourceIds?: Iterable<string>
  rawGroups: unknown
}) {
  if (!binding.resources.some(isSmartHomeGroupResource)) {
    return binding
  }

  const collectionId = binding.collectionId as string
  const referencedResourceIds = getSmartHomeReferencedResourceIdsFromRoomGroups({
    availableResources: Array.from(allResourcesById.values()),
    collectionId,
    rawGroups,
  })
  const groupMemberDeviceResourceIds = getSmartHomeGroupMemberDeviceResourceIds({
    allResourcesById,
    resources: binding.resources,
  })

  for (const resourceId of detachedResourceIds) {
    groupMemberDeviceResourceIds.delete(resourceId)
  }

  const referencedDeviceResourceIds = new Set([
    ...Array.from(referencedResourceIds).filter((resourceId) =>
      isSmartHomeDeviceComponentResource(allResourcesById.get(resourceId)),
    ),
    ...groupMemberDeviceResourceIds,
  ])
  if (referencedDeviceResourceIds.size === 0) {
    return binding
  }

  const currentControlResourceIds = new Set(
    getSmartHomeBindingControlResources(binding.resources).map((resource) => resource.id),
  )
  const nextResourcesById = new Map<string, HomeAssistantResourceBinding>()

  for (const resource of binding.resources) {
    if (
      isSmartHomeDeviceComponentResource(resource) &&
      !referencedDeviceResourceIds.has(resource.id)
    ) {
      continue
    }
    nextResourcesById.set(resource.id, cloneSmartHomeResourceBinding(resource))
  }

  for (const resourceId of referencedDeviceResourceIds) {
    if (nextResourcesById.has(resourceId)) {
      continue
    }
    const referencedResource = allResourcesById.get(resourceId)
    if (!isSmartHomeDeviceComponentResource(referencedResource)) {
      continue
    }
    nextResourcesById.set(resourceId, cloneSmartHomeResourceBinding(referencedResource))
  }

  const nextExcludedResourceIds = Array.from(
    new Set([
      ...getSmartHomeExcludedResourceIds(binding.presentation).filter(
        (resourceId) => !referencedDeviceResourceIds.has(resourceId),
      ),
      ...Array.from(currentControlResourceIds).filter(
        (resourceId) => !referencedDeviceResourceIds.has(resourceId),
      ),
    ]),
  )
  const nextResources = Array.from(nextResourcesById.values())
  const nextBinding = normalizeHomeAssistantCollectionBinding({
    aggregation: nextResources.some((resource) => resource.kind !== 'entity')
      ? 'trigger_only'
      : nextResources.filter(isSmartHomeDeviceComponentResource).length > 1
        ? 'all'
        : 'single',
    collectionId: binding.collectionId,
    presentation: {
      ...(binding.presentation ?? {}),
      rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
        collectionId,
        excludedResourceIds: nextExcludedResourceIds,
        groups: getSmartHomeRoomControlTileGroups({
          collectionId,
          presentation: binding.presentation,
        }),
        resources: nextResources,
      }),
      rtsExcludedResourceIds: undefined,
      rtsGroups: undefined,
    },
    primaryResourceId:
      binding.primaryResourceId && nextResourcesById.has(binding.primaryResourceId)
        ? binding.primaryResourceId
        : (nextResources.find(isSmartHomeDeviceComponentResource)?.id ??
          nextResources[0]?.id ??
          null),
    resources: nextResources,
  })

  return nextBinding ?? binding
}

export function hasSmartHomeGroupResource(binding: HomeAssistantCollectionBinding) {
  return binding.resources.some(isSmartHomeGroupResource)
}

export function mergeSmartHomeIncomingResourcesWithLocalDevices(
  incomingResources: HomeAssistantResourceBinding[],
  existingResources: HomeAssistantResourceBinding[],
  excludedResourceIds: readonly string[] = [],
) {
  const excludedIds = new Set(excludedResourceIds)
  const resourcesById = new Map<string, HomeAssistantResourceBinding>()

  for (const resource of incomingResources) {
    resourcesById.set(resource.id, cloneSmartHomeResourceBinding(resource))
  }

  for (const resource of existingResources) {
    if (
      resourcesById.has(resource.id) ||
      excludedIds.has(resource.id) ||
      !isSmartHomeDeviceComponentResource(resource)
    ) {
      continue
    }

    resourcesById.set(resource.id, cloneSmartHomeResourceBinding(resource))
  }

  return Array.from(resourcesById.values())
}
