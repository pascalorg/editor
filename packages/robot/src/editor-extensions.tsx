'use client'

import {
  type AnyNodeId,
  getScaledDimensions,
  type ItemNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  registerItemActionHandlers,
  registerItemMoveExtension,
  triggerSFX,
  useEditor,
  type ItemMoveExtension,
  type ItemMoveExtensionContext,
} from '@pascal-app/editor/robot-adapter'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { setItemMoveVisualState, type ItemMoveVisualState } from './lib/item-move-visuals'
import { stripTransientMetadata } from './lib/transient'
import useNavigation, {
  requestNavigationItemDelete,
  requestNavigationItemRepair,
} from './store/use-navigation'
import {
  getNavigationDraftRobotCopySourceIdFromNode,
  setNavigationDraftRobotCopySourceId,
} from './store/use-navigation-drafts'
import navigationVisualsStore from './store/use-navigation-visuals'

function canUseRobotItemTask(node: ItemNode) {
  if (node.asset.attachTo) return false
  const parentNode = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : null
  return parentNode?.type !== 'item'
}

function setPreviewOutlineIds(ids: string[]) {
  const viewer = useViewer.getState()
  if (viewer.previewSelectedIds.length === ids.length && ids.every((id, index) => id === viewer.previewSelectedIds[index])) {
    return
  }
  viewer.setPreviewSelectedIds(ids)
}

function setDraftVisualState(
  draftNode: ItemMoveExtensionContext['draftNode'],
  state: ItemMoveVisualState | null,
) {
  const draft = draftNode.current
  if (draft) {
    navigationVisualsStore.getState().setItemMoveVisualState(draft.id, state)
  }
}

function setDraftVisibility(draftNode: ItemMoveExtensionContext['draftNode'], visible: boolean) {
  const draft = draftNode.current
  if (!draft) return
  draft.visible = visible
  navigationVisualsStore.getState().setNodeVisibilityOverride(draft.id, visible)
  const object = sceneRegistry.nodes.get(draft.id)
  if (object) object.visible = visible
}

function syncDraftTransform(
  draftNode: ItemMoveExtensionContext['draftNode'],
  transform: { position?: [number, number, number]; rotationY?: number | null },
) {
  const draft = draftNode.current
  if (!draft) return

  if (transform.position) {
    draft.position = [...transform.position] as [number, number, number]
  }
  if (typeof transform.rotationY === 'number') {
    draft.rotation = [draft.rotation[0] ?? 0, transform.rotationY, draft.rotation[2] ?? 0]
  }

  const position = transform.position ?? draft.position
  const rotationY = transform.rotationY ?? draft.rotation[1] ?? 0
  useLiveTransforms.getState().set(draft.id, { position, rotation: rotationY })

  const object = sceneRegistry.nodes.get(draft.id)
  if (object) {
    object.position.set(position[0], position[1], position[2])
    object.rotation.y = rotationY
    object.updateMatrixWorld(true)
  }
}

