'use client'

import {
  RoomControlOverlay,
  type RoomControlChange,
  type RoomControlTile,
  type RoomOverlayNode,
  buildCollectionActionRequest,
  buildHomeAssistantRoomOverlayNodes,
  getActionBindingForMember,
  getCollectionDisplayName,
  homeAssistantItemEffects,
  HomeAssistantItemEffects,
} from '@pascal-app/home-assistant'
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
  type HomeAssistantCollectionBinding,
} from '../home-assistant-binding'
import {
  getBindingAfterDeviceResourceCopyToGroup,
  getBindingAfterDeviceResourceRemovalFromGroup,
  getBindingAfterRoomGrouping,
} from '../home-assistant-binding-presentation'
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
    [
      homeAssistantBindings,
      sceneCollections,
      sceneNodes,
      selectedLevelId,
      overlayVisibility,
    ],
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

  const copyDeviceResourceToGroup = useCallback(
    (sourceCollectionId: CollectionId, targetCollectionId: CollectionId) => {
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

  const removeDeviceResourceFromGroup = useCallback(
    (member: RoomControlTile) => {
      if (!member.resourceId) {
        return
      }

      const currentBindings = getHomeAssistantBindingNodeMap(useScene.getState().nodes)
      const bindingNode = currentBindings[member.collectionId]
      if (!bindingNode) {
        return
      }

      const nextBinding = getBindingAfterDeviceResourceRemovalFromGroup(
        bindingNode,
        member.resourceId,
      )
      if (!nextBinding) {
        return
      }

      updateNode(bindingNode.id as AnyNodeId, nextBinding as Partial<AnyNode>)
      requestSceneImmediateSave()
    },
    [updateNode],
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
      if (
        source === 'primary' &&
        member.itemKind === 'tv' &&
        sceneNodes[visualItemId]?.type === 'item'
      ) {
        if (request.kind === 'toggle') {
          if (request.value) {
            homeAssistantItemEffects.trigger(visualItemId)
          } else {
            homeAssistantItemEffects.clear(visualItemId)
          }
        } else if (request.kind === 'trigger') {
          homeAssistantItemEffects.trigger(visualItemId)
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
        onRemoveRoomControlFromRoom={removeDeviceResourceFromGroup}
        onRoomControlChange={handleRoomControlChange}
        roomOverlayNodes={roomOverlayNodes}
      />
    </>
  )
}
