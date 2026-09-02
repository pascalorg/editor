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
  getSpatialPointerId,
  spatialPointerInput,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { useCallback, useEffect, useRef } from 'react'
import { Plane, Quaternion, Raycaster, Vector3 } from 'three'
import {
  didXRButtonPressStart,
  isXRCancelPressed,
  pulseXRInputSource,
  resolveXRReleaseAction,
  selectPrimaryXRInputSource,
  shouldReleaseCapturedXRInput,
  shouldRouteXRMove,
  XRSelectReleaseGuard,
} from '@/lib/xr/editor-input'
import { applyXRReferenceSpaceRayToWorld, setObjectFloorPlane } from '@/lib/xr/reference-space-ray'
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
  return getSpatialPointerId(event.nativeEvent) != null
}

export function XREditorInputBridge() {
  const session = useXR((state) => state.session)
  const origin = useXR((state) => state.origin)
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  // Logical XR pointer capture: the source that starts a scene press owns its
  // move/up stream until selectend, even when its ray crosses the wand.
  const capturedInputSource = useRef<XRInputSource | null>(null)
  const panelInputSources = useRef(new WeakSet<XRInputSource>())
  const cancelPressed = useRef(false)
  const pointerIds = useRef(new WeakMap<XRInputSource, number>())
  const nextPointerId = useRef(10_000)
  const raycaster = useRef(new Raycaster())
  const rayOrigin = useRef(new Vector3())
  const rayDirection = useRef(new Vector3())
  const rayRotation = useRef(new Quaternion())
  const gridPlane = useRef(new Plane())
  const gridPlaneNormal = useRef(new Vector3())
  const gridPlanePoint = useRef(new Vector3())
  const selectReleaseGuard = useRef(new XRSelectReleaseGuard())

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
      if (!(origin && pose)) return false
      const { position, orientation } = pose.transform
      origin.updateWorldMatrix(true, false)
      rayOrigin.current.set(position.x, position.y, position.z)
      rayRotation.current.set(orientation.x, orientation.y, orientation.z, orientation.w)
      rayDirection.current.set(0, 0, -1).applyQuaternion(rayRotation.current)
      applyXRReferenceSpaceRayToWorld(rayOrigin.current, rayDirection.current, origin.matrixWorld)
      raycaster.current.ray.set(rayOrigin.current, rayDirection.current)
      raycaster.current.layers.enableAll()
      return true
    },
    [gl, origin],
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

  const createGridEvent = useCallback(
    (
      frame: XRFrame,
      source: XRInputSource,
      buttons: number,
      allowRayFallback = false,
    ): GridEvent | null => {
      const grid = scene.getObjectByName(EDITOR_GRID_INPUT_NAME)
      if (!updateRay(frame, source)) return null
      grid?.updateWorldMatrix(true, false)

      const selection = useViewer.getState().selection
      const levelMesh = selection.levelId
        ? sceneRegistry.nodes.get(selection.levelId as AnyNodeId)
        : null
      levelMesh?.updateWorldMatrix(true, false)
      let levelFloorPoint: Vector3 | null = null
      if (levelMesh) {
        setObjectFloorPlane(
          gridPlane.current,
          levelMesh.matrixWorld,
          gridPlanePoint.current,
          gridPlaneNormal.current,
        )
        levelFloorPoint = raycaster.current.ray.intersectPlane(gridPlane.current, new Vector3())
      }
      const hit =
        !levelFloorPoint && grid?.visible
          ? raycaster.current.intersectObject(grid, false)[0]
          : undefined
      if (!(levelFloorPoint || hit || allowRayFallback)) return null

      const worldPoint = levelFloorPoint ?? hit?.point ?? raycaster.current.ray.at(1, new Vector3())
      const buildingId = selection.buildingId
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
      return {
        localPosition: [localPoint.x, localPoint.y, localPoint.z],
        nativeEvent: nativeEvent as never,
        position: [worldPoint.x, worldPoint.y, worldPoint.z],
      }
    },
    [gl, pointerIdFor, scene, updateRay],
  )

  const emitGridEvent = useCallback(
    (suffix: EventSuffix, frame: XRFrame, source: XRInputSource, buttons: number): boolean => {
      const payload = createGridEvent(frame, source, buttons)
      if (!payload) return false
      emitter.emit(`grid:${suffix}` as `grid:${EventSuffix}`, payload)
      return true
    },
    [createGridEvent],
  )

  const dispatchWindowPointerEvent = useCallback(
    (type: 'pointerup' | 'pointercancel', source: XRInputSource) => {
      window.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: pointerIdFor(source),
          pointerType: 'xr',
        }),
      )
    },
    [pointerIdFor],
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
    const onNodeClick = (event: NodeEvent) => {
      if (!isXRNodePointer(event)) return
      const source = getSpatialPointerId(event.nativeEvent)
      if (typeof source === 'object') {
        selectReleaseGuard.current.markNodeClick(source as XRInputSource)
      }
    }

    emitter.on('node:pointerdown', onNodePointerDown)
    emitter.on('node:click', onNodeClick)
    return () => {
      emitter.off('node:pointerdown', onNodePointerDown)
      emitter.off('node:click', onNodeClick)
    }
  }, [])

  useEffect(() => {
    if (!session) return

    const onSelectStart = (event: XRInputSourceEvent) => {
      selectReleaseGuard.current.start(event.inputSource)
      if (isWandPanelHit(event.frame, event.inputSource)) {
        panelInputSources.current.add(event.inputSource)
        pulseXRInputSource(event.inputSource, 0.1, 20)
        return
      }
      capturedInputSource.current = event.inputSource
      pulseXRInputSource(event.inputSource)
      emitGridEvent('pointerdown', event.frame, event.inputSource, 1)
    }
    const onSelectEnd = (event: XRInputSourceEvent) => {
      if (panelInputSources.current.delete(event.inputSource)) {
        selectReleaseGuard.current.cancel(event.inputSource)
        return
      }
      if (capturedInputSource.current !== event.inputSource) {
        selectReleaseGuard.current.cancel(event.inputSource)
        return
      }

      const handledSpatialRelease = spatialPointerInput.release(event.inputSource)

      const pressDrag = useEditor.getState().placementDragMode
      const mode = useEditor.getState().mode
      const scope = useInteractionScope.getState().scope
      const releaseAction = resolveXRReleaseAction({
        mode,
        placementDrag: pressDrag,
        scopeKind: scope.kind,
      })
      const emptySelectionEvent =
        releaseAction === 'defer-empty-selection'
          ? createGridEvent(event.frame, event.inputSource, 0, true)
          : null
      pulseXRInputSource(event.inputSource, 0.08, 18)
      emitGridEvent('pointerup', event.frame, event.inputSource, 0)
      dispatchWindowPointerEvent('pointerup', event.inputSource)

      if (handledSpatialRelease) {
        selectReleaseGuard.current.cancel(event.inputSource)
      } else if (releaseAction === 'finish-placement-drag') {
        useViewer.getState().setInputDragging(false)
        selectReleaseGuard.current.cancel(event.inputSource)
      } else if (releaseAction === 'emit-tool-grid-click') {
        emitGridEvent('click', event.frame, event.inputSource, 0)
        selectReleaseGuard.current.cancel(event.inputSource)
      } else if (releaseAction === 'defer-empty-selection' && emptySelectionEvent) {
        selectReleaseGuard.current.deferEmptyRelease(event.inputSource, () => {
          if (useEditor.getState().mode !== 'select') return
          if (useInteractionScope.getState().scope.kind !== 'idle') return
          if (useViewer.getState().inputDragging) return
          emitter.emit('grid:click', emptySelectionEvent)
        })
      } else {
        selectReleaseGuard.current.cancel(event.inputSource)
      }

      capturedInputSource.current = null
    }
    const onSelectCancel = (event: XRInputSourceEvent) => {
      if (panelInputSources.current.delete(event.inputSource)) {
        selectReleaseGuard.current.cancel(event.inputSource)
        return
      }
      if (capturedInputSource.current !== event.inputSource) {
        selectReleaseGuard.current.cancel(event.inputSource)
        return
      }

      const handledSpatialCancel = spatialPointerInput.cancel(event.inputSource)
      emitGridEvent('pointerup', event.frame, event.inputSource, 0)
      dispatchWindowPointerEvent('pointercancel', event.inputSource)
      if (!handledSpatialCancel && useEditor.getState().placementDragMode) {
        useViewer.getState().setInputDragging(false)
      }
      selectReleaseGuard.current.cancel(event.inputSource)
      capturedInputSource.current = null
    }

    session.addEventListener('selectstart', onSelectStart)
    session.addEventListener('selectend', onSelectEnd)
    session.addEventListener('selectcancel', onSelectCancel as unknown as EventListener)
    return () => {
      session.removeEventListener('selectstart', onSelectStart)
      session.removeEventListener('selectend', onSelectEnd)
      session.removeEventListener('selectcancel', onSelectCancel as unknown as EventListener)
    }
  }, [createGridEvent, dispatchWindowPointerEvent, emitGridEvent, isWandPanelHit, session])

  useFrame((_, __, frame) => {
    if (!(frame && session)) return
    const inputSources = Array.from(session.inputSources)
    if (shouldReleaseCapturedXRInput(inputSources, capturedInputSource.current)) {
      spatialPointerInput.cancel(capturedInputSource.current!)
      dispatchWindowPointerEvent('pointercancel', capturedInputSource.current!)
      if (useEditor.getState().placementDragMode) {
        useViewer.getState().setInputDragging(false)
      }
      selectReleaseGuard.current.cancel(capturedInputSource.current!)
      capturedInputSource.current = null
    }
    const source = selectPrimaryXRInputSource(inputSources, capturedInputSource.current)
    const panelHit = source ? isWandPanelHit(frame, source) : false
    if (source && shouldRouteXRMove(source, capturedInputSource.current, panelHit)) {
      emitGridEvent('move', frame, source, capturedInputSource.current ? 1 : 0)
      spatialPointerInput.move(source, raycaster.current.ray)
    }

    const nextCancelPressed = isXRCancelPressed(inputSources)
    if (didXRButtonPressStart(cancelPressed.current, nextCancelPressed)) {
      emitter.emit('tool:cancel')
      const rightController = inputSources.find(
        (inputSource) => inputSource.handedness === 'right' && inputSource.gamepad != null,
      )
      if (rightController) pulseXRInputSource(rightController, 0.25, 35)
      useViewer.getState().setInputDragging(false)
    }
    cancelPressed.current = nextCancelPressed
  })

  return null
}
