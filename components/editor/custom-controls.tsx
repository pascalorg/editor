'use client'

import { useEditor } from '@/hooks/use-editor'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { FLOOR_SPACING } from './index'

export function CustomControls() {
  const controlMode = useEditor((state) => state.controlMode)
  const setMovingCamera = useEditor((state) => state.setMovingCamera)
  const controls = useThree((state) => state.controls)
  const controlsRef = useRef<CameraControlsImpl>(null)
  const currentLevel = useEditor((state) => state.currentLevel)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  useEffect(() => {
    if (!controls) return

    ;(controls as CameraControlsImpl).setLookAt(30, 30, 30, 0, 0, 0, false)
  }, [controls])

  useEffect(() => {
    if (!controls) return

    if (selectedFloorId) {
      const floorY = FLOOR_SPACING * currentLevel;
      const currentPosition = new Vector3();
      (controls as CameraControlsImpl).getPosition(currentPosition);
      const currentTarget = new Vector3();
      (controls as CameraControlsImpl).getTarget(currentTarget);
      (controls as CameraControlsImpl).setLookAt(currentPosition.x, floorY + 10, currentPosition.z, currentTarget.x, floorY, currentTarget.z, true)
    } else {
      ;(controls as CameraControlsImpl).setLookAt(40, 40, 40, 0, 0, 0, true)
    }
  }, [currentLevel, controls, selectedFloorId])

  // Configure mouse buttons based on control mode
  const mouseButtons = useMemo(() => {
    // In select mode, left-click can pan the camera
    if (controlMode === 'select') {
      return {
        left: CameraControlsImpl.ACTION.SCREEN_PAN, // Similar to the sims
        middle: CameraControlsImpl.ACTION.SCREEN_PAN,
        right: CameraControlsImpl.ACTION.ROTATE,
        wheel: CameraControlsImpl.ACTION.DOLLY,
      }
    }

    // In delete, build, and guide modes, disable left-click for camera
    // (reserved for mode-specific actions)
    return {
      left: CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: CameraControlsImpl.ACTION.DOLLY,
    }
  }, [controlMode])

  return (
    <CameraControls
      makeDefault
      maxDistance={50}
      maxPolarAngle={Math.PI / 2 - 0.1}
      minDistance={10}
      minPolarAngle={0}
      mouseButtons={mouseButtons}
      onEnd={() => setMovingCamera(false)}
      onStart={() => setMovingCamera(true)}
      ref={controlsRef}
    />
  )
}
