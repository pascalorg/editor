'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type Collection,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import {
  getHomeAssistantBindingNodeMap,
  type HomeAssistantCollectionBinding,
  homeAssistantItemEffects,
  HomeAssistantItemEffects,
  type HomeAssistantResourceBinding,
} from '@pascal-app/home-assistant'
import { getResourceEntityIds, summarizeResourceState } from './artifact'
import type { HomeAssistantLike, PendingHomeAssistantState, ResourceStateSummary } from './types'

const ACTIVE_DOMAINS = new Set(['fan', 'light', 'media_player', 'switch'])

function getResourceDomain(resourceId: string | null | undefined) {
  return typeof resourceId === 'string' ? resourceId.split('.', 1)[0] : null
}

function isGroupResource(resource: HomeAssistantResourceBinding | null | undefined) {
  return Boolean(
    resource?.kind === 'entity' &&
      (resource.isGroup === true || (resource.memberEntityIds?.length ?? 0) > 0),
  )
}

function isDeviceResource(resource: HomeAssistantResourceBinding | null | undefined) {
  return Boolean(
    resource?.kind === 'entity' &&
      !isGroupResource(resource) &&
      (resource.entityId?.trim() ||
        (resource.memberEntityIds?.length ?? 0) > 0 ||
        (resource.actions?.length ?? 0) > 0),
  )
}

function resourceKeys(resource: HomeAssistantResourceBinding | null | undefined) {
  if (!resource) {
    return new Set<string>()
  }
  return new Set(getResourceEntityIds(resource).concat(resource.id))
}

function resourcesOverlap(
  left: HomeAssistantResourceBinding | null | undefined,
  right: HomeAssistantResourceBinding | null | undefined,
) {
  const leftKeys = resourceKeys(left)
  if (leftKeys.size === 0) {
    return false
  }
  for (const key of resourceKeys(right)) {
    if (leftKeys.has(key)) {
      return true
    }
  }
  return false
}

function getCollectionAnchorItemIds(
  collection: Collection | undefined,
  sceneNodes: Record<AnyNodeId, AnyNode>,
) {
  const candidateIds = collection?.controlNodeId
    ? [collection.controlNodeId, ...collection.nodeIds]
    : (collection?.nodeIds ?? [])

  return Array.from(new Set(candidateIds)).filter((nodeId): nodeId is AnyNodeId => {
    const node = sceneNodes[nodeId as AnyNodeId]
    return node?.type === 'item'
  })
}

function getInteractiveControlIndexes(node: AnyNode | undefined) {
  if (node?.type !== 'item') {
    return { brightness: -1, toggle: -1 }
  }

  const controls = node.asset.interactive?.controls ?? []
  return {
    brightness: controls.findIndex((control) => control.kind === 'slider'),
    toggle: controls.findIndex((control) => control.kind === 'toggle'),
  }
}

function getResourceAnchorItemIds({
  binding,
  bindings,
  collections,
  resource,
  sceneNodes,
}: {
  binding: HomeAssistantCollectionBinding
  bindings: Record<string, HomeAssistantCollectionBinding>
  collections: Record<string, Collection>
  resource: HomeAssistantResourceBinding
  sceneNodes: Record<AnyNodeId, AnyNode>
}) {
  const collection = collections[binding.collectionId]
  const collectionAnchorIds = getCollectionAnchorItemIds(collection, sceneNodes)
  const deviceResources = binding.resources.filter(isDeviceResource)
  const directResourceIndex = deviceResources.indexOf(resource)
  if (
    isDeviceResource(resource) &&
    collectionAnchorIds.length === deviceResources.length &&
    directResourceIndex >= 0
  ) {
    return collectionAnchorIds[directResourceIndex] ? [collectionAnchorIds[directResourceIndex]] : []
  }

  const linkedItemIds = new Set<AnyNodeId>()
  for (const candidateBinding of Object.values(bindings)) {
    if (candidateBinding.collectionId === binding.collectionId) {
      continue
    }
    if (!candidateBinding.resources.some((candidate) => resourcesOverlap(candidate, resource))) {
      continue
    }
    for (const itemId of getCollectionAnchorItemIds(
      collections[candidateBinding.collectionId],
      sceneNodes,
    )) {
      linkedItemIds.add(itemId)
    }
  }

  if (linkedItemIds.size > 0) {
    return Array.from(linkedItemIds)
  }

  if (!isDeviceResource(resource) || collectionAnchorIds.length <= 1) {
    return collectionAnchorIds
  }

  return []
}

function shouldApplyResourceState(
  pendingStateRef: { current: Record<string, PendingHomeAssistantState> },
  state: ResourceStateSummary,
) {
  const now = Date.now()
  let hasPendingMismatch = false

  for (const entityId of state.entityIds) {
    const pending = pendingStateRef.current[entityId]
    if (!pending) {
      continue
    }
    if (pending.expiresAt <= now) {
      delete pendingStateRef.current[entityId]
      continue
    }

    if (pending.desiredOn !== undefined) {
      if (state.isOn === pending.desiredOn) {
        delete pendingStateRef.current[entityId]
      } else {
        hasPendingMismatch = true
      }
      continue
    }

    if (pending.brightnessPct !== undefined) {
      if (
        typeof state.brightnessPct === 'number' &&
        Math.abs(state.brightnessPct - pending.brightnessPct) <= 1
      ) {
        delete pendingStateRef.current[entityId]
      } else {
        hasPendingMismatch = true
      }
    }
  }

  return !hasPendingMismatch
}

export function PascalLovelaceHomeAssistantSystem({
  hass,
  pendingStateRef,
}: {
  hass: HomeAssistantLike | null
  pendingStateRef: { current: Record<string, PendingHomeAssistantState> }
}) {
  const sceneNodes = useScene((state) => state.nodes)
  const collections = useScene((state) => state.collections)
  const setControlValue = useInteractive((state) => state.setControlValue)
  const bindings = useMemo(() => getHomeAssistantBindingNodeMap(sceneNodes), [sceneNodes])

  useEffect(() => {
    for (const binding of Object.values(bindings)) {
      for (const resource of binding.resources) {
        if (resource.kind !== 'entity') {
          continue
        }
        if (isGroupResource(resource) && binding.resources.some(isDeviceResource)) {
          continue
        }

        const state = summarizeResourceState(hass, resource)
        if (!shouldApplyResourceState(pendingStateRef, state)) {
          continue
        }

        const anchorIds = getResourceAnchorItemIds({
          binding,
          bindings,
          collections,
          resource,
          sceneNodes,
        })
        const domain = getResourceDomain(state.primaryEntityId)

        for (const itemId of anchorIds) {
          const { brightness, toggle } = getInteractiveControlIndexes(sceneNodes[itemId])
          if (toggle >= 0) {
            setControlValue(itemId, toggle, state.isOn)
          }
          if (brightness >= 0 && typeof state.brightnessPct === 'number') {
            setControlValue(itemId, brightness, state.brightnessPct)
          }

          if (domain === 'media_player' || ACTIVE_DOMAINS.has(domain ?? '')) {
            if (state.isOn) {
              homeAssistantItemEffects.trigger(itemId)
            } else {
              homeAssistantItemEffects.clear(itemId)
            }
          }
        }
      }
    }
  }, [bindings, collections, hass, pendingStateRef, sceneNodes, setControlValue])

  return <HomeAssistantItemEffects />
}
