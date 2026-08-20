import {
  type AnyNodeId,
  type BlockTopology,
  type SceneApi,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import {
  isGridSnapActive,
  meshEditScope,
  swallowNextClick,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from 'react'
import type { Camera, Object3D } from 'three'
import { Vector2 } from 'three'
import { applyBlockCommand, type BlockCommand, type BlockSelection } from './commands'
import type { BlockSfxAction } from './interaction-sfx'
import {
  type BlockModalFaceOperation,
  blockFaceOperationCommand,
  blockFaceOperationValueFromPointer,
} from './modal-face-operation'
import { beginBlockModalSession } from './modal-session'
import {
  type BlockModalFeedbackMode,
  blockAccumulatePrecisionPointer,
  blockPrecisionSnapStep,
  blockTransformNumericInputFromKey,
  blockTransformNumericValue,
} from './modal-transform'
import { blockLocalPointToClient, blockSelectionCentroid } from './selection-geometry'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export type UseBlockFaceOperationOptions = {
  camera: Camera
  cancelRef: MutableRefObject<(() => void) | null>
  canvas: HTMLCanvasElement
  closeToolbar: () => void
  commit: (baseTopology: BlockTopology, command: BlockCommand, label: string) => boolean
  displayTopology: BlockTopology
  extent: number
  lastPointerClientRef: MutableRefObject<Vector2 | null>
  mode: BlockSelection['mode']
  nodeId: AnyNodeId
  ownsEditSession: () => boolean
  playSfx: (action: BlockSfxAction) => void
  sceneApi: Pick<SceneApi, 'markDirty'>
  selectedIds: string[]
  selection: BlockSelection
  setActiveFaceOperation: StateSetter<BlockModalFaceOperation | null>
  setError: StateSetter<string | null>
  setFaceOperationValue: StateSetter<string>
  setModalFeedbackMode: StateSetter<BlockModalFeedbackMode>
  setPreviewTopology: StateSetter<BlockTopology | null>
  setTransformNumericInput: StateSetter<string>
  target: Object3D
}

export function useBlockFaceOperation({
  camera,
  cancelRef,
  canvas,
  closeToolbar,
  commit,
  displayTopology,
  extent,
  lastPointerClientRef,
  mode,
  nodeId,
  ownsEditSession,
  playSfx,
  sceneApi,
  selectedIds,
  selection,
  setActiveFaceOperation,
  setError,
  setFaceOperationValue,
  setModalFeedbackMode,
  setPreviewTopology,
  setTransformNumericInput,
  target,
}: UseBlockFaceOperationOptions) {
  return useCallback(
    (operation: BlockModalFaceOperation) => {
      if (!ownsEditSession() || mode !== 'face' || selectedIds.length === 0 || cancelRef.current) {
        return false
      }
      const faceIds = [...selectedIds]
      if (faceIds.some((id) => !displayTopology.faces.some((face) => face.id === id))) return false
      const origin = blockSelectionCentroid(displayTopology, selection)
      if (!origin) return false
      const pivotClient = blockLocalPointToClient(origin, target, camera, canvas)
      if (!pivotClient) return false

      const startPointer =
        lastPointerClientRef.current?.clone() ?? pivotClient.clone().add(new Vector2(80, 0))
      const baseTopology = displayTopology
      let latestTopology: BlockTopology | null = null
      let latestSelection: BlockSelection | null = null
      let latestValue = 0
      let typedInput = ''
      let lastClientX = startPointer.x
      let lastClientY = startPointer.y
      let lastAltKey = false
      let lastShiftKey = false
      let lastSnapValue: number | null = null
      let effectivePointer = { x: startPointer.x, y: startPointer.y }
      let previousRawPointer = { ...effectivePointer }

      const updatePreview = (
        clientX: number,
        clientY: number,
        altKey: boolean,
        precision: boolean,
      ) => {
        lastClientX = clientX
        lastClientY = clientY
        lastAltKey = altKey
        lastShiftKey = precision
        const typedValue = blockTransformNumericValue(
          typedInput,
          operation === 'extrude' ? 'translate' : 'scale',
        )
        let value =
          typedValue ??
          blockFaceOperationValueFromPointer(
            operation,
            clientX - startPointer.x,
            clientY - startPointer.y,
            extent,
          )
        const snapping =
          operation === 'extrude' && typedValue === null && isGridSnapActive() && !altKey
        if (snapping) {
          const step = blockPrecisionSnapStep(useEditor.getState().gridSnapStep, precision)
          if (step > 0) value = Math.round(value / step) * step
        }
        setFaceOperationValue(typedInput || String(Math.round(value * 1000) / 1000))
        setModalFeedbackMode(
          typedInput ? 'exact' : precision ? 'precision' : snapping ? 'grid' : 'free',
        )
        if (Math.abs(value) <= 1e-6) {
          latestTopology = null
          latestSelection = null
          latestValue = 0
          setPreviewTopology(null)
          useLiveNodeOverrides.getState().clear(nodeId)
          sceneApi.markDirty(nodeId)
          return
        }
        if (snapping && value !== lastSnapValue) {
          lastSnapValue = value
          playSfx('move-step')
        } else if (!snapping) {
          lastSnapValue = null
        }
        const result = applyBlockCommand(
          baseTopology,
          blockFaceOperationCommand(operation, faceIds, value),
        )
        if (!result.ok) {
          setError(result.error)
          return
        }
        latestTopology = result.topology
        latestSelection = result.selection
        latestValue = value
        setPreviewTopology(result.topology)
        useLiveNodeOverrides.getState().set(nodeId, { topology: result.topology })
        sceneApi.markDirty(nodeId)
        setError(null)
      }

      const complete = (commitOperation: boolean) => {
        useLiveNodeOverrides.getState().clear(nodeId)
        sceneApi.markDirty(nodeId)
        setPreviewTopology(null)
        setActiveFaceOperation(null)
        setFaceOperationValue('')
        setTransformNumericInput('')
        setModalFeedbackMode('free')
        if (commitOperation && latestTopology && latestSelection && Math.abs(latestValue) > 1e-6) {
          commit(
            baseTopology,
            blockFaceOperationCommand(operation, faceIds, latestValue),
            operation === 'extrude' ? 'Extrude' : 'Inset',
          )
          playSfx('operation-commit')
        } else if (!commitOperation) {
          playSfx('cancel')
        }
        if (ownsEditSession()) useInteractionScope.getState().begin(meshEditScope(nodeId))
        swallowNextClick()
      }

      const onMove = (pointerEvent: PointerEvent) => {
        lastPointerClientRef.current = new Vector2(pointerEvent.clientX, pointerEvent.clientY)
        effectivePointer = blockAccumulatePrecisionPointer(
          effectivePointer,
          previousRawPointer,
          pointerEvent,
          pointerEvent.shiftKey,
        )
        previousRawPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
        updatePreview(
          effectivePointer.x,
          effectivePointer.y,
          pointerEvent.altKey,
          pointerEvent.shiftKey,
        )
      }
      const onPointerDown = (pointerEvent: PointerEvent, finish: (commit: boolean) => void) => {
        if (pointerEvent.button !== 0 && pointerEvent.button !== 2) return
        pointerEvent.preventDefault()
        pointerEvent.stopImmediatePropagation()
        finish(pointerEvent.button === 0)
      }
      const onKeyDown = (keyboardEvent: KeyboardEvent, finish: (commit: boolean) => void) => {
        const element = keyboardEvent.target as HTMLElement | null
        if (
          element?.tagName === 'INPUT' ||
          element?.tagName === 'TEXTAREA' ||
          element?.isContentEditable
        ) {
          return
        }
        const nextInput = blockTransformNumericInputFromKey(typedInput, keyboardEvent.key)
        if (nextInput !== null) {
          keyboardEvent.preventDefault()
          keyboardEvent.stopImmediatePropagation()
          typedInput = nextInput
          setTransformNumericInput(nextInput)
          updatePreview(lastClientX, lastClientY, lastAltKey, lastShiftKey)
        } else if (keyboardEvent.key === 'Enter') {
          keyboardEvent.preventDefault()
          keyboardEvent.stopImmediatePropagation()
          finish(true)
        } else if (keyboardEvent.key === 'Escape') {
          keyboardEvent.preventDefault()
          keyboardEvent.stopImmediatePropagation()
          finish(false)
        }
      }

      useInteractionScope.getState().begin(meshEditScope(nodeId, 'operating', operation))
      playSfx('operation-start')
      closeToolbar()
      setActiveFaceOperation(operation)
      setFaceOperationValue('0')
      setTransformNumericInput('')
      setModalFeedbackMode('free')
      setError(null)
      beginBlockModalSession({
        cancelRef,
        cursor: operation === 'extrude' ? 'ns-resize' : 'nwse-resize',
        onFinish: complete,
        onKeyDown,
        onPointerDown,
        onPointerMove: onMove,
      })
      return true
    },
    [
      camera,
      cancelRef,
      canvas,
      closeToolbar,
      commit,
      displayTopology,
      extent,
      lastPointerClientRef,
      mode,
      nodeId,
      ownsEditSession,
      playSfx,
      sceneApi,
      selectedIds,
      selection,
      setActiveFaceOperation,
      setError,
      setFaceOperationValue,
      setModalFeedbackMode,
      setPreviewTopology,
      setTransformNumericInput,
      target,
    ],
  )
}
