'use client'

import {
  type AnyNodeId,
  type EventSuffix,
  emitter,
  type GridEvent,
  type NodeEvent,
  sceneRegistry,
} from '@pascal-app/core'
import {
  canDirectMoveNode,
  createEditorApi,
  EDITOR_GRID_INPUT_NAME,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { useCallback, useEffect, useRef } from 'react'
import { Quaternion, Raycaster, Vector3 } from 'three'
import {
  didXRButtonPressStart,
  isXRCancelPressed,
  selectPrimaryXRInputSource,
} from '@/lib/xr/editor-input'
import { XR_WAND_PANEL_INPUT_NAME } from './wand-panel/panel-layout'

type XRGridNativeEvent = {
  altKey: false
  button: 0
  buttons: number
  ctrlKey: false
  detail: number
  metaKey: false
  pointerId: number
  pointerType: 'xr'
  shiftKey: false
  stopImmediatePropagation: () => void
  stopPropagation: () => void
  target: HTMLCanvasElement
  timeStamp: number
}

function isXRNodePointer(event: NodeEvent): boolean {
  const native = event.nativeEvent as unknown as {
    pointerState?: { inputSource?: XRInputSource }
    pointerType?: string
  }
  return native.pointerState?.inputSource != null && native.pointerType !== 'mouse'
}

export function XREditorInputBridge() {
  const session = useXR((state) => state.session)
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const activeInputSource = useRef<XRInputSource | null>(null)
  const panelInputSources = useRef(new WeakSet<XRInputSource>())
  const cancelPressed = useRef(false)
  const pointerIds = useRef(new WeakMap<XRInputSource, number>())
  const nextPointerId = useRef(10_000)
  const raycaster = useRef(new Raycaster())
  const rayOrigin = useRef(new Vector3())
  const rayDirection = useRef(new Vector3())
  const rayRotation = useRef(new Quaternion())

  const pointerIdFor = useCallback((source: XRInputSource) => {
    const existing = pointerIds.current.get(source)
    if (existing !== undefined) return existing
    const next = nextPointerId.current++
    pointerIds.current.set(source, next)
    return next
  }, [])

  const updateRay = useCallback(
    (frame: XRFrame, source: XRInputSource): boolean => {
      const referenceSpace = gl.xr.getReferenceSpace()
      if (!referenceSpace) return false
      const pose = frame.getPose(source.targetRaySpace, referenceSpace)
      if (!pose) return false
      const { position, orientation } = pose.transform
      rayOrigin.current.set(position.x, position.y, position.z)
      rayRotation.current.set(orientation.x, orientation.y, orientation.z, orientation.w)
      rayDirection.current.set(0, 0, -1).applyQuaternion(rayRotation.current).normalize()
      raycaster.current.ray.set(rayOrigin.current, rayDirection.current)
      raycaster.current.layers.enableAll()
      return true
    },
    [gl],
  )

  const isWandPanelHit = useCallback(
    (frame: XRFrame, source: XRInputSource): boolean => {
      const panel = scene.getObjectByName(XR_WAND_PANEL_INPUT_NAME)
      if (!(panel && updateRay(frame, source))) return false
      panel.updateWorldMatrix(true, true)
      return raycaster.current.intersectObject(panel, true).length > 0
    },
    [scene, updateRay],
  )

  const emitGridEvent = useCallback(
    (suffix: EventSuffix, frame: XRFrame, source: XRInputSource, buttons: number): boolean => {
      const grid = scene.getObjectByName(EDITOR_GRID_INPUT_NAME)
      if (!(grid && updateRay(frame, source))) return false
      grid.updateWorldMatrix(true, false)

      const hit = raycaster.current.intersectObject(grid, false)[0]
      if (!hit) return false

      const worldPoint = hit.point
      const buildingId = useViewer.getState().selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      const localPoint = buildingMesh
        ? buildingMesh.worldToLocal(worldPoint.clone())
        : worldPoint.clone()
      const nativeEvent: XRGridNativeEvent = {
        altKey: false,
        button: 0,
        buttons,
        ctrlKey: false,
        detail: 1,
        metaKey: false,
        pointerId: pointerIdFor(source),
        pointerType: 'xr',
        shiftKey: false,
        stopImmediatePropagation: () => undefined,
        stopPropagation: () => undefined,
        target: gl.domElement,
        timeStamp: performance.now(),
      }
      const payload: GridEvent = {
        localPosition: [localPoint.x, localPoint.y, localPoint.z],
        nativeEvent: nativeEvent as never,
        position: [worldPoint.x, worldPoint.y, worldPoint.z],
      }
      emitter.emit(`grid:${suffix}` as `grid:${EventSuffix}`, payload)
      return true
    },
    [gl, pointerIdFor, scene, updateRay],
  )

  useEffect(() => {
    const onNodePointerDown = (event: NodeEvent) => {
      if (!isXRNodePointer(event)) return
      if (useEditor.getState().mode !== 'select') return
      if (useInteractionScope.getState().scope.kind !== 'idle') return

      const selectedIds = useViewer.getState().selection.selectedIds
      if (!(selectedIds.length === 1 && selectedIds[0] === event.node.id)) return
      if (!canDirectMoveNode(event.node)) return

      event.stopPropagation()
      useViewer.getState().setInputDragging(true)
      createEditorApi().engageMoveDrag(event.node)
    }

    emitter.on('node:pointerdown', onNodePointerDown)
    return () => emitter.off('node:pointerdown', onNodePointerDown)
  }, [])

  useEffect(() => {
    if (!session) return

    const onSelectStart = (event: XRInputSourceEvent) => {
      if (isWandPanelHit(event.frame, event.inputSource)) {
        panelInputSources.current.add(event.inputSource)
        return
      }
      activeInputSource.current = event.inputSource
      emitGridEvent('pointerdown', event.frame, event.inputSource, 1)
    }
    const onSelectEnd = (event: XRInputSourceEvent) => {
      if (panelInputSources.current.delete(event.inputSource)) return
      if (activeInputSource.current !== event.inputSource) return

      const pressDrag = useEditor.getState().placementDragMode
      emitGridEvent('pointerup', event.frame, event.inputSource, 0)

      if (pressDrag) {
        window.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            button: 0,
            pointerId: pointerIdFor(event.inputSource),
            pointerType: 'xr',
          }),
        )
        useViewer.getState().setInputDragging(false)
      } else {
        const scope = useInteractionScope.getState().scope
        if (useEditor.getState().mode !== 'select' || scope.kind !== 'idle') {
          emitGridEvent('click', event.frame, event.inputSource, 0)
        }
      }

      activeInputSource.current = null
    }

    session.addEventListener('selectstart', onSelectStart)
    session.addEventListener('selectend', onSelectEnd)
    return () => {
      session.removeEventListener('selectstart', onSelectStart)
      session.removeEventListener('selectend', onSelectEnd)
    }
  }, [emitGridEvent, isWandPanelHit, pointerIdFor, session])

  useFrame((_, __, frame) => {
    if (!(frame && session)) return
    const inputSources = Array.from(session.inputSources)
    const source = selectPrimaryXRInputSource(inputSources, activeInputSource.current)
    if (source && !isWandPanelHit(frame, source)) {
      emitGridEvent('move', frame, source, activeInputSource.current ? 1 : 0)
    }

    const nextCancelPressed = isXRCancelPressed(inputSources)
    if (didXRButtonPressStart(cancelPressed.current, nextCancelPressed)) {
      emitter.emit('tool:cancel')
      useViewer.getState().setInputDragging(false)
    }
    cancelPressed.current = nextCancelPressed
  })

  return null
}
