'use client'

import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Box3, Vector3 } from 'three'
import { useShallow } from 'zustand/shallow'
import { emitter, type ViewApplyEvent } from '@pascal/core/events'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import { FLOOR_SPACING, GRID_SIZE, VIEWER_INITIAL_CAMERA_DISTANCE, WALL_HEIGHT } from './index'

const TILE_SIZE = 0.5 // 50cm grid spacing

/**
 * Calculate bounds for an object, computing XZ center at local origin (Y=0)
 * This avoids issues with animated Y positions in exploded view
 */
function calculateLocalBoundsCenter(object: THREE.Object3D): { x: number; z: number } | null {
  const box = new Box3()
  let hasContent = false

  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      // Skip grids and other background elements
      if (child.name === '__infinite_grid__' || child.name === '__proximity_grid__') {
        return
      }

      // Get geometry bounds
      if (!child.geometry.boundingBox) {
        child.geometry.computeBoundingBox()
      }

      if (child.geometry.boundingBox) {
        const childBox = child.geometry.boundingBox.clone()

        // Transform by the mesh's world matrix, but we'll extract XZ only
        child.updateWorldMatrix(true, false)
        childBox.applyMatrix4(child.matrixWorld)

        // Only expand XZ, ignore Y for centering
        box.min.x = Math.min(box.min.x, childBox.min.x)
        box.max.x = Math.max(box.max.x, childBox.max.x)
        box.min.z = Math.min(box.min.z, childBox.min.z)
        box.max.z = Math.max(box.max.z, childBox.max.z)
        hasContent = true
      }
    }
  })

  if (!hasContent || box.isEmpty()) return null

  return {
    x: (box.min.x + box.max.x) / 2,
    z: (box.min.z + box.max.z) / 2,
  }
}

/**
 * Derive FSM state from editor state (matches LevelHoverManager logic)
 */
function deriveViewerState(
  buildingId: string | undefined,
  selectedNodeIds: string[],
  selectedFloorId: string | null,
  selectedZoneId: string | null,
): 'idle' | 'building' | 'level' | 'zone' | 'node' {
  const hasBuilding = buildingId && selectedNodeIds.includes(buildingId)
  const hasFloor = !!selectedFloorId
  const hasZone = !!selectedZoneId
  const hasNodes = selectedNodeIds.length > 0 && !selectedNodeIds.includes(buildingId!)

  if (hasNodes) return 'node'
  if (hasZone) return 'zone'
  if (hasFloor) return 'level'
  if (hasBuilding) return 'building'
  return 'idle'
}

