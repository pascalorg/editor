'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CollectionId,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import {
  buildCollectionActionRequest,
  buildHomeAssistantRoomOverlayNodes,
  getActionBindingForMember,
  getCollectionDisplayName,
  getHomeAssistantDisplayItemKind,
  type HomeAssistantDisplayItemKind,
  HomeAssistantItemEffects,
  homeAssistantItemEffects,
  type RoomControlChange,
  RoomControlOverlay,
  type RoomControlTile,
  type RoomOverlayNode,
} from '@pascal-app/home-assistant'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  getHomeAssistantBindingNodeMap,
  type HomeAssistantActionRequest,
  type HomeAssistantCollectionBinding,
} from '../home-assistant-binding'
import {
  getBindingAfterDeviceResourceCopyToGroup,
  getBindingAfterDeviceResourceRemovalFromGroup,
  getBindingAfterDeviceResourcesMergeIntoGroup,
  getBindingAfterRoomGrouping,
} from '../home-assistant-binding-presentation'
import {
  getSmartHomeRoomGroupMemberResourceId,
  smartHomeRoomGroupMemberReferencesResource,
} from '../smart-home-composition'
import { requestSceneImmediateSave } from './editor-panel-adapter'
import { useHomeAssistantEditorStore } from './home-assistant-editor-store'

export type HomeAssistantDeviceActionDispatch = {
  binding: HomeAssistantCollectionBinding
  collectionName: string
  request: HomeAssistantActionRequest
}

type HomeAssistantInteractiveSystemProps = {
  onHomeAssistantDeviceAction?: (payload: HomeAssistantDeviceActionDispatch) => void | Promise<void>
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
}: HomeAssistantInteractiveSystemProps = {}) {
  const overlayVisibility = useHomeAssistantEditorStore((state) => state.overlayVisibility)
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const sceneNodes = useScene((state) => state.nodes)
  const sceneCollections = useScene((state) => state.collections ?? {})
  const updateNode = useScene((state) => state.updateNode)
  const setControlValue = useInteractive((state) => state.setControlValue)
  const pendingCollectionActionTimeoutsRef = useRef<Record<string, number>>({})

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
      for (const timeoutId of Object.values(pendingCollectionActionTimeoutsRef.current)) {
        window.clearTimeout(timeoutId)
      }
      pendingCollectionActionTimeoutsRef.current = {}
    },
    [],
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

      updateNode(bindingNode.id as AnyNodeId, nextBinding as Partial<AnyNode>)
      requestSceneImmediateSave()
    },
    [homeAssistantBindings, roomOverlayNodes, updateNode],
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

      const sourceBinding = homeAssistantBindings[sourceCollectionId]
      const targetBindingNode = homeAssistantBindings[targetCollectionId]
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

      updateNode(targetBindingNode.id as AnyNodeId, nextBinding as Partial<AnyNode>)
      requestSceneImmediateSave()
    },
    [homeAssistantBindings, updateNode],
  )

  const mergeDeviceResourcesIntoGroup = useCallback(
    (
      sourceCollectionId: CollectionId,
      targetCollectionId: CollectionId,
      sourceResourceId: string,
      targetResourceId: string,
    ) => {
      if (sourceCollectionId === targetCollectionId && sourceResourceId === targetResourceId) {
        return
      }

      const sourceBinding = homeAssistantBindings[sourceCollectionId]
      const targetBindingNode = homeAssistantBindings[targetCollectionId]
      if (!(sourceBinding && targetBindingNode)) {
        return
      }

      const nextBinding = getBindingAfterDeviceResourcesMergeIntoGroup({
        sourceBinding,
        sourceResourceId,
        targetBinding: targetBindingNode,
        targetCollectionId,
        targetResourceId,
      })
      if (!nextBinding) {
        return
      }

      updateNode(targetBindingNode.id as AnyNodeId, nextBinding as Partial<AnyNode>)
      requestSceneImmediateSave()
    },
    [homeAssistantBindings, updateNode],
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

      updateNode(bindingNode.id as AnyNodeId, nextBinding as Partial<AnyNode>)
      requestSceneImmediateSave()
    },
    [resolveRoomControlMemberResourceId, updateNode],
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

      const existingTimeoutId = pendingCollectionActionTimeoutsRef.current[member.collectionId]
      if (existingTimeoutId) {
        window.clearTimeout(existingTimeoutId)
      }

      const delayMs = request.kind === 'range' ? 120 : 0
      pendingCollectionActionTimeoutsRef.current[member.collectionId] = window.setTimeout(() => {
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
        delete pendingCollectionActionTimeoutsRef.current[member.collectionId]
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
      <HomeAssistantItemEffects />
      <RoomControlOverlay
        onApplyRoomGrouping={applyRoomGroupingToCollection}
        onCopyRoomControlToRoom={copyDeviceResourceToGroup}
        onMergeRoomControlDevices={mergeDeviceResourcesIntoGroup}
        onRemoveRoomControlFromRoom={removeDeviceResourceFromGroup}
        onRoomControlChange={handleRoomControlChange}
        roomOverlayNodes={roomOverlayNodes}
      />
    </>
  )
}
