'use client'

import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { Box3, Vector3 } from 'three'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import {
  FLOOR_SPACING,
  GRID_SIZE,
  VIEWER_DESELECTED_CAMERA_DISTANCE,
  VIEWER_INITIAL_CAMERA_DISTANCE,
  WALL_HEIGHT,
} from './index'

const TILE_SIZE = 0.5 // 50cm grid spacing

export function ViewerCustomControls() {
  const cameraMode = useEditor((state) => state.cameraMode)
  const setMovingCamera = useEditor((state) => state.setMovingCamera)
  const controls = useThree((state) => state.controls)
  const { scene } = useThree()
  const controlsRef = useRef<CameraControlsImpl>(null)
  const currentLevel = useEditor((state) => state.currentLevel)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levelMode = useEditor((state) => state.levelMode)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)

  // Get the selected collection's nodeIds for bounds calculation
  const collectionNodeIds = useEditor(
    useShallow((state: StoreState) => {
      if (!state.selectedCollectionId) return null
      const collection = state.scene.collections?.find(
        (c) => c.id === state.selectedCollectionId,
      )
      return collection?.nodeIds || null
    }),
  )

  useEffect(() => {
    if (!controls) return

    const d = VIEWER_INITIAL_CAMERA_DISTANCE
    ;(controls as CameraControlsImpl).setLookAt(d, d, d, 0, 0, 0, false)
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
      const d = VIEWER_DESELECTED_CAMERA_DISTANCE
      ;(controls as CameraControlsImpl).setLookAt(d, d, d, 0, 0, 0, true)
      ;(controls as CameraControlsImpl).setBoundary() // No argument to remove boundaries
    }
  }, [currentLevel, controls, selectedFloorId, levelMode])

  // Focus camera on collection bounds when a collection is selected
  useEffect(() => {
    if (!controls || !scene || !selectedCollectionId || !collectionNodeIds?.length) return

    // Calculate the combined bounding box of all nodes in the collection
    const combinedBox = new Box3()

    for (const nodeId of collectionNodeIds) {
      const object = scene.getObjectByName(nodeId)
      if (object) {
        const objectBox = new Box3().setFromObject(object)
        combinedBox.union(objectBox)
      }
    }

    if (combinedBox.isEmpty()) return

    // Get bounds center and size
    const center = combinedBox.getCenter(new Vector3())
    const size = combinedBox.getSize(new Vector3())

    // Calculate the optimal camera distance based on the bounds size
    const maxDimension = Math.max(size.x, size.z)
    const padding = 2 // Add some padding around the room
    const targetDistance = (maxDimension + padding) * 0.8

    // Move camera to look at the center of the collection
    const cameraImpl = controls as CameraControlsImpl
    const currentPosition = new Vector3()
    cameraImpl.getPosition(currentPosition)

    // Calculate new camera position maintaining the same angle
    const direction = currentPosition.clone().sub(center).normalize()
    const newDistance = Math.max(targetDistance, 8) // Minimum distance of 8
    const newPosition = center.clone().add(direction.multiplyScalar(newDistance))

    // Set floor Y based on current level
    const floorY = (levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT) * currentLevel

    // Smoothly transition camera to focus on collection
    cameraImpl.setLookAt(
      newPosition.x,
      Math.max(newPosition.y, floorY + 5),
      newPosition.z,
      center.x,
      floorY,
      center.z,
      true,
    )
  }, [controls, scene, selectedCollectionId, collectionNodeIds, currentLevel, levelMode])

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
