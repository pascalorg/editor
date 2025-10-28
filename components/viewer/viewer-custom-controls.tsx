'use client'

import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { useEditor } from '@/hooks/use-editor'
import { FLOOR_SPACING, WALL_HEIGHT } from '../editor'

const GRID_SIZE = 30 // Match the grid size from the viewer

export function ViewerCustomControls() {
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

  useEffect(() => {
    if (!controls) return

    if (selectedFloorId) {
      const floorY = (levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT) * currentLevel
      const currentTarget = new Vector3()
      ;(controls as CameraControlsImpl).getTarget(currentTarget)
      ;(controls as CameraControlsImpl).moveTo(currentTarget.x, floorY, currentTarget.z, true)
      const boundaryBox = new Box3(
        new Vector3(-GRID_SIZE / 2, floorY - 25, -GRID_SIZE / 2),
        new Vector3(GRID_SIZE / 2, floorY + 25, GRID_SIZE / 2),
      )
      ;(controls as CameraControlsImpl).setBoundary(boundaryBox)
    } else {
      ;(controls as CameraControlsImpl).setLookAt(40, 40, 40, 0, 0, 0, true)
      ;(controls as CameraControlsImpl).setBoundary() // No argument to remove boundaries
    }
  }, [currentLevel, controls, selectedFloorId, levelMode])

  // Configure mouse buttons for viewer mode - always allow panning with left click
  const mouseButtons = useMemo(() => {
    // Use ZOOM for orthographic camera, DOLLY for perspective camera
    const wheelAction =
      cameraMode === 'orthographic'
        ? CameraControlsImpl.ACTION.ZOOM
        : CameraControlsImpl.ACTION.DOLLY

    return {
      left: CameraControlsImpl.ACTION.SCREEN_PAN,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: wheelAction,
    }
  }, [cameraMode])

  // Restrict pitch to a reduced range suitable for architectural viewing
  // minPolarAngle: 15 degrees from top (prevents top-down view)
  // maxPolarAngle: 75 degrees from top (prevents looking below horizon)
  const minPolarAngle = Math.PI / 12 // ~15 degrees
  const maxPolarAngle = (5 * Math.PI) / 12 // ~75 degrees

  return (
    <CameraControls
      makeDefault
      maxDistance={50}
      maxPolarAngle={maxPolarAngle}
      minDistance={10}
      minPolarAngle={minPolarAngle}
      mouseButtons={mouseButtons}
      onEnd={() => setMovingCamera(false)}
      onStart={() => setMovingCamera(true)}
      ref={controlsRef}
    />
  )
}