function useRobotItemMoveExtension({
  draftNode,
  isNew,
  meta,
  movingNode,
}: ItemMoveExtensionContext): ItemMoveExtension | null {
  const {
    enabled,
    itemMoveLocked,
    moveItemsEnabled,
    registerItemMoveController,
    requestItemMove,
    setItemMoveLocked,
  } = useNavigation(
    useShallow((state) => ({
      enabled: state.enabled,
      itemMoveLocked: state.itemMoveLocked,
      moveItemsEnabled: state.moveItemsEnabled,
      registerItemMoveController: state.registerItemMoveController,
      requestItemMove: state.requestItemMove,
      setItemMoveLocked: state.setItemMoveLocked,
    })),
  )
  const sceneBackedMovingNode = useScene((state) => {
    const node = state.nodes[movingNode.id as AnyNodeId]
    return node?.type === 'item' ? (node as ItemNode) : null
  })
  const robotCopySourceId = !sceneBackedMovingNode
    ? getNavigationDraftRobotCopySourceIdFromNode(movingNode)
    : null
  const robotCopySourceNode = useScene((state) => {
    const node = robotCopySourceId ? state.nodes[robotCopySourceId as AnyNodeId] : null
    return node?.type === 'item' ? (node as ItemNode) : null
  })
  const detachedTaskRef = useRef(false)
  const handoffCommittedRef = useRef(false)
  const clearSourceFrameRef = useRef<number | null>(null)
  const clearSourceFollowupFrameRef = useRef<number | null>(null)
  const [handoffCommitted, setHandoffCommitted] = useState(false)

  const isSceneBackedItem = sceneBackedMovingNode !== null
  const useRobotCarryPreview =
    !isNew && enabled && moveItemsEnabled && canUseRobotItemTask(movingNode)
  const useRobotCopyPreview =
    isNew &&
    !isSceneBackedItem &&
    enabled &&
    moveItemsEnabled &&
    robotCopySourceNode !== null &&
    canUseRobotItemTask(robotCopySourceNode)
  const useRobotItemPreview = useRobotCarryPreview || useRobotCopyPreview
  const robotPreviewSourceId = useRobotCopyPreview ? robotCopySourceId : movingNode.id

  const cancelPendingSourceTransformClear = useCallback(() => {
    if (clearSourceFrameRef.current !== null) {
      cancelAnimationFrame(clearSourceFrameRef.current)
      clearSourceFrameRef.current = null
    }
    if (clearSourceFollowupFrameRef.current !== null) {
      cancelAnimationFrame(clearSourceFollowupFrameRef.current)
      clearSourceFollowupFrameRef.current = null
    }
  }, [])

  const clearRobotPreviewState = useCallback(
    ({
      preserveSourceLiveTransform = false,
      previewDraftId = null,
    }: {
      preserveSourceLiveTransform?: boolean
      previewDraftId?: ItemNode['id'] | null
    } = {}) => {
      cancelPendingSourceTransformClear()
      handoffCommittedRef.current = false
      setHandoffCommitted(false)
      setPreviewOutlineIds([])
      navigationVisualsStore.getState().setItemMovePreview(null)

      if (robotPreviewSourceId) {
        navigationVisualsStore.getState().setItemMoveVisualState(robotPreviewSourceId, null)
        navigationVisualsStore.getState().setNodeVisibilityOverride(robotPreviewSourceId, null)
        if (!(preserveSourceLiveTransform || isNew)) {
          useLiveTransforms.getState().clear(robotPreviewSourceId)
        }
      }

      const draftId = previewDraftId ?? draftNode.current?.id ?? null
      if (draftId) {
        navigationVisualsStore.getState().setNodeVisibilityOverride(draftId, null)
        navigationVisualsStore.getState().setItemMoveVisualState(draftId, null)
        useLiveTransforms.getState().clear(draftId)
      }
    },
    [cancelPendingSourceTransformClear, draftNode, isNew, robotPreviewSourceId],
  )

  const scheduleSourceTransformClear = useCallback(
    (transform: { position: [number, number, number]; rotation: number } | null) => {
      cancelPendingSourceTransformClear()
      if (transform) useLiveTransforms.getState().set(movingNode.id, transform)
      clearSourceFrameRef.current = requestAnimationFrame(() => {
        clearSourceFrameRef.current = null
        clearSourceFollowupFrameRef.current = requestAnimationFrame(() => {
          clearSourceFollowupFrameRef.current = null
          useLiveTransforms.getState().clear(movingNode.id)
        })
      })
    },
    [cancelPendingSourceTransformClear, movingNode.id],
  )

  useEffect(() => {
    if (
      !sceneBackedMovingNode ||
      (!Object.hasOwn(meta, 'isNew') && !Object.hasOwn(meta, 'robotCopySourceId'))
    ) {
      return
    }
    useScene.getState().updateNode(sceneBackedMovingNode.id as AnyNodeId, {
      metadata: stripTransientMetadata(sceneBackedMovingNode.metadata) as ItemNode['metadata'],
    })
  }, [meta, sceneBackedMovingNode])

  useEffect(() => {
    if (!useRobotItemPreview) clearRobotPreviewState()
  }, [clearRobotPreviewState, useRobotItemPreview])

  useEffect(() => {
    const sourceNode = useRobotCopyPreview ? robotCopySourceNode : movingNode
    if (!(useRobotItemPreview && sourceNode && robotPreviewSourceId)) {
      if (robotPreviewSourceId) registerItemMoveController(robotPreviewSourceId, null)
      return
    }

    cancelPendingSourceTransformClear()
    registerItemMoveController(robotPreviewSourceId, {
      itemId: robotPreviewSourceId,
      beginCarry: () => {
        if (useRobotCarryPreview) {
          navigationVisualsStore.getState().setItemMoveVisualState(sourceNode.id, 'carried')
          return
        }

        const draft = draftNode.current
        if (!draft) return
        setDraftVisualState(draftNode, 'carried')
        useLiveTransforms.getState().set(draft.id, {
          position: [...sourceNode.position] as [number, number, number],
          rotation: sourceNode.rotation[1] ?? 0,
        })
      },
      cancel: () => {
        clearRobotPreviewState()
        draftNode.destroy()
        registerItemMoveController(robotPreviewSourceId, null)
        setItemMoveLocked(false)
        if (isNew) setNavigationDraftRobotCopySourceId(movingNode.id, null)
        useEditor.getState().setMovingNode(null)
      },
      commit: (finalUpdate, finalCarryTransform) => {
        const previewDraftId = draftNode.current?.id ?? null
        const sourceMetadata =
          (useScene.getState().nodes[sourceNode.id as AnyNodeId] as ItemNode | undefined)?.metadata ??
          sourceNode.metadata
        const committedSourceTransform = useRobotCarryPreview
          ? (finalCarryTransform ??
            useLiveTransforms.getState().get(movingNode.id) ??
            (finalUpdate.position
              ? {
                  position: [...finalUpdate.position] as [number, number, number],
                  rotation: finalUpdate.rotation?.[1] ?? movingNode.rotation[1] ?? 0,
                }
              : null))
          : null
        let committedId: string | null = null
        if (useRobotCarryPreview) {
          if (previewDraftId) {
            useScene.temporal.getState().pause()
            useScene.getState().deleteNode(previewDraftId as AnyNodeId)
            useScene.temporal.getState().resume()
          }
          useScene.getState().updateNode(sourceNode.id as AnyNodeId, {
            ...finalUpdate,
            metadata: setItemMoveVisualState(
              stripTransientMetadata(sourceMetadata),
              null,
            ) as ItemNode['metadata'],
            visible: true,
          })
          committedId = sourceNode.id
        } else {
          committedId = draftNode.commit({
            ...finalUpdate,
            metadata: setItemMoveVisualState(
              stripTransientMetadata(sourceMetadata),
              null,
            ) as ItemNode['metadata'],
            visible: true,
          })
        }
        clearRobotPreviewState({
          preserveSourceLiveTransform: useRobotCarryPreview,
          previewDraftId,
        })
        if (useRobotCarryPreview) scheduleSourceTransformClear(committedSourceTransform)
        if (committedId) triggerSFX('sfx:item-place')
        registerItemMoveController(robotPreviewSourceId, null)
        setItemMoveLocked(false)
        useEditor.getState().setMovingNode(null)
      },
      updateCarryTransform: (position, rotationY) => {
        const visualId = useRobotCarryPreview ? movingNode.id : draftNode.current?.id
        if (visualId) useLiveTransforms.getState().set(visualId, { position, rotation: rotationY })
      },
    })

    return () => {
      cancelPendingSourceTransformClear()
      if (!detachedTaskRef.current) registerItemMoveController(robotPreviewSourceId, null)
    }
  }, [
    cancelPendingSourceTransformClear,
    clearRobotPreviewState,
    draftNode,
    isNew,
    movingNode.id,
    movingNode.rotation,
    registerItemMoveController,
    robotCopySourceNode,
    robotPreviewSourceId,
    scheduleSourceTransformClear,
    setItemMoveLocked,
    useRobotCarryPreview,
    useRobotCopyPreview,
    useRobotItemPreview,
  ])

  useEffect(
    () => () => {
      cancelPendingSourceTransformClear()
      if (isNew) setNavigationDraftRobotCopySourceId(movingNode.id, null)
    },
    [cancelPendingSourceTransformClear, isNew, movingNode.id],
  )

  if (!useRobotItemPreview) {
    return null
  }

  return {
    ignoreItemIds: robotPreviewSourceId ? [robotPreviewSourceId] : undefined,
    initDraft: (gridPosition: Vector3) => {
      if (useRobotCopyPreview && robotCopySourceId) {
        gridPosition.copy(new Vector3(...movingNode.position))
        if (!movingNode.asset.attachTo) {
          draftNode.create(gridPosition, movingNode.asset, movingNode.rotation, movingNode.scale, {
            metadata: movingNode.metadata,
            name: movingNode.name,
            parentId: movingNode.parentId,
          })
          setDraftVisualState(draftNode, 'destination-preview')
          setDraftVisibility(draftNode, true)
          navigationVisualsStore.getState().setItemMoveVisualState(robotCopySourceId, 'copy-source-pending')
          const draftId = draftNode.current?.id
          setPreviewOutlineIds(draftId ? [draftId] : [])
        }
        return true
      }

      if (useRobotCarryPreview) {
        const gridPosition = new Vector3(...movingNode.position)
        const draft = draftNode.create(
          gridPosition,
          movingNode.asset,
          movingNode.rotation,
          movingNode.scale,
          {
            metadata: movingNode.metadata,
            name: movingNode.name,
            parentId: movingNode.parentId,
          },
        )
        if (draft) {
          useLiveTransforms.getState().set(draft.id, {
            position: [...movingNode.position] as [number, number, number],
            rotation: movingNode.rotation[1] ?? 0,
          })
          setDraftVisualState(draftNode, 'destination-preview')
          setDraftVisibility(draftNode, true)
          navigationVisualsStore.getState().setItemMoveVisualState(movingNode.id, 'source-pending')
          setPreviewOutlineIds([draft.id])
          navigationVisualsStore.getState().setItemMovePreview({
            id: draft.id,
            sourceItemId: movingNode.id,
          })
        }
        gridPosition.copy(new Vector3(...movingNode.position))
        return true
      }

      return false
    },
    isDisabled: () => itemMoveLocked || handoffCommittedRef.current,
    onCancel: () => {
      detachedTaskRef.current = false
      clearRobotPreviewState()
      if (robotPreviewSourceId) registerItemMoveController(robotPreviewSourceId, null)
      requestItemMove(null)
      setItemMoveLocked(false)
      if (isNew) setNavigationDraftRobotCopySourceId(movingNode.id, null)
    },
    onCommitRequested: ({ nodeUpdate, surface }) => {
      const sourceNode = useRobotCopyPreview ? robotCopySourceNode : movingNode
      const sourceId = sourceNode?.id ?? null
      if (!(sourceNode && sourceId) || surface !== 'floor' || !nodeUpdate.position) return true

      const finalRotation =
        nodeUpdate.rotation ??
        draftNode.current?.rotation ??
        ([...sourceNode.rotation] as [number, number, number])
      const draft = draftNode.current
      navigationVisualsStore
        .getState()
        .setItemMoveVisualState(sourceId, useRobotCopyPreview ? 'copy-source-pending' : 'source-pending')
      setDraftVisualState(draftNode, 'destination-ghost')
      setDraftVisibility(draftNode, true)
      setPreviewOutlineIds(draft ? [draft.id] : [])
      syncDraftTransform(draftNode, {
        position: nodeUpdate.position,
        rotationY: finalRotation[1] ?? 0,
      })
      handoffCommittedRef.current = true
      setHandoffCommitted(true)

      requestItemMove({
        finalUpdate: { ...nodeUpdate, rotation: [...finalRotation] as [number, number, number] },
        itemDimensions: getScaledDimensions(sourceNode),
        itemId: sourceId,
        levelId: sourceNode.parentId,
        sourcePosition: [...sourceNode.position] as [number, number, number],
        sourceRotation: [...sourceNode.rotation] as [number, number, number],
        targetPreviewItemId: draft?.id ?? null,
        visualItemId: useRobotCopyPreview ? (draft?.id ?? null) : sourceId,
      })
      detachedTaskRef.current = true
      setItemMoveLocked(false)
      if (isNew) setNavigationDraftRobotCopySourceId(movingNode.id, null)
      useEditor.getState().setMovingNode(null)
      return false
    },
    onCommitted: () => {
      handoffCommittedRef.current = false
      setHandoffCommitted(false)
      requestItemMove(null)
      setItemMoveLocked(false)
      if (isNew) setNavigationDraftRobotCopySourceId(movingNode.id, null)
    },
    preserveDraftOnUnmount: () => detachedTaskRef.current,
    surfaceMode: 'floor-only' as const,
  }
}

registerItemActionHandlers({
  decorateDuplicate(source, duplicateInfo) {
    if (!(useNavigation.getState().enabled && useNavigation.getState().moveItemsEnabled)) return
    if (!canUseRobotItemTask(source)) return
    const metadata =
      typeof duplicateInfo.metadata === 'object' && duplicateInfo.metadata !== null
        ? (duplicateInfo.metadata as Record<string, unknown>)
        : {}
    duplicateInfo.metadata = { ...metadata, robotCopySourceId: source.id }
  },
  onDelete: requestNavigationItemDelete,
  onDuplicateDraft(source, draft) {
    const sourceId = getNavigationDraftRobotCopySourceIdFromNode(draft) ?? source.id
    if (sourceId) setNavigationDraftRobotCopySourceId(draft.id, sourceId)
  },
  onRepair: requestNavigationItemRepair,
})

registerItemMoveExtension(useRobotItemMoveExtension)
