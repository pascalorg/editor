'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CollectionId,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  getHomeAssistantBindingNodeMap,
  type HomeAssistantActionRequest,
  type HomeAssistantBindingNode,
  type HomeAssistantCollectionBinding,
} from './home-assistant-binding'
import {
  getBindingAfterDeviceResourceCopyToGroup,
  getBindingAfterDeviceResourceRemovalFromGroup,
  getBindingAfterRoomGrouping,
} from './home-assistant-binding-presentation'
import {
  getHomeAssistantDisplayItemKind,
  type HomeAssistantDisplayItemKind,
} from './home-assistant-display-items'
import { HomeAssistantItemEffects, homeAssistantItemEffects } from './home-assistant-item-effects'
import type {
  RoomControlChange,
  RoomControlTile,
  RoomOverlayNode,
} from './room-overlay/room-control-model'
import { RoomControlOverlay } from './room-overlay/room-control-overlay'
import {
  buildCollectionActionRequest,
  buildHomeAssistantRoomOverlayNodes,
  getActionBindingForMember,
  getCollectionDisplayName,
} from './room-overlay/room-overlay-nodes'
import {
  getSmartHomeRoomGroupMemberResourceId,
  smartHomeRoomGroupMemberReferencesResource,
} from './smart-home-composition'
import { DEFAULT_SMART_HOME_OVERLAY_VISIBILITY, type SmartHomeOverlayVisibility } from './types'

export type HomeAssistantDeviceActionDispatch = {
  binding: HomeAssistantCollectionBinding
  collectionName: string
  request: HomeAssistantActionRequest
}

type HomeAssistantInteractiveSystemProps = {
  onHomeAssistantDeviceAction?: (payload: HomeAssistantDeviceActionDispatch) => void | Promise<void>
  overlayInteractive?: boolean
  overlayVisibility?: SmartHomeOverlayVisibility
  showItemEffects?: boolean
}

function getResourceDomain(resourceId: string | null | undefined) {
  return typeof resourceId === 'string' ? resourceId.split('.', 1)[0] : null
}

function getPrimaryResourceDomain(binding: HomeAssistantCollectionBinding) {
  const primaryResource =
    binding.resources.find((resource) => resource.id === binding.primaryResourceId) ??
    binding.resources[0]
  return getResourceDomain(
    primaryResource?.entityId ?? primaryResource?.id ?? binding.primaryResourceId,
  )
}

function getDisplayFallbackKind(
  binding: HomeAssistantCollectionBinding,
): HomeAssistantDisplayItemKind | undefined {
  return getPrimaryResourceDomain(binding) === 'media_player' ? 'television' : undefined
}

