import type { AnyNode, CollectionId } from '@pascal-app/core'
import type {
  HomeAssistantCollectionBinding,
  HomeAssistantResourceBinding,
} from '@pascal-app/core/schema'
import {
  buildSmartHomeRoomControlCompositionFromTileGroups,
  getLegacySmartHomeRoomControlTileId,
  getSmartHomeExcludedResourceIds,
  getSmartHomeRoomControlTileGroups,
  getSmartHomeRoomControlTileId,
} from './smart-home-composition'

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
