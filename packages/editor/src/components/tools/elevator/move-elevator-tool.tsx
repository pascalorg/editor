import {
  type AnyNodeId,
  type BuildingNode,
  type ElevatorNode,
  ElevatorNode as ElevatorNodeSchema,
  emitter,
  type GridEvent,
  type LevelNode,
  pauseSceneHistory,
  resumeSceneHistory,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { resolveElevatorSupportY } from '../../../lib/elevator-support'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

function stripMoveMetadata(metadata: ElevatorNode['metadata']) {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return metadata
  }

  const nextMeta = { ...(metadata as Record<string, unknown>) }
  delete nextMeta.isNew
  delete nextMeta.isTransient
  return nextMeta as ElevatorNode['metadata']
}

export function MoveElevatorTool({
  node: movingNode,
  onCommitted,
}: {
  node: ElevatorNode
  onCommitted?: (nodeId: AnyNodeId) => void
}) {
  const onCommittedRef = useRef(onCommitted)
  const historyPausedRef = useRef(false)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const previewPositionRef = useRef<ElevatorNode['position']>([
    movingNode.position[0],
    movingNode.position[1],
    movingNode.position[2],
  ])
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>(() => [
    movingNode.position[0],
    movingNode.position[1],
    movingNode.position[2],
  ])

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    onCommittedRef.current = onCommitted
  }, [onCommitted])

  useEffect(() => {
    const pauseHistory = () => {
      const temporal = useScene.temporal.getState()
      if (historyPausedRef.current || !temporal.isTracking) return
      pauseSceneHistory(useScene)
      historyPausedRef.current = true
    }
    const resumeHistory = () => {
      if (!historyPausedRef.current) return
      resumeSceneHistory(useScene)
      historyPausedRef.current = false
    }

    pauseHistory()
    const movingNodeId = (movingNode as { id?: ElevatorNode['id'] }).id

    const meta =
      typeof movingNode.metadata === 'object' && movingNode.metadata !== null
        ? (movingNode.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew
    const committedMeta = stripMoveMetadata(movingNode.metadata)
    const original = {
      position: [...movingNode.position] as ElevatorNode['position'],
      rotation: movingNode.rotation,
      metadata: movingNode.metadata,
    }

    let wasCommitted = false
    let wasCancelled = false
    let pendingRotation = movingNode.rotation
    const supportBuildingId = movingNode.parentId as BuildingNode['id'] | null | undefined
    const supportLevelId = (movingNode.fromLevelId ?? movingNode.defaultLevelId) as
      | LevelNode['id']
      | null

    const applyPreview = (
      position: ElevatorNode['position'],
      rotation: ElevatorNode['rotation'],
    ) => {
      if (movingNodeId) {
        useLiveTransforms.getState().set(movingNodeId, { position, rotation })
      }

      const object = movingNodeId ? sceneRegistry.nodes.get(movingNodeId) : null
      if (object) {
        object.position.set(position[0], position[1], position[2])
        object.rotation.y = rotation
      }
    }

    const resetObject = (
      position: ElevatorNode['position'],
      rotation: ElevatorNode['rotation'],
    ) => {
      const object = movingNodeId ? sceneRegistry.nodes.get(movingNodeId) : null
      if (object) {
        object.position.set(position[0], position[1], position[2])
        object.rotation.y = rotation
      }
    }

    const clearPreview = () => {
      if (movingNodeId) {
        useLiveTransforms.getState().clear(movingNodeId)
      }
    }

    const onGridMove = (event: GridEvent) => {
      const gridX = Math.round(event.localPosition[0] * 2) / 2
      const gridZ = Math.round(event.localPosition[2] * 2) / 2
      const supportY = resolveElevatorSupportY({
        buildingId: supportBuildingId,
        preferredLevelId: supportLevelId,
        x: gridX,
        z: gridZ,
      })

      if (
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
      setCursorPosition([gridX, supportY, gridZ])
      previewPositionRef.current = [gridX, supportY, gridZ]
      applyPreview(previewPositionRef.current, pendingRotation)
    }

    const onGridClick = (event: GridEvent) => {
      const gridX = Math.round(event.localPosition[0] * 2) / 2
      const gridZ = Math.round(event.localPosition[2] * 2) / 2
      const supportY = resolveElevatorSupportY({
        buildingId: supportBuildingId,
        preferredLevelId: supportLevelId,
        x: gridX,
        z: gridZ,
      })
      const nextPosition: ElevatorNode['position'] = [gridX, supportY, gridZ]

      wasCommitted = true
      clearPreview()
      resumeHistory()
      if (movingNodeId && useScene.getState().nodes[movingNodeId as AnyNodeId]) {
        useScene.getState().updateNode(movingNodeId as AnyNodeId, {
          position: nextPosition,
          rotation: pendingRotation,
          metadata: committedMeta,
        })
        onCommittedRef.current?.(movingNodeId as AnyNodeId)
      } else if (movingNode.parentId) {
        const elevator = ElevatorNodeSchema.parse({
          ...movingNode,
          id: undefined,
          position: nextPosition,
          rotation: pendingRotation,
          metadata: committedMeta,
        })
        useScene.getState().createNode(elevator, movingNode.parentId as AnyNodeId)
        onCommittedRef.current?.(elevator.id as AnyNodeId)
      }

      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      wasCancelled = true
      clearPreview()
      if (isNew && movingNodeId) {
        useScene.getState().deleteNode(movingNodeId as AnyNodeId)
      } else {
        if (movingNodeId) {
          useScene.getState().updateNode(movingNodeId as AnyNodeId, {
            position: original.position,
            rotation: original.rotation,
            metadata: original.metadata,
          })
        }
      }
      resetObject(original.position, original.rotation)
      resumeHistory()
      markToolCancelConsumed()
      exitMoveMode()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        sfxEmitter.emit('sfx:item-rotate')
        pendingRotation += rotationDelta
        applyPreview(previewPositionRef.current, pendingRotation)
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      clearPreview()
      if (!(wasCommitted || wasCancelled || isNew) && movingNodeId) {
        useScene.getState().updateNode(movingNodeId as AnyNodeId, {
          position: original.position,
          rotation: original.rotation,
          metadata: original.metadata,
        })
        resetObject(original.position, original.rotation)
      }
      resumeHistory()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [movingNode, exitMoveMode])

  return <CursorSphere position={cursorPosition} showTooltip={false} />
}