export function HomeAssistantInteractiveSystem({
  onHomeAssistantDeviceAction,
  overlayInteractive = true,
  overlayVisibility = DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
  showItemEffects = true,
}: HomeAssistantInteractiveSystemProps = {}) {
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const sceneNodes = useScene((state) => state.nodes)
  const sceneCollections = useScene((state) => state.collections ?? {})
  const updateNode = useScene((state) => state.updateNode)
  const setControlValue = useInteractive((state) => state.setControlValue)
  const pendingActionTimeoutsRef = useRef<Record<string, number>>({})

  const homeAssistantBindings = useMemo(
    () => getHomeAssistantBindingNodeMap(sceneNodes),
    [sceneNodes],
  )

  const roomOverlayNodes = useMemo<RoomOverlayNode[]>(
    () =>
      buildHomeAssistantRoomOverlayNodes({
        bindings: homeAssistantBindings,
        collections: sceneCollections,
        sceneNodes,
        selectedLevelId,
        visibility: overlayVisibility,
      }),
    [homeAssistantBindings, sceneCollections, sceneNodes, selectedLevelId, overlayVisibility],
  )

  useEffect(
    () => () => {
      if (typeof window === 'undefined') {
        return
      }
      for (const timeoutId of Object.values(pendingActionTimeoutsRef.current)) {
        window.clearTimeout(timeoutId)
      }
      pendingActionTimeoutsRef.current = {}
    },
    [],
  )

  const updateBindingNode = useCallback(
    (bindingNode: HomeAssistantBindingNode, nextBinding: HomeAssistantCollectionBinding) => {
      const scene = useScene.getState()
      const wasReadOnly = scene.readOnly
      if (wasReadOnly) {
        scene.setReadOnly(false)
      }
      updateNode(bindingNode.id as AnyNodeId, nextBinding as Partial<AnyNode>)
      if (wasReadOnly) {
        useScene.getState().setReadOnly(true)
      }
    },
    [updateNode],
  )

  const applyRoomGroupingToCollection = useCallback(
    (collectionId: string, nextGroups: string[][]) => {
      const controls =
        roomOverlayNodes
          .find((roomOverlayNode) => roomOverlayNode.id === collectionId)
          ?.controlGroups.flatMap((group) => group.members) ?? []
      const bindingNode = homeAssistantBindings[collectionId as CollectionId]
      if (!bindingNode) {
        return
      }

      const nextBinding = getBindingAfterRoomGrouping({
        binding: bindingNode,
        collectionId,
        controls,
        groups: nextGroups,
      })
      if (!nextBinding) {
        return
      }

      updateBindingNode(bindingNode, nextBinding)
    },
    [homeAssistantBindings, roomOverlayNodes, updateBindingNode],
  )

  const resolveRoomControlMemberResourceId = useCallback(
    (member: RoomControlTile, binding: HomeAssistantCollectionBinding) =>
      member.resourceId ??
      binding.resources.find((resource) =>
        smartHomeRoomGroupMemberReferencesResource(member.collectionId, member.id, resource.id),
      )?.id ??
      getSmartHomeRoomGroupMemberResourceId(member.collectionId, member.id),
    [],
  )

  const copyDeviceResourceToGroup = useCallback(
    (
      sourceCollectionId: CollectionId,
      targetCollectionId: CollectionId,
      sourceResourceId?: string,
    ) => {
      if (sourceCollectionId === targetCollectionId) {
        return
      }

      const currentBindings = getHomeAssistantBindingNodeMap(useScene.getState().nodes)
      const sourceBinding = currentBindings[sourceCollectionId]
      const targetBindingNode = currentBindings[targetCollectionId]
      if (!(sourceBinding && targetBindingNode)) {
        return
      }

      const nextBinding = getBindingAfterDeviceResourceCopyToGroup({
        sourceBinding,
        sourceResourceId,
        targetBinding: targetBindingNode,
        targetCollectionId,
      })
      if (!nextBinding) {
        return
      }

      updateBindingNode(targetBindingNode, nextBinding)
    },
    [updateBindingNode],
  )

  const removeDeviceResourceFromGroup = useCallback(
    (member: RoomControlTile) => {
      const currentBindings = getHomeAssistantBindingNodeMap(useScene.getState().nodes)
      const bindingNode = currentBindings[member.collectionId]
      if (!bindingNode) {
        return
      }

      const resourceId = resolveRoomControlMemberResourceId(member, bindingNode)
      if (!resourceId) {
        return
      }

      const nextBinding = getBindingAfterDeviceResourceRemovalFromGroup(bindingNode, resourceId)
      if (!nextBinding) {
        return
      }

      updateBindingNode(bindingNode, nextBinding)
    },
    [resolveRoomControlMemberResourceId, updateBindingNode],
  )

  const handleRoomControlChange = useCallback(
    ({ member, nextValue, source }: RoomControlChange) => {
      if (member.disabled) {
        return
      }

      const collection = sceneCollections[member.collectionId]
      const binding = homeAssistantBindings[member.collectionId]
      if (!(collection && binding) || typeof window === 'undefined') {
        return
      }

      const actionBinding = getActionBindingForMember(binding, member)
      if (!actionBinding) {
        return
      }

      const request = buildCollectionActionRequest(actionBinding, member, nextValue, source)
      if (!request) {
        return
      }

      const visualItemId = member.linkedItemId ?? member.itemId
      const visualNode = sceneNodes[visualItemId]
      const displayFallbackKind = getDisplayFallbackKind(actionBinding)
      const displayKind =
        visualNode?.type === 'item' ? getHomeAssistantDisplayItemKind(visualNode) : null
      if (
        source === 'primary' &&
        visualNode?.type === 'item' &&
        (displayKind || displayFallbackKind)
      ) {
        if (request.kind === 'toggle') {
          if (request.value) {
            homeAssistantItemEffects.trigger(visualItemId, 450, displayFallbackKind)
          } else {
            homeAssistantItemEffects.clear(visualItemId)
          }
        } else if (request.kind === 'trigger') {
          homeAssistantItemEffects.trigger(visualItemId, 450, displayFallbackKind)
        }
      }

      const pendingActionKey = `${member.collectionId}:${member.id}:${source}`
      const existingTimeoutId = pendingActionTimeoutsRef.current[pendingActionKey]
      if (existingTimeoutId) {
        window.clearTimeout(existingTimeoutId)
      }

      const delayMs = request.kind === 'range' ? 120 : 0
      pendingActionTimeoutsRef.current[pendingActionKey] = window.setTimeout(() => {
        if (onHomeAssistantDeviceAction) {
          void Promise.resolve(
            onHomeAssistantDeviceAction({
              binding: actionBinding,
              collectionName: getCollectionDisplayName(collection, homeAssistantBindings),
              request,
            }),
          ).catch(() => {})
        }
        if (request.kind === 'trigger' && member.control.kind === 'toggle') {
          window.setTimeout(() => {
            setControlValue(member.itemId, member.controlIndex, false)
            if (member.linkedItemId && member.linkedItemId !== member.itemId) {
              setControlValue(member.linkedItemId, member.controlIndex, false)
            }
          }, 220)
        }
        delete pendingActionTimeoutsRef.current[pendingActionKey]
      }, delayMs)
    },
    [
      homeAssistantBindings,
      onHomeAssistantDeviceAction,
      sceneCollections,
      sceneNodes,
      setControlValue,
    ],
  )

  return (
    <>
      {showItemEffects && <HomeAssistantItemEffects />}
      <RoomControlOverlay
        interactive={overlayInteractive}
        onApplyRoomGrouping={applyRoomGroupingToCollection}
        onCopyRoomControlToRoom={copyDeviceResourceToGroup}
        onRemoveRoomControlFromRoom={removeDeviceResourceFromGroup}
        onRoomControlChange={handleRoomControlChange}
        roomOverlayNodes={roomOverlayNodes}
      />
    </>
  )
}
