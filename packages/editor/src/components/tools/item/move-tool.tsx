import {
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type DoorNode,
  type FenceNode,
  type getItemMoveVisualState,
  getScaledDimensions,
  type ItemNode,
  type RoofNode,
  type RoofSegmentNode,
  type SlabNode,
  type StairNode,
  type StairSegmentNode,
  sceneRegistry,
  setItemMoveVisualState,
  useLiveTransforms,
  useScene,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import useNavigation from '../../../store/use-navigation'
import {
  getNavigationDraftRobotCopySourceId,
  setNavigationDraftRobotCopySourceId,
} from '../../../store/use-navigation-drafts'
import navigationVisualsStore from '../../../store/use-navigation-visuals'
import { MoveBuildingContent } from '../building/move-building-tool'
import { MoveCeilingTool } from '../ceiling/move-ceiling-tool'
import { MoveDoorTool } from '../door/move-door-tool'
import { MoveFenceTool } from '../fence/move-fence-tool'
import { MoveRoofTool } from '../roof/move-roof-tool'
import { MoveSlabTool } from '../slab/move-slab-tool'
import { MoveWallTool } from '../wall/move-wall-tool'
import { MoveWindowTool } from '../window/move-window-tool'
import { stripTransient } from './placement-math'
import type { PlacementState } from './placement-types'
import { type DraftNodeHandle, useDraftNode } from './use-draft-node'
import { usePlacementCoordinator } from './use-placement-coordinator'

function canUseRobotCarryMove(node: ItemNode) {
  if (node.asset.attachTo) {
    return false
  }

  const parentNode = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : null
  return parentNode?.type !== 'item'
}

function haveSameIds(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false
  }

  return a.every((id, index) => id === b[index])
}

let robotTaskPreviewNodeSequence = 0

function createRobotTaskPreviewNodeId(kind: 'copy' | 'move', sourceId: string): ItemNode['id'] {
  robotTaskPreviewNodeSequence += 1
  const timestamp = Math.round(performance.now())
  return `item_debug_${kind}_preview_${sourceId}_${timestamp}_${robotTaskPreviewNodeSequence}` as ItemNode['id']
}

function setDraftVisibility(draftNode: DraftNodeHandle, visible: boolean) {
  const draft = draftNode.current
  if (!draft || draft.visible === visible) {
    return
  }

  draft.visible = visible
  navigationVisualsStore.getState().setNodeVisibilityOverride(draft.id, visible)

  const previewMesh = sceneRegistry.nodes.get(draft.id)
  if (previewMesh) {
    previewMesh.visible = visible
  }
}

function setDraftVisualState(
  draftNode: DraftNodeHandle,
  state: ReturnType<typeof getItemMoveVisualState>,
) {
  const draft = draftNode.current
  if (!draft) {
    return
  }

  navigationVisualsStore.getState().setItemMoveVisualState(draft.id, state)
}

function syncDraftTransform(
  draftNode: DraftNodeHandle,
  transform: { position?: [number, number, number]; rotationY?: number | null },
) {
  const draft = draftNode.current
  if (!draft) {
    return
  }

  if (transform.position) {
    draft.position = [...transform.position] as [number, number, number]
  }

  if (typeof transform.rotationY === 'number') {
    draft.rotation = [draft.rotation[0] ?? 0, transform.rotationY, draft.rotation[2] ?? 0] as [
      number,
      number,
      number,
    ]
  }

  const position = transform.position ?? draft.position
  const rotationY = transform.rotationY ?? draft.rotation[1] ?? 0

  useLiveTransforms.getState().set(draft.id, {
    position,
    rotation: rotationY,
  })

  const draftObject = sceneRegistry.nodes.get(draft.id)
  if (draftObject) {
    draftObject.position.set(position[0], position[1], position[2])
    draftObject.rotation.y = rotationY
    draftObject.updateMatrixWorld(true)
  }
}

function setItemVisualState(
  itemId: ItemNode['id'],
  state: ReturnType<typeof getItemMoveVisualState>,
) {
  navigationVisualsStore.getState().setItemMoveVisualState(itemId, state)
}

