import type { Collection, CollectionId } from '@pascal-app/core'
import type { HomeAssistantCollectionBinding } from '../home-assistant-binding'
import type { HomeAssistantImportedResource } from '../home-assistant-collections'
import {
  isGroupResource,
  toImportedResourceFromBindingResource,
} from '../home-assistant-collections'
import {
  bindingHasSmartHomeLocalGroupIntent,
  createSmartHomePascalGroupResourceBinding,
  isSmartHomeBindingPresentationHidden,
  isSmartHomeGroupResource,
} from '../smart-home-composition'

type ResourceOwner = {
  collectionId: CollectionId
  collectionName: string
}

export type HomeAssistantSmartHomeGraph = {
  groupImports: HomeAssistantImportedResource[]
  renderedGroupPillIds: Set<string>
  resourceOwners: Map<string, ResourceOwner>
}

export type BuildHomeAssistantSmartHomeGraphInput = {
  bindings: Record<CollectionId, HomeAssistantCollectionBinding>
  collections: Record<CollectionId, Collection>
  hiddenGroupResourceIds?: ReadonlySet<string>
  imports: HomeAssistantImportedResource[]
}

function getBindingDisplayLabel(
  binding: HomeAssistantCollectionBinding,
  collection: Collection | null | undefined,
) {
  return (
    binding.presentation?.label?.trim() ||
    collection?.name?.trim() ||
    binding.resources[0]?.label?.trim() ||
    'Pascal group'
  )
}

function bindingHasRenderedPill(
  binding: HomeAssistantCollectionBinding,
  collection: Collection | null | undefined,
) {
  return Boolean(
    binding.presentation?.rtsWorldPosition ||
      binding.presentation?.rtsScreenPosition ||
      collection?.nodeIds.length,
  )
}

function getBindingGroupImport(
  binding: HomeAssistantCollectionBinding,
  collection: Collection | null | undefined,
) {
  const label = getBindingDisplayLabel(binding, collection)
  const groupResource =
    binding.resources.find(isSmartHomeGroupResource) ??
    (bindingHasSmartHomeLocalGroupIntent(binding)
      ? createSmartHomePascalGroupResourceBinding({
          collectionId: binding.collectionId,
          label,
        })
      : null)

  return groupResource ? toImportedResourceFromBindingResource(groupResource, label) : null
}

export function buildHomeAssistantSmartHomeGraph({
  bindings,
  collections,
  hiddenGroupResourceIds = new Set(),
  imports,
}: BuildHomeAssistantSmartHomeGraphInput): HomeAssistantSmartHomeGraph {
  const resourceOwners = new Map<string, ResourceOwner>()
  const groupImportsById = new Map<string, HomeAssistantImportedResource>()
  const renderedGroupPillIds = new Set<string>()

  for (const resource of imports.filter((entry) => isGroupResource(entry))) {
    if (!hiddenGroupResourceIds.has(resource.id)) {
      groupImportsById.set(resource.id, resource)
    }
  }

  for (const binding of Object.values(bindings)) {
    if (isSmartHomeBindingPresentationHidden(binding.presentation)) {
      continue
    }

    const collection = collections[binding.collectionId]
    const collectionName = getBindingDisplayLabel(binding, collection)

    for (const resource of binding.resources) {
      resourceOwners.set(resource.id, {
        collectionId: binding.collectionId,
        collectionName,
      })
    }

    if (!bindingHasRenderedPill(binding, collection)) {
      continue
    }

    const groupImport = getBindingGroupImport(binding, collection)
    if (!groupImport || hiddenGroupResourceIds.has(groupImport.id)) {
      continue
    }

    groupImportsById.set(groupImport.id, groupImport)
    renderedGroupPillIds.add(groupImport.id)
  }

  return {
    groupImports: Array.from(groupImportsById.values()),
    renderedGroupPillIds,
    resourceOwners,
  }
}
