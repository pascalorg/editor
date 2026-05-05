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

export const LovelaceFitCameraControls = ({ center, radius }: LovelaceFitCameraControlsProps) => {
  const controls = useRef<CameraControlsImpl>(null)
  const cameraRef = useRef<Camera | null>(null)
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
      controls.current?.disconnect()
      controls.current?.dispose()
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
      controls.current?.disconnect()
      controls.current?.dispose()
      controls.current = new CameraControlsImpl(state.camera)
      controls.current.connect(domElement)
      controls.current.dollyToCursor = true
      controls.current.mouseButtons.left = CameraControlsImpl.ACTION.NONE
      controls.current.mouseButtons.middle = CameraControlsImpl.ACTION.SCREEN_PAN
      controls.current.mouseButtons.right = CameraControlsImpl.ACTION.ROTATE
      controls.current.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY
      cameraRef.current = state.camera
      domElementRef.current = domElement
      poseKeyRef.current = null
    }

    const currentControls = controls.current
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
