'use client'

import { useViewerFrame } from '@pascal-app/viewer'
import { CameraControlsImpl } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import {
  Box3,
  MathUtils,
  Matrix4,
  Quaternion,
  Raycaster,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type Vector3Tuple,
} from 'three'

CameraControlsImpl.install({
  THREE: {
    Box3,
    MathUtils: { clamp: MathUtils.clamp },
    Matrix4,
    Quaternion,
    Raycaster,
    Sphere,
    Spherical,
    Vector2,
    Vector3,
    Vector4,
  },
})

type LovelaceFitCameraControlsProps = {
  center: Vector3Tuple
  radius: number
}

function applyEmbeddedCardControlBindings(controls: CameraControlsImpl) {
  controls.mouseButtons.left = CameraControlsImpl.ACTION.NONE
  controls.mouseButtons.middle = CameraControlsImpl.ACTION.NONE
  controls.mouseButtons.right = CameraControlsImpl.ACTION.ROTATE
  controls.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY
  controls.touches.one = CameraControlsImpl.ACTION.TOUCH_ROTATE
  controls.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_ROTATE
  controls.touches.three = CameraControlsImpl.ACTION.NONE
}

function bindContextMenuGuard(domElement: HTMLElement) {
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }

  domElement.addEventListener('contextmenu', handleContextMenu, true)
  return () => domElement.removeEventListener('contextmenu', handleContextMenu, true)
}

export const LovelaceFitCameraControls = ({ center, radius }: LovelaceFitCameraControlsProps) => {
  const controls = useRef<CameraControlsImpl>(null)
  const cameraRef = useRef<Camera | null>(null)
  const contextMenuCleanupRef = useRef<(() => void) | null>(null)
  const domElementRef = useRef<HTMLElement | null>(null)
  const poseKeyRef = useRef<string | null>(null)
  const pose = useMemo(() => {
    const safeRadius = Math.max(radius, 1)
    const [cx, cy, cz] = center
    const distance = safeRadius * 1.7
    const elevation = Math.max(safeRadius * 1.05, 7)

    return {
      lookAt: [cx, cy, cz] as Vector3Tuple,
      maxDistance: safeRadius * 4,
      minDistance: Math.max(safeRadius * 0.25, 2),
      position: [cx + distance * 0.86, cy + elevation, cz + distance] as Vector3Tuple,
    }
  }, [center, radius])

  useEffect(() => {
    return () => {
      contextMenuCleanupRef.current?.()
      controls.current?.disconnect()
      controls.current?.dispose()
      contextMenuCleanupRef.current = null
      controls.current = null
      cameraRef.current = null
      domElementRef.current = null
      poseKeyRef.current = null
    }
  }, [])

  useViewerFrame((state, delta) => {
    const domElement = (state.events.connected ?? state.gl.domElement) as HTMLElement
    if (
      !controls.current ||
      cameraRef.current !== state.camera ||
      domElementRef.current !== domElement
    ) {
      contextMenuCleanupRef.current?.()
      controls.current?.disconnect()
      controls.current?.dispose()
      controls.current = new CameraControlsImpl(state.camera)
      controls.current.connect(domElement)
      controls.current.dollyToCursor = true
      applyEmbeddedCardControlBindings(controls.current)
      contextMenuCleanupRef.current = bindContextMenuGuard(domElement)
      cameraRef.current = state.camera
      domElementRef.current = domElement
      poseKeyRef.current = null
    }

    const currentControls = controls.current
    applyEmbeddedCardControlBindings(currentControls)
    currentControls.maxDistance = pose.maxDistance
    currentControls.minDistance = pose.minDistance

    const poseKey = JSON.stringify(pose)
    if (poseKeyRef.current !== poseKey) {
      const [x, y, z] = pose.position
      const [targetX, targetY, targetZ] = pose.lookAt
      state.camera.position.set(x, y, z)
      state.camera.lookAt(targetX, targetY, targetZ)
      state.camera.updateProjectionMatrix()
      void currentControls.setLookAt(x, y, z, targetX, targetY, targetZ, false)
      poseKeyRef.current = poseKey
      state.invalidate()
    }

    if (currentControls.update(delta)) {
      state.invalidate()
    }
  }, -1)

  return null
}
