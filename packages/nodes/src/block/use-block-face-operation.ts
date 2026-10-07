import type { AnyNodeId, BlockTopology, SceneApi } from '@pascal-app/core'
import {
  isGridSnapActive,
  meshEditScope,
  type SelectionAffordanceProps,
  swallowNextClick,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useMemo,
} from 'react'
import type { Camera, Object3D } from 'three'
import { Vector2, Vector3 } from 'three'
import {
  applyBlockCommand,
  type BlockCommand,
  type BlockSelection,
  blockFaceNormal,
} from './commands'
import { BLOCK_SUPPORT_REFUSAL, createBlockTopologyPreview } from './hosted-edit'
import type { BlockSfxAction } from './interaction-sfx'
import {
  type BlockExtrudeAxis,
  type BlockModalFaceOperation,
  blockFaceOperationCommand,
  blockFaceOperationValueFromPointer,
} from './modal-face-operation'
import { beginBlockModalSession } from './modal-session'
import {
  type BlockModalFeedbackMode,
  blockPointerDistanceForAxis,
  blockTransformAxisFromKey,
  blockTransformNumericInputFromKey,
  blockTransformNumericValue,
} from './modal-transform'
import {
  blockLocalPointToClient,
  blockSelectionCentroid,
  blockTopologyClientExtent,
} from './selection-geometry'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export type UseBlockFaceOperationOptions = {
  beginInputDrag: SelectionAffordanceProps['interactionApi']['beginInputDrag']
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
  sceneApi: Pick<SceneApi, 'get' | 'markDirty'>
  selectedIds: string[]
  selection: BlockSelection
  setActiveFaceOperation: StateSetter<BlockModalFaceOperation | null>
  setError: StateSetter<string | null>
  setFaceOperationAxis: StateSetter<BlockExtrudeAxis>
  setFaceOperationValue: StateSetter<string>
  setModalFeedbackMode: StateSetter<BlockModalFeedbackMode>
  setPreviewTopology: StateSetter<BlockTopology | null>
  setTransformNumericInput: StateSetter<string>
  target: Object3D
}

