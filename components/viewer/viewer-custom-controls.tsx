'use client'

import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { useShallow } from 'zustand/shallow'
import { emitter, type ViewApplyEvent } from '@/events/bus'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import { FLOOR_SPACING, GRID_SIZE, VIEWER_INITIAL_CAMERA_DISTANCE, WALL_HEIGHT } from './index'

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

  // Get building ID for camera focus when no level is selected
  const buildingId = useEditor(
    (state) => state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')?.id,
  )

  // Get site node to check for camera preference
  const site = useEditor(useShallow((state) => state.scene.root.children?.[0]))

  // Get the selected collection's nodeIds for bounds calculation
  const collectionNodeIds = useEditor(
    useShallow((state: StoreState) => {
      if (!state.selectedCollectionId) return null
      const collection = state.scene.collections?.find((c) => c.id === state.selectedCollectionId)
      return collection?.nodeIds || null
    }),
  )

  useEffect(() => {
    if (!controls) return

    const d = VIEWER_INITIAL_CAMERA_DISTANCE
    ;(controls as CameraControlsImpl).setLookAt(d, d, d, 0, 0, 0, false)
  }, [controls])

  // Handle View Events
  useEffect(() => {
    const handleApply = ({ camera }: ViewApplyEvent) => {
      if (!controlsRef.current) return
      const { position, target, mode } = camera

      // Switch mode if needed
      if (useEditor.getState().cameraMode !== mode) {
        useEditor.getState().setCameraMode(mode)
      }

      // Set camera
      controlsRef.current.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true, // enable transition
      )
    }

    emitter.on('view:apply', handleApply)

    return () => {
      emitter.off('view:apply', handleApply)
    }
  }, [])

  // Focus on building when no level is selected (building overview mode)
  useEffect(() => {
    if (!(controls && scene) || selectedFloorId || !buildingId) return

    // If site has camera settings, prioritize them
    if (site?.camera) {
      const { position, target, mode } = site.camera

      // Switch mode if needed
      if (useEditor.getState().cameraMode !== mode) {
        useEditor.getState().setCameraMode(mode)
      }

      const cameraImpl = controls as CameraControlsImpl
      cameraImpl.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        false, // disable transition for initial load
      )
      cameraImpl.setBoundary() // Remove boundaries
      return
    }

    // Use a polling mechanism to ensure Three.js scene has updated with the building object
    let isMounted = true
    let timeoutId: ReturnType<typeof setTimeout>

    const checkBuilding = (retries = 0) => {
      if (!isMounted) return

      // Find the building object and calculate its bounds
      const buildingObject = scene.getObjectByName(buildingId)

      if (!buildingObject) {
        if (retries < 20) {
          // Retry for ~2 seconds (20 * 100ms)
          timeoutId = setTimeout(() => checkBuilding(retries + 1), 100)
        } else {
          // Give up and use default camera position
          const d = VIEWER_INITIAL_CAMERA_DISTANCE
          ;(controls as CameraControlsImpl).setLookAt(d, d, d, 0, 0, 0, true)
          ;(controls as CameraControlsImpl).setBoundary()
        }
        return
      }

      // Calculate bounding box for the entire building
      const buildingBox = new Box3().setFromObject(buildingObject)
      if (buildingBox.isEmpty()) {
        const d = VIEWER_INITIAL_CAMERA_DISTANCE
        ;(controls as CameraControlsImpl).setLookAt(d, d, d, 0, 0, 0, true)
        ;(controls as CameraControlsImpl).setBoundary()
        return
      }

      // Get bounds center and size
      const center = buildingBox.getCenter(new Vector3())
      const size = buildingBox.getSize(new Vector3())

      // Use fixed default distance for consistent behavior
      const newDistance = VIEWER_INITIAL_CAMERA_DISTANCE

      // Position camera at 45-degree angle looking at building center
      const cameraImpl = controls as CameraControlsImpl
      cameraImpl.setLookAt(
        center.x + newDistance,
        center.y + newDistance,
        center.z + newDistance,
        center.x,
        center.y,
        center.z,
        true,
      )
      cameraImpl.setBoundary() // Remove boundaries for free viewing
    }

    checkBuilding()

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
    }
  }, [controls, scene, selectedFloorId, buildingId, site])

  // Focus on level when a level is selected (but no collection is selected)
  useEffect(() => {
    if (!(controls && scene && selectedFloorId)) return

    const floorY = (levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT) * currentLevel
    const cameraImpl = controls as CameraControlsImpl

    // If a collection is selected, don't override its camera focus
    if (selectedCollectionId) {
      // Just update the boundary
      const boundaryBox = new Box3(
        new Vector3(-GRID_SIZE / 2, floorY - 25, -GRID_SIZE / 2),
        new Vector3(GRID_SIZE / 2, floorY + 25, GRID_SIZE / 2),
      )
      cameraImpl.setBoundary(boundaryBox)
      return
    }

    // Check if there's a view saved for this level
    const views = useEditor.getState().scene.views || []
    const levelView = views.find((v) => v.sceneState?.selectedLevelId === selectedFloorId)

    // Check if the level node has specific camera settings
    const levelNodeHandle = scene.getObjectByName(selectedFloorId)
      ? useEditor.getState().graph.getNodeById(selectedFloorId as any)
      : null
    const levelCamera = levelNodeHandle?.data()?.camera

    if (levelCamera) {
      const { position, target, mode } = levelCamera

      // Switch camera mode if needed
      if (useEditor.getState().cameraMode !== mode) {
        useEditor.getState().setCameraMode(mode)
      }

      cameraImpl.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true,
      )
    } else if (levelView) {
      // Apply the saved view's camera position
      const { position, target, mode } = levelView.camera

      // Switch camera mode if needed
      if (useEditor.getState().cameraMode !== mode) {
        useEditor.getState().setCameraMode(mode)
      }

      cameraImpl.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true,
      )
    } else {
      // No saved view - use default camera positioning
      // Find the level object to get its center, then position camera like initial setup
      const levelObject = scene.getObjectByName(selectedFloorId)

      // Default target is origin at floor height
      let targetX = 0
      let targetZ = 0

      if (levelObject) {
        const levelBox = new Box3().setFromObject(levelObject)
        if (!levelBox.isEmpty()) {
          const center = levelBox.getCenter(new Vector3())
          targetX = center.x
          targetZ = center.z
        }
      }

      // Use same camera distance as initial setup (VIEWER_INITIAL_CAMERA_DISTANCE)
      // Position camera at 45-degree angle, similar to building overview
      const d = VIEWER_INITIAL_CAMERA_DISTANCE
      cameraImpl.setLookAt(targetX + d, floorY + d, targetZ + d, targetX, floorY, targetZ, true)
    }

    // Set boundary for the floor
    const boundaryBox = new Box3(
      new Vector3(-GRID_SIZE / 2, floorY - 25, -GRID_SIZE / 2),
      new Vector3(GRID_SIZE / 2, floorY + 25, GRID_SIZE / 2),
    )
    cameraImpl.setBoundary(boundaryBox)
  }, [currentLevel, controls, selectedFloorId, selectedCollectionId, levelMode, scene])

  // Focus camera on collection bounds when a collection is selected
  useEffect(() => {
    if (!(controls && scene && selectedCollectionId && collectionNodeIds?.length)) return

    const cameraImpl = controls as CameraControlsImpl

    // Check if there's a view saved for this collection
    const views = useEditor.getState().scene.views || []
    const collectionView = views.find((v) =>
      v.sceneState?.visibleCollectionIds?.includes(selectedCollectionId),
    )

    if (collectionView) {
      // Apply the saved view's camera position
      const { position, target, mode } = collectionView.camera

      // Switch camera mode if needed
      if (useEditor.getState().cameraMode !== mode) {
        useEditor.getState().setCameraMode(mode)
      }

      cameraImpl.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true,
      )
      return
    }

    // No saved view - use default camera positioning based on collection bounds
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

  // Focus on node camera when selected
  useEffect(() => {
    if (!(controls && scene && selectedNodeIds.length === 1)) return

    // Don't override if a collection is selected
    if (selectedCollectionId) return

    const nodeId = selectedNodeIds[0]
    // Access node via graph directly
    const handle = useEditor.getState().graph.getNodeById(nodeId as any)
    const node = handle?.data()

    if (node?.camera) {
      const { position, target, mode } = node.camera

      // Switch mode if needed
      if (useEditor.getState().cameraMode !== mode) {
        useEditor.getState().setCameraMode(mode)
      }

      // Apply camera
      const cameraImpl = controls as CameraControlsImpl
      cameraImpl.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true, // enable transition
      )
    }
  }, [selectedNodeIds, controls, scene, selectedCollectionId])

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
      maxDistance={200}
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
