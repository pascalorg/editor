import type { AnyNode, CollectionId } from '@pascal-app/core'
import type {
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
} from '@pascal-app/core/schema'
import { normalizeHomeAssistantCollectionBinding } from '@pascal-app/core/schema'
import {
  buildSmartHomeRoomControlCompositionFromTileGroups,
  cloneSmartHomeResourceBinding,
  getDurableSmartHomeRoomControlTileGroups,
  getLegacySmartHomeRoomControlTileId,
  getSmartHomeExcludedResourceIds,
  getSmartHomeRoomControlTileGroups,
  getSmartHomeRoomControlTileId,
  hasSmartHomeGroupResource,
  isSmartHomeDeviceComponentResource,
  normalizeSmartHomeStringGroups,
} from './smart-home-composition'

type HomeAssistantRoomControlAlias = {
  id: string
  legacyIds?: readonly string[]
  resourceId?: string | null
}

type HomeAssistantPresentationWithLegacy = NonNullable<
  HomeAssistantCollectionBinding['presentation']
> & {
  rtsExcludedResourceIds?: string[]
  rtsGroups?: string[][]
}

export function mergeHomeAssistantPresentation(
  current: HomeAssistantCollectionBinding['presentation'],
  incoming: HomeAssistantCollectionBinding['presentation'],
) {
  if (!current && !incoming) {
    return undefined
  }

  const merged: HomeAssistantPresentationWithLegacy = {
    ...(current ?? {}),
  }

  const currentRoomControls = current?.rtsRoomControls
  const preserveUserManagedRoomControls =
    currentRoomControls?.mode === 'user-managed' &&
    incoming?.rtsRoomControls?.mode !== 'user-managed'

  if (incoming) {
    for (const [key, value] of Object.entries(incoming)) {
      if (value !== undefined) {
        merged[key as keyof typeof merged] = value as never
      }
    }

    if (incoming.rtsRoomControls) {
      delete merged.rtsExcludedResourceIds
      delete merged.rtsGroups
    }
  }

  if (preserveUserManagedRoomControls) {
    merged.rtsRoomControls = currentRoomControls
    delete merged.rtsExcludedResourceIds
    delete merged.rtsGroups
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export function getPresentationAfterResourceRemoval(
  presentation: HomeAssistantCollectionBinding['presentation'],
  collectionId: CollectionId,
  resourceId: string,
  resources: HomeAssistantResourceBinding[],
) {
  const currentId = getSmartHomeRoomControlTileId(collectionId, resourceId)
  const legacyId = getLegacySmartHomeRoomControlTileId(collectionId, resourceId)
  const removedIds = new Set([currentId, `${currentId}:0`, legacyId, `${legacyId}:0`])
  const nextGroups = getSmartHomeRoomControlTileGroups({ collectionId, presentation })
    .map((group) => group.filter((entry) => !removedIds.has(entry)))
    .filter((group) => group.length > 0)
  const nextExcludedResourceIds = Array.from(
    new Set([...getSmartHomeExcludedResourceIds(presentation), resourceId]),
  )
  const nextPresentation: HomeAssistantPresentationWithLegacy = {
    ...(presentation ?? {}),
    rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
      collectionId,
      excludedResourceIds: nextExcludedResourceIds,
      groups: nextGroups,
      mode: 'user-managed',
      resources,
    }),
  }
  delete nextPresentation.rtsExcludedResourceIds
  delete nextPresentation.rtsGroups

  return nextPresentation
}

export function getPresentationAfterResourceInclusion(
  presentation: HomeAssistantCollectionBinding['presentation'],
  collectionId: CollectionId,
  resourceId: string,
  resources: HomeAssistantResourceBinding[],
) {
  const currentExcludedResourceIds = getSmartHomeExcludedResourceIds(presentation)
  const nextExcludedResourceIds = currentExcludedResourceIds.filter((entry) => entry !== resourceId)

  if (nextExcludedResourceIds.length === currentExcludedResourceIds.length) {
    return presentation
  }

  const nextPresentation: HomeAssistantPresentationWithLegacy = {
    ...(presentation ?? {}),
    rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
      collectionId,
      excludedResourceIds: nextExcludedResourceIds,
      groups: getSmartHomeRoomControlTileGroups({ collectionId, presentation }),
      mode: 'user-managed',
      resources,
    }),
  }
  delete nextPresentation.rtsExcludedResourceIds
  delete nextPresentation.rtsGroups

  if (nextExcludedResourceIds.length === 0) {
    delete nextPresentation.rtsRoomControls?.excludedResourceIds
  }

  return nextPresentation
}

export function getBindingAfterRoomGrouping({
  binding,
  collectionId = binding.collectionId,
  controls,
  groups,
}: {
  binding: HomeAssistantCollectionBinding
  collectionId?: CollectionId | string
  controls: HomeAssistantRoomControlAlias[]
  groups: string[][]
}) {
  const normalizedGroups = normalizeSmartHomeStringGroups(
    getDurableSmartHomeRoomControlTileGroups({
      collectionId,
      controls,
      groups,
    }),
  )

  return normalizeHomeAssistantCollectionBinding({
    ...binding,
    presentation: {
      ...(binding.presentation ?? {}),
      rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
        collectionId,
        excludedResourceIds: getSmartHomeExcludedResourceIds(binding.presentation),
        groups: normalizedGroups,
        mode: 'user-managed',
        resources: binding.resources,
      }),
    },
  })
}