export function useBlockFaceOperation({
  beginInputDrag,
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
  setFaceOperationAxis,
  setFaceOperationValue,
  setModalFeedbackMode,
  setPreviewTopology,
  setTransformNumericInput,
  target,
}: UseBlockFaceOperationOptions) {
  const topologyPreview = useMemo(
    () => createBlockTopologyPreview(nodeId, sceneApi),
    [nodeId, sceneApi],
  )
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
      const projectedExtent = blockTopologyClientExtent(displayTopology, target, camera, canvas)
      if (!projectedExtent) return false

      const selectedFaceNormal = faceIds.reduce((sum, id) => {
        const face = displayTopology.faces.find((candidate) => candidate.id === id)!
        const normal = blockFaceNormal(displayTopology, face)
        return normal ? sum.add(new Vector3(...normal)) : sum
      }, new Vector3())
      if (selectedFaceNormal.lengthSq() > 1e-12) selectedFaceNormal.normalize()

      const projectedExtrusionDirection = (axis: BlockExtrudeAxis) => {
        const direction =
          axis === 'normal'
            ? selectedFaceNormal
            : new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
        if (direction.lengthSq() <= 1e-12) return null
        const endpointClient = blockLocalPointToClient(
          [
            origin[0] + direction.x * 0.1,
            origin[1] + direction.y * 0.1,
            origin[2] + direction.z * 0.1,
          ],
          target,
          camera,
          canvas,
        )
        return endpointClient?.sub(pivotClient) ?? null
      }

      const startPointer =
        lastPointerClientRef.current?.clone() ?? pivotClient.clone().add(new Vector2(80, 0))
      const baseTopology = displayTopology
      let latestTopology: BlockTopology | null = null
      let latestSelection: BlockSelection | null = null
      let latestCommand: BlockCommand | null = null
      let supportRefused = false
      let typedInput = ''
      let lastClientX = startPointer.x
      let lastClientY = startPointer.y
      let lastAltKey = false
      let lastSnapValue: number | null = null
      let extrudeAxis: BlockExtrudeAxis = 'normal'
      let extrusionDirection = projectedExtrusionDirection(extrudeAxis)

      const updatePreview = (clientX: number, clientY: number, altKey: boolean) => {
        lastClientX = clientX
        lastClientY = clientY
        lastAltKey = altKey
        const typedValue = blockTransformNumericValue(
          typedInput,
          operation === 'extrude' ? 'translate' : 'scale',
        )
        let value =
          typedValue ??
          blockFaceOperationValueFromPointer(
            operation,
            startPointer,
            { x: clientX, y: clientY },
            pivotClient,
            extent,
            projectedExtent,
            extrusionDirection,
          )
        if (typedValue === null && operation === 'extrude' && extrudeAxis !== 'normal') {
          value = blockPointerDistanceForAxis(extrudeAxis, value)
        }
        const snapping =
          operation === 'extrude' && typedValue === null && isGridSnapActive() && !altKey
        if (snapping) {
          const step = useEditor.getState().gridSnapStep
          if (step > 0) value = Math.round(value / step) * step
        }
        setFaceOperationValue(typedInput || String(Math.round(value * 1000) / 1000))
        setModalFeedbackMode(typedInput ? 'exact' : snapping ? 'grid' : 'free')
        if (Math.abs(value) <= 1e-6) {
          latestTopology = null
          latestSelection = null
          latestCommand = null
          supportRefused = false
          setError(null)
          setPreviewTopology(null)
          topologyPreview.clear()
          sceneApi.markDirty(nodeId)
          return
        }
        if (snapping && value !== lastSnapValue) {
          lastSnapValue = value
          playSfx('move-step')
        } else if (!snapping) {
          lastSnapValue = null
        }
        const command = blockFaceOperationCommand(operation, faceIds, value, extrudeAxis)
        const result = applyBlockCommand(baseTopology, command)
        if (!result.ok) {
          // Command errors keep the last accepted preview; only lost support holds the modal open.
          supportRefused = false
          setError(result.error)
          return
        }
        if (!topologyPreview.set(result.topology)) {
          supportRefused = true
          setError(BLOCK_SUPPORT_REFUSAL)
          return
        }
        latestTopology = result.topology
        latestSelection = result.selection
        latestCommand = command
        supportRefused = false
        setPreviewTopology(result.topology)
        sceneApi.markDirty(nodeId)
        setError(null)
      }

      const complete = (commitOperation: boolean) => {
        topologyPreview.clear()
        sceneApi.markDirty(nodeId)
        setPreviewTopology(null)
        setActiveFaceOperation(null)
        setFaceOperationAxis('normal')
        setFaceOperationValue('')
        setTransformNumericInput('')
        setModalFeedbackMode('free')
        if (commitOperation && latestTopology && latestSelection && latestCommand) {
          commit(baseTopology, latestCommand, operation === 'extrude' ? 'Extrude' : 'Inset')
          playSfx('operation-commit')
        } else if (!commitOperation) {
          playSfx('cancel')
        }
        if (ownsEditSession()) useInteractionScope.getState().begin(meshEditScope(nodeId))
        swallowNextClick()
      }

      const onMove = (pointerEvent: PointerEvent) => {
        lastPointerClientRef.current = new Vector2(pointerEvent.clientX, pointerEvent.clientY)
        updatePreview(pointerEvent.clientX, pointerEvent.clientY, pointerEvent.altKey)
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
        const nextAxis =
          operation === 'extrude' ? blockTransformAxisFromKey(keyboardEvent.key) : null
        const nextInput = blockTransformNumericInputFromKey(typedInput, keyboardEvent.key)
        if (nextAxis) {
          keyboardEvent.preventDefault()
          keyboardEvent.stopImmediatePropagation()
          extrudeAxis = nextAxis
          extrusionDirection = projectedExtrusionDirection(nextAxis)
          setFaceOperationAxis(nextAxis)
          lastSnapValue = null
          updatePreview(lastClientX, lastClientY, lastAltKey)
        } else if (nextInput !== null) {
          keyboardEvent.preventDefault()
          keyboardEvent.stopImmediatePropagation()
          typedInput = nextInput
          setTransformNumericInput(nextInput)
          updatePreview(lastClientX, lastClientY, lastAltKey)
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
      setFaceOperationAxis('normal')
      setFaceOperationValue('0')
      setTransformNumericInput('')
      setModalFeedbackMode('free')
      setError(null)
      beginBlockModalSession({
        canCommit: () => !supportRefused,
        beginInputDrag,
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
      topologyPreview,
      beginInputDrag,
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
      setFaceOperationAxis,
      setFaceOperationValue,
      setModalFeedbackMode,
      setPreviewTopology,
      setTransformNumericInput,
      target,
    ],
  )
}