export function ViewerCustomControls() {
  const cameraMode = useEditor((state) => state.cameraMode)
  const setMovingCamera = useEditor((state) => state.setMovingCamera)
  const controls = useThree((state) => state.controls)
  const { scene } = useThree()
  const controlsRef = useRef<CameraControlsImpl>(null)
  const currentLevel = useEditor((state) => state.currentLevel)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levelMode = useEditor((state) => state.levelMode)
  const selectedZoneId = useEditor((state) => state.selectedZoneId)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)

  // Get building ID for camera focus when no level is selected
  const buildingId = useEditor(
    (state) => state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')?.id,
  )

  // Derive current FSM state
  const viewerState = useMemo(
    () => deriveViewerState(buildingId, selectedNodeIds, selectedFloorId, selectedZoneId),
    [buildingId, selectedNodeIds, selectedFloorId, selectedZoneId],
  )

  // Get site node to check for camera preference
  const site = useEditor(useShallow((state) => state.scene.root.children?.[0]))

  // Get all zones from the store
  const allZones = useEditor(useShallow((state: StoreState) => state.scene.zones || []))

  // Get the selected collection's nodeIds for bounds calculation
  const collectionNodeIds = useEditor(
    useShallow((state: StoreState) => {
      if (!state.selectedCollectionId) return null
      const collection = state.scene.collections?.find((c) => c.id === state.selectedCollectionId)
      return collection?.nodeIds || null
    }),
  )

  // Get the selected zone's data for bounds calculation
  const selectedZoneData = useMemo(() => {
    if (!selectedZoneId) return null
    const zone = allZones.find((c) => c.id === selectedZoneId)
    if (!zone) return null
    return { polygon: zone.polygon, levelId: zone.levelId }
  }, [selectedZoneId, allZones])

  // Get building levels for Y offset calculation
  const buildingLevels = useEditor((state) => {
    const site = state.scene.root.children?.[0]
    const building = site?.children?.find((c) => c.type === 'building')
    return building?.children ?? []
  })

  // Memoize level data to avoid recalculating on every render
  const levelData = useMemo(() => {
    const data: Record<string, { level: number; elevation: number }> = {}
    for (const lvl of buildingLevels) {
      if (lvl.type === 'level') {
        data[lvl.id] = {
          level: (lvl as any).level ?? 0,
          elevation: (lvl as any).elevation ?? 0,
        }
      }
    }
    return data
  }, [buildingLevels])

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

  // Focus on building in idle state (initial load) or building state (after clicking building)
  useEffect(() => {
    if (!(controls && scene && buildingId)) return
    // Only run for idle or building states
    if (viewerState !== 'idle' && viewerState !== 'building') return

    const cameraImpl = controls as CameraControlsImpl

    // If site has camera settings and we're in idle state, prioritize them for initial load
    if (viewerState === 'idle' && site?.camera) {
      const { position, target, mode } = site.camera

      // Switch mode if needed
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
          cameraImpl.setLookAt(d, d, d, 0, 0, 0, viewerState === 'building')
          cameraImpl.setBoundary()
        }
        return
      }

      // Calculate precise XZ center using local bounds
      const center = calculateLocalBoundsCenter(buildingObject)
      if (!center) {
        const d = VIEWER_INITIAL_CAMERA_DISTANCE
        cameraImpl.setLookAt(d, d, d, 0, 0, 0, viewerState === 'building')
        cameraImpl.setBoundary()
        return
      }

      // Calculate Y center from bounding box (this is less affected by animation)
      const buildingBox = new Box3().setFromObject(buildingObject)
      const boxCenter = buildingBox.getCenter(new Vector3())
      const size = buildingBox.getSize(new Vector3())

      // For building state (exploded view), adjust center Y to account for spread floors
      const adjustedCenterY = viewerState === 'building'
        ? boxCenter.y + (size.y * 0.3) // Shift focus slightly up to see exploded floors better
        : boxCenter.y

      // Use fixed default distance for consistent behavior
      const newDistance = VIEWER_INITIAL_CAMERA_DISTANCE

      // Position camera at 45-degree angle looking at building center (using precise XZ)
      cameraImpl.setLookAt(
        center.x + newDistance,
        adjustedCenterY + newDistance,
        center.z + newDistance,
        center.x,
        adjustedCenterY,
        center.z,
        viewerState === 'building', // animate transition when entering building state
      )
      cameraImpl.setBoundary() // Remove boundaries for free viewing
    }

    checkBuilding()

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
    }
  }, [controls, scene, viewerState, buildingId, site])

  // Focus on level when in level state
  useEffect(() => {
    if (!(controls && scene && selectedFloorId)) return
    // Only run for level state (not zone, not node)
    if (viewerState !== 'level') return

    const cameraImpl = controls as CameraControlsImpl

    // Calculate floor Y position accounting for exploded mode
    const lvlData = levelData[selectedFloorId]
    const levelOffset = levelMode === 'exploded' ? (lvlData?.level ?? 0) * FLOOR_SPACING : 0
    const floorY = (lvlData?.elevation ?? 0) + levelOffset

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
      // Find the level object to get its center (XZ only, Y is calculated separately)
      const levelObject = scene.getObjectByName(selectedFloorId)

      // Default target is origin at floor height
      let targetX = 0
      let targetZ = 0

      if (levelObject) {
        // Use precise XZ center calculation that ignores animated Y position
        const center = calculateLocalBoundsCenter(levelObject)
        if (center) {
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
  }, [controls, scene, viewerState, selectedFloorId, levelMode, levelData])

  // Focus camera on zone bounds when in zone state
  useEffect(() => {
    if (!(controls && scene && selectedZoneId && selectedZoneData?.polygon?.length)) return
    // Only run for zone state (not node state which may have a zone selected too)
    if (viewerState !== 'zone') return

    const cameraImpl = controls as CameraControlsImpl
    const { polygon, levelId } = selectedZoneData

    // Check if there's a view saved for this zone
    const views = useEditor.getState().scene.views || []
    const zoneView = views.find((v) =>
      v.sceneState?.visibleZoneIds?.includes(selectedZoneId),
    )

    if (zoneView) {
      // Apply the saved view's camera position
      const { position, target, mode } = zoneView.camera

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

    // No saved view - use default camera positioning based on zone polygon bounds
    // Calculate bounds from polygon points (convert grid coords to world coords)
    let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY, maxZ = Number.NEGATIVE_INFINITY

    for (const [x, z] of polygon) {
      // Convert grid coords to world coords (grid * TILE_SIZE - GRID_SIZE/2)
      const worldX = x * TILE_SIZE - GRID_SIZE / 2
      const worldZ = z * TILE_SIZE - GRID_SIZE / 2
      minX = Math.min(minX, worldX)
      maxX = Math.max(maxX, worldX)
      minZ = Math.min(minZ, worldZ)
      maxZ = Math.max(maxZ, worldZ)
    }

    // Get bounds center and size (already in world coords)
    const centerX = (minX + maxX) / 2
    const centerZ = (minZ + maxZ) / 2
    const sizeX = maxX - minX
    const sizeZ = maxZ - minZ

    // Calculate the optimal camera distance based on the bounds size
    const maxDimension = Math.max(sizeX, sizeZ)
    const padding = 2 // Add some padding around the room
    const targetDistance = (maxDimension + padding) * 0.8

    // Move camera to look at the center of the zone
    const currentPosition = new Vector3()
    cameraImpl.getPosition(currentPosition)

    // Calculate Y offset using level data (matches node-renderer logic)
    const lvlData = levelData[levelId]
    const levelOffset = levelMode === 'exploded' ? (lvlData?.level ?? 0) * FLOOR_SPACING : 0
    const floorY = (lvlData?.elevation ?? 0) + levelOffset
    const center = new Vector3(centerX, floorY, centerZ)

    // Calculate new camera position maintaining the same angle
    const direction = currentPosition.clone().sub(center).normalize()
    const newDistance = Math.max(targetDistance, 8) // Minimum distance of 8
    const newPosition = center.clone().add(direction.multiplyScalar(newDistance))

    // Smoothly transition camera to focus on zone
    cameraImpl.setLookAt(
      newPosition.x,
      Math.max(newPosition.y, floorY + 5),
      newPosition.z,
      center.x,
      floorY,
      center.z,
      true,
    )
  }, [controls, scene, viewerState, selectedZoneId, selectedZoneData, levelData, levelMode])

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

  // Focus on node camera when in node state
  useEffect(() => {
    if (!(controls && scene && selectedNodeIds.length === 1)) return
    // Only run when in node state
    if (viewerState !== 'node') return

    const nodeId = selectedNodeIds[0]
    // Skip if the selected node is the building (that's handled by building state)
    if (nodeId === buildingId) return

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
    } else {
      // No saved camera for node - focus on node bounds
      const nodeObject = scene.getObjectByName(nodeId)
      if (nodeObject) {
        const cameraImpl = controls as CameraControlsImpl
        const nodeBox = new Box3().setFromObject(nodeObject)

        if (!nodeBox.isEmpty()) {
          const center = nodeBox.getCenter(new Vector3())
          const size = nodeBox.getSize(new Vector3())

          // Calculate optimal distance based on node size
          const maxDimension = Math.max(size.x, size.y, size.z)
          const targetDistance = Math.max(maxDimension * 1.5, 8)

          // Get current camera position to maintain angle
          const currentPosition = new Vector3()
          cameraImpl.getPosition(currentPosition)

          const direction = currentPosition.clone().sub(center).normalize()
          const newPosition = center.clone().add(direction.multiplyScalar(targetDistance))

          cameraImpl.setLookAt(
            newPosition.x,
            Math.max(newPosition.y, center.y + 3),
            newPosition.z,
            center.x,
            center.y,
            center.z,
            true,
          )
        }
      }
    }
  }, [controls, scene, viewerState, selectedNodeIds, buildingId])

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
