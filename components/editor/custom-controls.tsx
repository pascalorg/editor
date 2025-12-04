'use client'

import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { useEditor } from '@/hooks/use-editor'
import { FLOOR_SPACING, WALL_HEIGHT } from './index'

export function CustomControls() {
  const controlMode = useEditor((state) => state.controlMode)
  const cameraMode = useEditor((state) => state.cameraMode)
  const setMovingCamera = useEditor((state) => state.setMovingCamera)
  const controls = useThree((state) => state.controls)
  const controlsRef = useRef<CameraControlsImpl>(null)
  const currentLevel = useEditor((state) => state.currentLevel)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levelMode = useEditor((state) => state.levelMode)

  useEffect(() => {
    if (!controls) return

    ;(controls as CameraControlsImpl).setLookAt(30, 30, 30, 0, 0, 0, false)
  }, [controls])

  // const scene = useThree((state) => state.scene)

  useEffect(() => {
    if (!controls) return

    if (selectedFloorId) {
      const floorY = (levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT) * currentLevel
      const currentTarget = new Vector3()
      ;(controls as CameraControlsImpl).getTarget(currentTarget)
      ;(controls as CameraControlsImpl).moveTo(currentTarget.x, floorY, currentTarget.z, true)
      const boundaryBox = new Box3(
        new Vector3(-200, floorY - 25, -200),
        new Vector3(200, floorY + 25, 200),
      )
      ;(controls as CameraControlsImpl).setBoundary(boundaryBox)

      //  For debugging camera boundaries
      // const boxHelper = new Box3Helper(boundaryBox, 0xff0000);
      // scene.add(boxHelper);
    } else {
      ;(controls as CameraControlsImpl).setLookAt(40, 40, 40, 0, 0, 0, true)
      ;(controls as CameraControlsImpl).setBoundary() // No argument to remove boundaries
    }
  }, [currentLevel, controls, selectedFloorId, levelMode])

  // Configure mouse buttons based on control mode and camera mode
  const mouseButtons = useMemo(() => {
    // Use ZOOM for orthographic camera, DOLLY for perspective camera
    const wheelAction =
      cameraMode === 'orthographic'
        ? CameraControlsImpl.ACTION.ZOOM
        : CameraControlsImpl.ACTION.DOLLY

    // In select mode, left-click can pan the camera
    if (controlMode === 'select') {
      return {
        left: CameraControlsImpl.ACTION.SCREEN_PAN, // Similar to the sims
        middle: CameraControlsImpl.ACTION.SCREEN_PAN,
        right: CameraControlsImpl.ACTION.ROTATE,
        wheel: wheelAction,
      }
    }

    // In edit, delete, build, and guide modes, disable left-click for camera
    // (reserved for mode-specific actions like dragging property line handles)
    return {
      left: CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: wheelAction,
    }
  }, [controlMode, cameraMode])

  return (
    <CameraControls
      makeDefault
      maxDistance={100}
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
