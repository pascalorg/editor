'use client'

import {
  getHomeAssistantBindingNodeMap,
  type HomeAssistantActionRequest,
  type HomeAssistantCollectionBinding,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { InteractiveSystem, useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { RoomControlChange, RoomOverlayNode } from './room-overlay/room-control-model'
import { RoomControlOverlay } from './room-overlay/room-control-overlay'
import {
  buildCollectionActionRequest,
  buildHomeAssistantRoomOverlayNodes,
  getActionBindingForMember,
  getCollectionDisplayName,
} from './room-overlay/room-overlay-nodes'
import { DEFAULT_SMART_HOME_OVERLAY_VISIBILITY, type SmartHomeOverlayVisibility } from './types'

export type HomeAssistantDeviceActionDispatch = {
  binding: HomeAssistantCollectionBinding
  collectionName: string
  request: HomeAssistantActionRequest
}

type HomeAssistantInteractiveSystemProps = {
  onHomeAssistantDeviceAction?: (payload: HomeAssistantDeviceActionDispatch) => void | Promise<void>
  overlayVisibility?: SmartHomeOverlayVisibility
}

export function HomeAssistantInteractiveSystem({
  onHomeAssistantDeviceAction,
  overlayVisibility = DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
}: HomeAssistantInteractiveSystemProps = {}) {
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const sceneNodes = useScene((state) => state.nodes)
  const sceneCollections = useScene((state) => state.collections ?? {})
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
        const viewer = useViewer.getState()
        if (request.kind === 'toggle') {
          if (request.value) {
            viewer.triggerItemEffect(visualItemId)
          } else {
            viewer.clearItemEffect(visualItemId)
          }
        } else if (request.kind === 'trigger') {
          viewer.triggerItemEffect(visualItemId)
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
      <InteractiveSystem />
      <RoomControlOverlay
        onRoomControlChange={handleRoomControlChange}
        roomOverlayNodes={roomOverlayNodes}
      />
    </>
  )
}