export function getBindingAfterDeviceResourceCopyToGroup({
  sourceBinding,
  targetBinding,
  targetCollectionId = targetBinding.collectionId,
}: {
  sourceBinding: HomeAssistantCollectionBinding
  targetBinding: HomeAssistantCollectionBinding
  targetCollectionId?: CollectionId | string
}) {
  if (!hasSmartHomeGroupResource(targetBinding)) {
    return null
  }

  const sourceResource = sourceBinding.resources.find(isSmartHomeDeviceComponentResource)
  if (!sourceResource) {
    return null
  }

  if (targetBinding.resources.some((resource) => resource.id === sourceResource.id)) {
    return null
  }

  const existingGroups = normalizeSmartHomeStringGroups(
    getSmartHomeRoomControlTileGroups({
      collectionId: targetCollectionId,
      presentation: targetBinding.presentation,
    }),
  )
  const targetDeviceResources = targetBinding.resources.filter(isSmartHomeDeviceComponentResource)
  const existingCombinedGroup =
    targetDeviceResources.length > 0
      ? targetDeviceResources.map((resource) =>
          getSmartHomeRoomControlTileId(targetCollectionId, resource.id),
        )
      : []
  const baseGroups =
    existingGroups.length > 0
      ? existingGroups
      : existingCombinedGroup.length > 0
        ? [existingCombinedGroup]
        : []
  const copiedMemberId = getSmartHomeRoomControlTileId(targetCollectionId, sourceResource.id)
  const nextGroups = [
    ...baseGroups
      .map((group) => group.filter((memberId) => memberId !== copiedMemberId))
      .filter((group) => group.length > 0),
    [copiedMemberId],
  ]
  const currentPrimaryResource = targetBinding.resources.find(
    (resource) => resource.id === targetBinding.primaryResourceId,
  )
  const nextResources = [
    ...targetBinding.resources,
    cloneSmartHomeResourceBinding(sourceResource),
  ]

  return normalizeHomeAssistantCollectionBinding({
    aggregation: 'all',
    collectionId: targetBinding.collectionId,
    presentation: {
      ...(targetBinding.presentation ?? {}),
      rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
        collectionId: targetCollectionId,
        excludedResourceIds: getSmartHomeExcludedResourceIds(
          targetBinding.presentation,
        ).filter((resourceId) => resourceId !== sourceResource.id),
        groups: nextGroups,
        mode: 'user-managed',
        resources: nextResources,
      }),
    },
    primaryResourceId: isSmartHomeDeviceComponentResource(currentPrimaryResource)
      ? (currentPrimaryResource?.id ?? sourceResource.id)
      : sourceResource.id,
    resources: nextResources,
  })
}

export function getBindingAfterDeviceResourceRemovalFromGroup(
  binding: HomeAssistantCollectionBinding,
  resourceId: string,
) {
  if (!hasSmartHomeGroupResource(binding)) {
    return null
  }

  const removedResource = binding.resources.find((resource) => resource.id === resourceId)
  if (!isSmartHomeDeviceComponentResource(removedResource)) {
    return null
  }

  const nextResources = binding.resources.filter((resource) => resource.id !== removedResource.id)
  const nextDeviceResources = nextResources.filter(isSmartHomeDeviceComponentResource)
  const nextPrimaryResourceId =
    binding.primaryResourceId === removedResource.id
      ? (nextDeviceResources[0]?.id ?? nextResources[0]?.id ?? null)
      : (binding.primaryResourceId ??
        nextDeviceResources[0]?.id ??
        nextResources[0]?.id ??
        null)
  const nextExcludedResourceIds = Array.from(
    new Set([...getSmartHomeExcludedResourceIds(binding.presentation), removedResource.id]),
  )

  return normalizeHomeAssistantCollectionBinding({
    aggregation: nextResources.some((resource) => resource.kind !== 'entity')
      ? 'trigger_only'
      : nextDeviceResources.length > 1
        ? 'all'
        : 'single',
    collectionId: binding.collectionId,
    presentation: {
      ...(binding.presentation ?? {}),
      rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
        collectionId: binding.collectionId,
        excludedResourceIds: nextExcludedResourceIds,
        groups: getSmartHomeRoomControlTileGroups({
          collectionId: binding.collectionId,
          presentation: binding.presentation,
        }).map((group) =>
          group.filter(
            (memberId) =>
              memberId !== getSmartHomeRoomControlTileId(binding.collectionId, removedResource.id),
          ),
        ),
        mode: 'user-managed',
        resources: nextResources,
      }),
    },
    primaryResourceId: nextPrimaryResourceId,
    resources: nextResources,
  })
}

export function homeAssistantBindingsAreEqual(
  left: HomeAssistantCollectionBinding | null | undefined,
  right: HomeAssistantCollectionBinding | null | undefined,
) {
  return valuesAreEqual(left ?? null, right ?? null)
}

export function homeAssistantNodePatchMatches(node: AnyNode, patch: Partial<AnyNode>) {
  const currentNode = node as Record<string, unknown>
  return Object.entries(patch).every(([key, value]) => valuesAreEqual(currentNode[key], value))
}

function normalizeComparableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableValue(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [key, normalizeComparableValue(entryValue)]),
    )
  }

  return value
}

function valuesAreEqual(left: unknown, right: unknown) {
  return (
    JSON.stringify(normalizeComparableValue(left)) ===
    JSON.stringify(normalizeComparableValue(right))
  )
}
