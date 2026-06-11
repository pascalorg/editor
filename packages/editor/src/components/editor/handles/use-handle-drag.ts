'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type Cursor,
  createSceneApi,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Camera, type Object3D, type Plane, type Ray, Vector2, type Vector3 } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { suppressBoxSelectForPointer } from '../../tools/select/box-select-state'

export type HandleDragControls = {
  onStart: (index: number, snapshot: AnyNode) => void
  onEnd: () => void
}

type IntersectPlane = (
  clientX: number,
  clientY: number,
  plane: Plane,
  target: Vector3,
) => Vector3 | null

type GetPointerRay = (clientX: number, clientY: number, target: Ray) => Ray

export type HandleDragStartContext = {
  event: ThreeEvent<PointerEvent>
  camera: Camera
  getPointerRay: GetPointerRay
  intersectPlane: IntersectPlane
  initialNode: AnyNode
  node: AnyNode
  nodeId: AnyNodeId
  rideObject: Object3D
  sceneApi: ReturnType<typeof createSceneApi>
}

export type HandleDragMoveContext = {
  event: PointerEvent
  getPointerRay: GetPointerRay
  intersectPlane: IntersectPlane
}

type HandleDragSession = {
  move: (context: HandleDragMoveContext) => Partial<AnyNode> | null
  markDirty?: boolean
  onBegin?: () => void
  onEnd?: () => void
  overrideId?: AnyNodeId
}

type UseHandleDragArgs =
  | {
      kind: 'drag'
      cursor: Cursor
      dragControls: HandleDragControls
      handleIndex: number
      node: AnyNode
      onStart: (context: HandleDragStartContext) => HandleDragSession | null
      rideObject: Object3D
      setIsDragging: (dragging: boolean) => void
    }
  | {
      kind: 'tap'
      onTap: (event: ThreeEvent<PointerEvent>) => void
    }

export function swallowNextClick() {
  const swallow = (clickEvent: Event) => {
    clickEvent.stopPropagation()
    clickEvent.preventDefault()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => {
    window.removeEventListener('click', swallow, { capture: true })
  }, 300)
}

function suppressInputDraggingUntilPointerRelease(pointerId: number) {
  const previousInputDragging = useViewer.getState().inputDragging
  useViewer.getState().setInputDragging(true)

  function restore(event?: PointerEvent) {
    if (event && event.pointerId !== pointerId) return
    useViewer.getState().setInputDragging(previousInputDragging)
    window.removeEventListener('pointerup', restore)
    window.removeEventListener('pointercancel', restore)
    window.removeEventListener('blur', onBlur)
  }
  function onBlur() {
    restore()
  }

  window.addEventListener('pointerup', restore)
  window.addEventListener('pointercancel', restore)
  window.addEventListener('blur', onBlur)
}

export function useHandleDrag(args: UseHandleDragArgs) {
  const { camera, raycaster, gl } = useThree()
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => dragCleanupRef.current?.(), [])

  return (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    suppressBoxSelectForPointer(event)

    if (args.kind === 'tap') {
      suppressInputDraggingUntilPointerRelease(event.nativeEvent.pointerId)
      swallowNextClick()
      sfxEmitter.emit('sfx:item-pick')
      document.body.style.cursor = ''
      args.onTap(event)
      return
    }

    const { cursor, dragControls, handleIndex, node, rideObject, setIsDragging } = args
    rideObject.updateMatrixWorld()

    const ndc = new Vector2()
    const setPointerRay = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
    }
    const getPointerRay: GetPointerRay = (clientX, clientY, target) => {
      setPointerRay(clientX, clientY)
      return target.copy(raycaster.ray)
    }
    const intersectPlane: IntersectPlane = (clientX, clientY, plane, target) => {
      setPointerRay(clientX, clientY)
      return raycaster.ray.intersectPlane(plane, target)
    }

    const nodeId = node.id as AnyNodeId
    const sceneApi = createSceneApi(useScene)
    const initialNode = (sceneApi.get(nodeId) ?? node) as AnyNode
    const session = args.onStart({
      event,
      camera,
      getPointerRay,
      intersectPlane,
      initialNode,
      node,
      nodeId,
      rideObject,
      sceneApi,
    })
    if (!session) return

    const overrideId = session.overrideId ?? nodeId
    const markDirty = session.markDirty !== false
    document.body.style.cursor = cursor
    sfxEmitter.emit('sfx:item-pick')
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()
    setIsDragging(true)
    dragControls.onStart(handleIndex, initialNode)
    session.onBegin?.()

    let lastPatch: Partial<AnyNode> | null = null

    const onMove = (moveEvent: PointerEvent) => {
      const patch = session.move({ event: moveEvent, getPointerRay, intersectPlane })
      if (!patch) return
      lastPatch = patch
      useLiveNodeOverrides.getState().set(overrideId, patch as Record<string, unknown>)
      if (markDirty) {
        useScene.getState().markDirty(overrideId)
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === cursor) {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useViewer.getState().setInputDragging(false)
      setIsDragging(false)
      session.onEnd?.()
      dragControls.onEnd()
      dragCleanupRef.current = null
    }

    const clearOverride = () => {
      useLiveNodeOverrides.getState().clear(overrideId)
      if (markDirty) {
        useScene.getState().markDirty(overrideId)
      }
    }

    const onUp = () => {
      swallowNextClick()
      sfxEmitter.emit('sfx:item-place')
      if (lastPatch) {
        sceneApi.update(overrideId, lastPatch)
      }
      clearOverride()
      cleanup()
    }

    const onCancel = () => {
      clearOverride()
      cleanup()
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }
}
