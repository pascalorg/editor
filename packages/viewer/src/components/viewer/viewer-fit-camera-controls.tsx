'use client'

import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Vector3Tuple } from 'three'

export type ViewerFitCameraControlsProps = {
  center: Vector3Tuple
  radius: number
}

export const ViewerFitCameraControls = ({ center, radius }: ViewerFitCameraControlsProps) => {
  const controls = useRef<CameraControlsImpl>(null)
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const mouseButtons = useMemo(
    () => ({
      left: CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: CameraControlsImpl.ACTION.DOLLY,
    }),
    [],
  )
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
    const [x, y, z] = pose.position
    const [targetX, targetY, targetZ] = pose.lookAt

    camera.position.set(x, y, z)
    camera.lookAt(targetX, targetY, targetZ)
    camera.updateProjectionMatrix()
    void controls.current?.setLookAt(x, y, z, targetX, targetY, targetZ, false)
    invalidate()
  }, [camera, invalidate, pose])

  return (
    <CameraControls
      dollyToCursor
      makeDefault
      maxDistance={pose.maxDistance}
      minDistance={pose.minDistance}
      mouseButtons={mouseButtons}
      ref={controls}
    />
  )
}
