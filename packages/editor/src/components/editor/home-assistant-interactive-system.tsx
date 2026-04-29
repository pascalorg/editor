'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CollectionId,
  getHomeAssistantBindingNodeMap,
  type HomeAssistantActionRequest,
  type HomeAssistantCollectionBinding,
  normalizeHomeAssistantCollectionBinding,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { InteractiveSystem, useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  normalizeRoomControlGroupList,
  type RoomControlChange,
  type RoomControlTile,
  type RoomOverlayNode,
} from '../../features/home-assistant/room-overlay/room-control-model'
import {
  bindingHasGroupResource,
  buildCollectionActionRequest,
  buildHomeAssistantRoomOverlayNodes,
  getActionBindingForMember,
  getCollectionDisplayName,
} from '../../features/home-assistant/room-overlay/room-overlay-nodes'
import { RoomControlOverlay } from '../../features/home-assistant/room-overlay/room-control-overlay'
import {
  buildSmartHomeRoomControlCompositionFromTileGroups,
  cloneSmartHomeResourceBinding,
  getDurableSmartHomeRoomControlTileGroups,
  getSmartHomeExcludedResourceIds,
  getSmartHomeRoomControlTileGroups,
  getSmartHomeRoomControlTileId,
  isSmartHomeDeviceComponentResource,
} from '../../lib/smart-home-composition'
import { requestSceneImmediateSave } from '../../lib/scene'
import useEditor from '../../store/use-editor'

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
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const sceneNodes = useScene((state) => state.nodes)
  const sceneCollections = useScene((state) => state.collections ?? {})
  const updateNode = useScene((state) => state.updateNode)
  const setControlValue = useInteractive((state) => state.setControlValue)
  const smartHomeOverlayVisibility = useEditor((state) => state.smartHomeOverlayVisibility)
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
        visibility: smartHomeOverlayVisibility,
      }),
    [
      homeAssistantBindings,
      sceneCollections,
      sceneNodes,
      selectedLevelId,
      smartHomeOverlayVisibility,
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
      const normalizedGroups = normalizeRoomControlGroupList(
        getDurableSmartHomeRoomControlTileGroups({
          collectionId,
          controls,
          groups: nextGroups,
        }),
      )
      const bindingNode = homeAssistantBindings[collectionId as CollectionId]
      if (!bindingNode) {
        return
      }

      updateNode(bindingNode.id, {
        presentation: {
          ...(bindingNode.presentation ?? {}),
          rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
            collectionId,
            excludedResourceIds: getSmartHomeExcludedResourceIds(bindingNode.presentation),
            groups: normalizedGroups,
            mode: 'user-managed',
            resources: bindingNode.resources,
          }),
        },
      } as Partial<AnyNode>)
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
      if (!(sourceBinding && targetBindingNode && bindingHasGroupResource(targetBindingNode))) {
        return
      }

      const sourceResource = sourceBinding.resources.find(isSmartHomeDeviceComponentResource)
      if (!sourceResource) {
        return
      }

      if (targetBindingNode.resources.some((resource) => resource.id === sourceResource.id)) {
        return
      }

      const existingGroups = normalizeRoomControlGroupList(
        getSmartHomeRoomControlTileGroups({
          collectionId: targetCollectionId,
          presentation: targetBindingNode.presentation,
        }),
      )
      const targetDeviceResources = targetBindingNode.resources.filter(
        isSmartHomeDeviceComponentResource,
      )
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
      const nextRtsGroups = [
        ...baseGroups
          .map((group) => group.filter((memberId) => memberId !== copiedMemberId))
          .filter((group) => group.length > 0),
        [copiedMemberId],
      ]
      const currentPrimaryResource = targetBindingNode.resources.find(
        (resource) => resource.id === targetBindingNode.primaryResourceId,
      )
      const nextBinding = normalizeHomeAssistantCollectionBinding({
        aggregation: 'all',
        collectionId: targetBindingNode.collectionId,
        presentation: {
          ...(targetBindingNode.presentation ?? {}),
          rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
            collectionId: targetCollectionId,
            excludedResourceIds: getSmartHomeExcludedResourceIds(
              targetBindingNode.presentation,
            ).filter((resourceId) => resourceId !== sourceResource.id),
            groups: nextRtsGroups,
            mode: 'user-managed',
            resources: [...targetBindingNode.resources, sourceResource],
          }),
        },
        primaryResourceId: isSmartHomeDeviceComponentResource(currentPrimaryResource)
          ? (currentPrimaryResource?.id ?? sourceResource.id)
          : sourceResource.id,
        resources: [...targetBindingNode.resources, cloneSmartHomeResourceBinding(sourceResource)],
      })

      if (!nextBinding) {
        return
      }

      updateNode(targetBindingNode.id, nextBinding as Partial<AnyNode>)
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
      if (!(bindingNode && bindingHasGroupResource(bindingNode))) {
        return
      }

      const removedResource = bindingNode.resources.find(
        (resource) => resource.id === member.resourceId,
      )
      if (!removedResource || !isSmartHomeDeviceComponentResource(removedResource)) {
        return
      }

      const nextResources = bindingNode.resources.filter(
        (resource) => resource.id !== removedResource.id,
      )
      const nextDeviceResources = nextResources.filter(isSmartHomeDeviceComponentResource)
      const nextPrimaryResourceId =
        bindingNode.primaryResourceId === removedResource.id
          ? (nextDeviceResources[0]?.id ?? nextResources[0]?.id ?? null)
          : (bindingNode.primaryResourceId ??
            nextDeviceResources[0]?.id ??
            nextResources[0]?.id ??
            null)
      const nextExcludedResourceIds = Array.from(
        new Set([...getSmartHomeExcludedResourceIds(bindingNode.presentation), removedResource.id]),
      )
      const nextBinding = normalizeHomeAssistantCollectionBinding({
        aggregation: nextResources.some((resource) => resource.kind !== 'entity')
          ? 'trigger_only'
          : nextDeviceResources.length > 1
            ? 'all'
            : 'single',
        collectionId: bindingNode.collectionId,
        presentation: {
          ...(bindingNode.presentation ?? {}),
          rtsRoomControls: buildSmartHomeRoomControlCompositionFromTileGroups({
            collectionId: bindingNode.collectionId,
            excludedResourceIds: nextExcludedResourceIds,
            groups: getSmartHomeRoomControlTileGroups({
              collectionId: bindingNode.collectionId,
              presentation: bindingNode.presentation,
            }).map((group) =>
              group.filter(
                (memberId) =>
                  memberId !==
                  getSmartHomeRoomControlTileId(bindingNode.collectionId, removedResource.id),
              ),
            ),
            mode: 'user-managed',
            resources: nextResources,
          }),
        },
        primaryResourceId: nextPrimaryResourceId,
        resources: nextResources,
      })

      if (!nextBinding) {
        return
      }

      updateNode(bindingNode.id, nextBinding as Partial<AnyNode>)
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
        onApplyRoomGrouping={applyRoomGroupingToCollection}
        onCopyRoomControlToRoom={copyDeviceResourceToGroup}
        onRemoveRoomControlFromRoom={removeDeviceResourceFromGroup}
        onRoomControlChange={handleRoomControlChange}
        roomOverlayNodes={roomOverlayNodes}
      />
    </>
  )
}