function setPreviewOutlineIds(ids: string[]) {
  const currentIds = useViewer.getState().previewSelectedIds
  if (haveSameIds(currentIds, ids)) {
    return
  }

  useViewer.getState().setPreviewSelectedIds(ids)
}

function getInitialState(node: {
  asset: { attachTo?: string }
  parentId: string | null
}): PlacementState {
  const attachTo = node.asset.attachTo
  if (attachTo === 'wall' || attachTo === 'wall-side') {
    return { surface: 'wall', wallId: node.parentId, ceilingId: null, surfaceItemId: null }
  }
  if (attachTo === 'ceiling') {
    return { surface: 'ceiling', wallId: null, ceilingId: node.parentId, surfaceItemId: null }
  }
  return { surface: 'floor', wallId: null, ceilingId: null, surfaceItemId: null }
}

function MoveItemContent({ movingNode }: { movingNode: ItemNode }) {
  const draftNode = useDraftNode()
  const {
    enabled,
    itemMoveLocked,
    moveItemsEnabled,
    registerItemMoveController,
    requestItemMove,
    robotMode,
    setItemMoveLocked,
  } = useNavigation(
    useShallow((state) => ({
      enabled: state.enabled,
      itemMoveLocked: state.itemMoveLocked,
      moveItemsEnabled: state.moveItemsEnabled,
      registerItemMoveController: state.registerItemMoveController,
      requestItemMove: state.requestItemMove,
      robotMode: state.robotMode,
      setItemMoveLocked: state.setItemMoveLocked,
    })),
  )

  const meta =
    typeof movingNode.metadata === 'object' && movingNode.metadata !== null
      ? (movingNode.metadata as Record<string, unknown>)
      : {}
  const sceneBackedMovingNode = useScene((state) => {
    const node = state.nodes[movingNode.id as AnyNodeId]
    return node?.type === 'item' ? (node as ItemNode) : null
  })
  const isSceneBackedItem = sceneBackedMovingNode !== null
  const isNew = !isSceneBackedItem && !!meta.isNew
  const robotCopySourceId = !isSceneBackedItem
    ? getNavigationDraftRobotCopySourceId(movingNode.id)
    : null
  const robotCopySourceNode = useScene((state) => {
    const node = robotCopySourceId ? state.nodes[robotCopySourceId as AnyNodeId] : null
    return node?.type === 'item' ? (node as ItemNode) : null
  })
  const pendingSourceTransformClearFrameRef = useRef<number | null>(null)
  const pendingSourceTransformClearFollowupFrameRef = useRef<number | null>(null)
  const detachedTaskRef = useRef(false)
  const handoffCommittedRef = useRef(false)
  const [handoffCommitted, setHandoffCommitted] = useState(false)
  const useRobotCarryPreview =
    !isNew && enabled && moveItemsEnabled && canUseRobotCarryMove(movingNode)
  const useRobotCopyPreview =
    isNew &&
    enabled &&
    moveItemsEnabled &&
    robotCopySourceNode !== null &&
    canUseRobotCarryMove(robotCopySourceNode)
  const useRobotItemPreview = useRobotCarryPreview || useRobotCopyPreview
  const robotPreviewSourceId = isNew ? robotCopySourceId : movingNode.id
  const cancelPendingSourceTransformClear = useCallback(() => {
    if (pendingSourceTransformClearFrameRef.current !== null) {
      cancelAnimationFrame(pendingSourceTransformClearFrameRef.current)
      pendingSourceTransformClearFrameRef.current = null
    }

    if (pendingSourceTransformClearFollowupFrameRef.current !== null) {
      cancelAnimationFrame(pendingSourceTransformClearFollowupFrameRef.current)
      pendingSourceTransformClearFollowupFrameRef.current = null
    }
  }, [])
  const scheduleSourceTransformClear = useCallback(
    (transform: { position: [number, number, number]; rotation: number } | null) => {
      cancelPendingSourceTransformClear()

      if (transform) {
        useLiveTransforms.getState().set(movingNode.id, transform)
      }

      pendingSourceTransformClearFrameRef.current = requestAnimationFrame(() => {
        pendingSourceTransformClearFrameRef.current = null
        pendingSourceTransformClearFollowupFrameRef.current = requestAnimationFrame(() => {
          pendingSourceTransformClearFollowupFrameRef.current = null
          useLiveTransforms.getState().clear(movingNode.id)
        })
      })
    },
    [cancelPendingSourceTransformClear, movingNode.id],
  )
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

      const draft = draftNode.current
      const draftId = previewDraftId ?? draft?.id ?? null
      const navigationVisuals = navigationVisualsStore.getState()
      const activePreview = navigationVisuals.itemMovePreview
      if (
        activePreview &&
        (activePreview.sourceItemId === robotPreviewSourceId || activePreview.id === draftId)
      ) {
        navigationVisuals.setItemMovePreview(null)
      }

      if (robotPreviewSourceId) {
        setItemVisualState(robotPreviewSourceId, null)
        navigationVisuals.setNodeVisibilityOverride(robotPreviewSourceId, null)
        if (!preserveSourceLiveTransform && !isNew) {
          useLiveTransforms.getState().clear(robotPreviewSourceId)
        }
      }

      if (draft) {
        setDraftVisualState(draftNode, null)
      }
      if (draftId) {
        navigationVisuals.unregisterTaskPreviewNode(draftId)
        navigationVisuals.setNodeVisibilityOverride(draftId, null)
        navigationVisuals.setItemMoveVisualState(draftId, null)
        useLiveTransforms.getState().clear(draftId)
      }
    },
    [cancelPendingSourceTransformClear, draftNode, isNew, robotPreviewSourceId],
  )

  useEffect(() => {
    if (!sceneBackedMovingNode || !Object.hasOwn(meta, 'isNew')) {
      return
    }

    useScene.getState().updateNode(sceneBackedMovingNode.id as AnyNodeId, {
      metadata: stripTransient(sceneBackedMovingNode.metadata) as ItemNode['metadata'],
    })
  }, [meta, sceneBackedMovingNode])

  useEffect(() => {
    useViewer.getState().setNodeEventsSuppressed(useRobotItemPreview)

    return () => {
      useViewer.getState().setNodeEventsSuppressed(false)
    }
  }, [useRobotItemPreview])

  useEffect(() => {
    if (useRobotItemPreview) {
      return
    }

    if (detachedTaskRef.current) {
      return
    }

    clearRobotPreviewState()
  }, [clearRobotPreviewState, useRobotItemPreview])

  useEffect(() => {
    const previewSourceNode = useRobotCopyPreview ? robotCopySourceNode : movingNode
    if (!(useRobotItemPreview && previewSourceNode && robotPreviewSourceId)) {
      if (robotPreviewSourceId) {
        registerItemMoveController(robotPreviewSourceId, null)
      }
      return
    }

    cancelPendingSourceTransformClear()
    registerItemMoveController(robotPreviewSourceId, {
      itemId: robotPreviewSourceId,
      beginCarry: () => {
        if (useRobotCarryPreview) {
          setItemVisualState(previewSourceNode.id, 'carried')
          return
        }

        if (useRobotCopyPreview) {
          const draft = draftNode.current
          if (!draft) {
            return
          }

          setDraftVisualState(draftNode, 'carried')
          useLiveTransforms.getState().set(draft.id, {
            position: [...previewSourceNode.position] as [number, number, number],
            rotation: previewSourceNode.rotation[1] ?? 0,
          })
        }
      },
      cancel: () => {
        clearRobotPreviewState()
        draftNode.destroy()
        registerItemMoveController(robotPreviewSourceId, null)
        setItemMoveLocked(false)
        if (isNew) {
          setNavigationDraftRobotCopySourceId(movingNode.id, null)
        }
        useEditor.getState().setMovingNode(null)
      },
      commit: (finalUpdate, finalCarryTransform) => {
        const previewDraftId = draftNode.current?.id ?? null
        const sourceNode = useScene.getState().nodes[previewSourceNode.id as AnyNodeId]
        const sourceMetadata =
          sourceNode?.type === 'item' ? sourceNode.metadata : previewSourceNode.metadata

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
        const committedId = draftNode.commit({
          ...finalUpdate,
          metadata: setItemMoveVisualState(
            stripTransient(sourceMetadata),
            null,
          ) as ItemNode['metadata'],
          visible: true,
        })
        clearRobotPreviewState({
          preserveSourceLiveTransform: useRobotCarryPreview,
          previewDraftId,
        })
        if (useRobotCarryPreview) {
          scheduleSourceTransformClear(committedSourceTransform)
        }
        if (committedId) {
          sfxEmitter.emit('sfx:item-place')
        }

        registerItemMoveController(robotPreviewSourceId, null)
        setItemMoveLocked(false)
        useEditor.getState().setMovingNode(null)
      },
      updateCarryTransform: (position, rotationY) => {
        if (useRobotCarryPreview) {
          useLiveTransforms.getState().set(movingNode.id, {
            position,
            rotation: rotationY,
          })
        } else if (useRobotCopyPreview) {
          const draftId = draftNode.current?.id
          if (draftId) {
            useLiveTransforms.getState().set(draftId, {
              position,
              rotation: rotationY,
            })
          }
        }
      },
    })

    return () => {
      cancelPendingSourceTransformClear()
      if (detachedTaskRef.current) {
        return
      }
      registerItemMoveController(robotPreviewSourceId, null)
    }
  }, [
    cancelPendingSourceTransformClear,
    draftNode,
    clearRobotPreviewState,
    isNew,
    movingNode,
    registerItemMoveController,
    robotCopySourceNode,
    robotPreviewSourceId,
    scheduleSourceTransformClear,
    setItemMoveLocked,
    useRobotCarryPreview,
    useRobotCopyPreview,
    useRobotItemPreview,
  ])

  useEffect(() => {
    return () => {
      cancelPendingSourceTransformClear()
    }
  }, [cancelPendingSourceTransformClear])

  const cursor = usePlacementCoordinator({
    asset: movingNode.asset,
    defaultScale: isNew ? movingNode.scale : undefined,
    disabled: itemMoveLocked || handoffCommitted,
    isDisabled: () => itemMoveLocked || handoffCommittedRef.current,
    draftNode,
    ignoreItemIds:
      useRobotCopyPreview && robotCopySourceId
        ? [robotCopySourceId]
        : isNew
          ? undefined
          : [movingNode.id],
    initDraft: (gridPosition) => {
      if (isNew) {
        // Duplicate: use the same create() path as ItemTool so ghost rendering works correctly.
        // Floor items get a draft immediately; wall/ceiling items are created lazily on surface entry.
        gridPosition.copy(new Vector3(...movingNode.position))
        if (!movingNode.asset.attachTo) {
          draftNode.create(
            gridPosition,
            movingNode.asset,
            movingNode.rotation,
            movingNode.scale,
            useRobotCopyPreview && robotCopySourceId
              ? { id: createRobotTaskPreviewNodeId('copy', robotCopySourceId) }
              : undefined,
          )
          if (useRobotCopyPreview && robotCopySourceId) {
            setDraftVisualState(draftNode, 'destination-preview')
            setDraftVisibility(draftNode, true)
            setItemVisualState(robotCopySourceId, 'copy-source-pending')
            const draftId = draftNode.current?.id
            setPreviewOutlineIds(draftId ? [draftId] : [])
          }
        }
        return
      }

      if (useRobotCarryPreview) {
        const draft = draftNode.preview(movingNode, {
          id: createRobotTaskPreviewNodeId('move', movingNode.id),
        })
        if (draft) {
          useLiveTransforms.getState().set(draft.id, {
            position: [...movingNode.position] as [number, number, number],
            rotation: movingNode.rotation[1] ?? 0,
          })
          setDraftVisualState(draftNode, 'destination-preview')
          setDraftVisibility(draftNode, true)
          setItemVisualState(movingNode.id, 'source-pending')
          setPreviewOutlineIds([draft.id])
          navigationVisualsStore.getState().setItemMovePreview({
            id: draft.id,
            sourceItemId: movingNode.id,
          })
        }
        gridPosition.copy(new Vector3(...movingNode.position))
        return
      }

      draftNode.adopt(movingNode)
      gridPosition.copy(new Vector3(...movingNode.position))
    },
    initialState: isNew
      ? { surface: 'floor', wallId: null, ceilingId: null, surfaceItemId: null }
      : getInitialState(movingNode),
    preserveDraftOnUnmount: () => detachedTaskRef.current,
    surfaceMode: useRobotItemPreview ? 'floor-only' : 'all',
    onCommitRequested: useRobotItemPreview
      ? ({ nodeUpdate, surface }) => {
          const requestSourceNode = useRobotCopyPreview ? robotCopySourceNode : movingNode
          const requestSourceId = requestSourceNode?.id ?? null
          if (!(requestSourceNode && requestSourceId)) {
            return false
          }

          if (surface !== 'floor' || !nodeUpdate.position) {
            return false
          }

          const finalRotation =
            nodeUpdate.rotation ??
            draftNode.current?.rotation ??
            ([...requestSourceNode.rotation] as [number, number, number])
          const draft = draftNode.current
          if (draft) {
            const previewMetadata = stripTransient(draft.metadata) as ItemNode['metadata']
            draft.metadata = previewMetadata
            useScene.getState().updateNode(draft.id as AnyNodeId, {
              metadata: previewMetadata,
            })
            navigationVisualsStore.getState().registerTaskPreviewNode(draft.id)
          }

          setItemVisualState(
            requestSourceId,
            useRobotCopyPreview ? 'copy-source-pending' : 'source-pending',
          )
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
            finalUpdate: {
              ...nodeUpdate,
              rotation: [...finalRotation] as [number, number, number],
            },
            itemDimensions: getScaledDimensions(requestSourceNode),
            itemId: requestSourceId,
            levelId: requestSourceNode.parentId,
            sourcePosition: [...requestSourceNode.position] as [number, number, number],
            sourceRotation: [...requestSourceNode.rotation] as [number, number, number],
            targetPreviewItemId: draft?.id ?? null,
            visualItemId: useRobotCopyPreview ? (draft?.id ?? null) : requestSourceId,
          })
          setItemVisualState(requestSourceId, null)
          detachedTaskRef.current = true
          setItemMoveLocked(false)
          useEditor.getState().setMovingNode(null)
          return false
        }
      : undefined,
    onCommitted: () => {
      sfxEmitter.emit('sfx:item-place')
      handoffCommittedRef.current = false
      setHandoffCommitted(false)
      if (robotMode !== 'task') {
        requestItemMove(null)
      }
      setItemMoveLocked(false)
      if (isNew) {
        setNavigationDraftRobotCopySourceId(movingNode.id, null)
      }
      useEditor.getState().setMovingNode(null)
      return false
    },
    onCancel: () => {
      detachedTaskRef.current = false
      handoffCommittedRef.current = false
      setHandoffCommitted(false)
      clearRobotPreviewState()
      draftNode.destroy()
      if (robotPreviewSourceId) {
        registerItemMoveController(robotPreviewSourceId, null)
      }
      if (robotMode !== 'task') {
        requestItemMove(null)
      }
      setItemMoveLocked(false)
      if (isNew) {
        setNavigationDraftRobotCopySourceId(movingNode.id, null)
      }
      useEditor.getState().setMovingNode(null)
    },
  })

  return <>{cursor}</>
}

export const MoveTool: React.FC = () => {
  const movingNode = useEditor((state) => state.movingNode)

  if (!movingNode) return null
  if (movingNode.type === 'building')
    return <MoveBuildingContent node={movingNode as BuildingNode} />
  if (movingNode.type === 'door') return <MoveDoorTool node={movingNode as DoorNode} />
  if (movingNode.type === 'window') return <MoveWindowTool node={movingNode as WindowNode} />
  if (movingNode.type === 'fence') return <MoveFenceTool node={movingNode as FenceNode} />
  if (movingNode.type === 'ceiling') return <MoveCeilingTool node={movingNode as CeilingNode} />
  if (movingNode.type === 'slab') return <MoveSlabTool node={movingNode as SlabNode} />
  if (movingNode.type === 'wall') return <MoveWallTool node={movingNode as WallNode} />
  if (movingNode.type === 'roof' || movingNode.type === 'roof-segment')
    return <MoveRoofTool node={movingNode as RoofNode | RoofSegmentNode} />
  if (movingNode.type === 'stair' || movingNode.type === 'stair-segment')
    return <MoveRoofTool node={movingNode as StairNode | StairSegmentNode} />
  return <MoveItemContent movingNode={movingNode as ItemNode} />
}
