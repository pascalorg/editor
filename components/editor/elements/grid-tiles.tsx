'use client'

import { emitter } from '@/events/bus'
import { useEditor, type WallSegment } from '@/hooks/use-editor'
import { useWalls } from '@/hooks/use-nodes'
import { type CameraControlsImpl, useCursor } from '@react-three/drei'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { memo, useCallback, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { GRID_INTERSECTIONS, TILE_SIZE } from '..'

const GRID_SIZE = 30 // 30m x 30m

export const GridTiles = memo(() => {
  const activeTool = useEditor((state) => state.activeTool)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const meshRef = useRef<THREE.Mesh>(null)

  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastClickTimeRef = useRef<number>(0)

  // Get all wall nodes for the active floor (needed for room and custom-room modes)
  const wallNodes = useWalls(selectedFloorId || '')
  const allWallSegments: WallSegment[] = useMemo(
    () =>
      wallNodes.map((node) => {
        const [x1, y1] = node.position
        const length = node.size[0]
        const rotation = node.rotation
        const x2 = x1 + Math.cos(rotation) * length
        const y2 = y1 + Math.sin(rotation) * length

        return {
          id: node.id,
          start: [x1, y1],
          end: [x2, y2],
          isHorizontal: Math.abs(Math.sin(rotation)) < 0.1,
          visible: node.visible ?? true,
          opacity: node.opacity ?? 100,
        }
      }),
    [wallNodes],
  )

  const gridSize = (GRID_INTERSECTIONS - 1) * TILE_SIZE
  const hoveredIntersection = useRef<{ x: number; y: number } | null>(null)
  const setPointerPosition = useEditor((state) => state.setPointerPosition)
  const movingCamera = useEditor((state) => state.movingCamera)
  const controlMode = useEditor((state) => state.controlMode)
  const handleIntersectionClick = useCallback(
    (x: number, y: number) => {
      // Don't handle clicks while camera is moving
      if (movingCamera) return

      emitter.emit('grid:click', {
        position: [x, y],
      })
    },
    [movingCamera],
  )

  const handleIntersectionDoubleClick = useCallback(() => {
    // Don't handle double-clicks while camera is moving
    if (movingCamera) return

    emitter.emit('grid:double-click', {
      position: [0, 0],
    })
  }, [movingCamera])

  const handleIntersectionHover = useCallback(
    (x: number, y: number | null) => {
      if (y === null) return

      emitter.emit('grid:move', {
        position: [x, y],
      })
      // Update cursor position for proximity grid on non-base levels
      if (y !== null) {
        setPointerPosition([x, y])
      } else {
        setPointerPosition(null)
      }
    },
    [setPointerPosition],
  )

  const handlePointerLeave = useCallback(() => {
    hoveredIntersection.current = null
    setPointerPosition(null)
  }, [setPointerPosition])

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()

    // Don't show hover indicators in guide mode (reserved for image manipulation)
    if (controlMode === 'guide') {
      hoveredIntersection.current = null
      setPointerPosition(null)
      return
    }

    if (e.point) {
      // e.point is in world coordinates
      // The parent group is offset by [-GRID_SIZE/2, 0, -GRID_SIZE/2]
      // Convert world coords to local coords by adding the offset back
      const localX = e.point.x + GRID_SIZE / 2
      const localZ = e.point.z + GRID_SIZE / 2

      // Round to nearest intersection
      const x = Math.round(localX / TILE_SIZE)
      const y = Math.round(localZ / TILE_SIZE) // y in grid space is z in 3D space

      if (x >= 0 && x < GRID_INTERSECTIONS && y >= 0 && y < GRID_INTERSECTIONS) {
        hoveredIntersection.current = { x, y }
        handleIntersectionHover(x, y)
      } else {
        hoveredIntersection.current = null
        setPointerPosition(null)
      }
    }
  }

  const rightClickDownAt = useRef(0)

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button === 2) {
      rightClickDownAt.current = Date.now()
    }
    // Only handle left-click (button 0) for wall placement
    // Right-click (button 2) and middle-click (button 1) are for camera controls
    if (e.button !== 0) return

    e.stopPropagation()

    // Special handling for guide mode - allow clicks for deselection
    if (controlMode === 'guide') {
      handleIntersectionClick(0, 0) // Trigger deselection (coordinates don't matter)
      return
    }

    const now = Date.now()
    const timeSinceLastClick = now - lastClickTimeRef.current

    // Detect double-click within 300ms
    if (timeSinceLastClick < 300) {
      // This is a double-click
      handleIntersectionDoubleClick()
      lastClickTimeRef.current = 0 // Reset to prevent triple-click issues
    } else {
      handleIntersectionClick(
        hoveredIntersection.current?.x || 0,
        hoveredIntersection.current?.y || 0,
      )
      lastClickTimeRef.current = now
    }
  }

  const controls = useThree((state) => state.controls)

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button === 2) {
        const now = Date.now()
        const timeHeld = now - rightClickDownAt.current
        // If right-click was held for less than 200ms, treat it as a click to recenter
        if (timeHeld < 200 && e.point) {
          ;(controls as CameraControlsImpl).moveTo(e.point.x, e.point.y, e.point.z, true)
        }
      }
    },
    [controls],
  )

  useCursor(controlMode === 'select')

  return (
    <>
      {controlMode !== 'select' && <DownArrow />}
      {/* Invisible plane for raycasting */}
      <mesh
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        position={[gridSize / 2, 0.002, gridSize / 2]}
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[gridSize, gridSize]} />
        <meshStandardMaterial
          color="#404045"
          colorWrite={false}
          depthWrite={false}
          opacity={0}
          transparent
        />
      </mesh>
    </>
  )
})

GridTiles.displayName = 'GridTiles'

// Down arrow component (2m height, pointing down along -Y axis)
const DownArrow = () => {
  const shaftHeight = 1.7
  const coneHeight = 0.3
  const shaftRadius = 0.03
  const coneRadius = 0.1

  const cursorPosition = useEditor((state) => state.pointerPosition)

  if (!cursorPosition) return null

  return (
    <group position={[cursorPosition[0] * TILE_SIZE, 2, cursorPosition[1] * TILE_SIZE]}>
      {/* Shaft - cylinder is created along Y-axis, no rotation needed */}
      <mesh position={[0, -shaftHeight / 2, 0]}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftHeight, 8]} />
        <meshStandardMaterial color="white" depthTest={false} opacity={0.8} transparent />
      </mesh>
      {/* Cone tip - cone points up by default along Y, rotate 180° to point down */}
      <mesh position={[0, -(shaftHeight + coneHeight / 2), 0]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[coneRadius, coneHeight, 8]} />
        <meshStandardMaterial color="white" depthTest={false} opacity={0.8} transparent />
      </mesh>
    </group>
  )
}

// Delete plane preview component - shows transparent red plane for deletion area
type DeletePlanePreviewProps = {
  start: [number, number]
  end: [number, number]
  tileSize: number
  wallHeight: number
}

const DeletePlanePreview = memo(({ start, end, tileSize, wallHeight }: DeletePlanePreviewProps) => {
  const [x1, y1] = start
  const [x2, y2] = end

  // Calculate dimensions
  const dx = x2 - x1
  const dz = y2 - y1 // y coordinates from grid are z in 3D space
  const baseLength = Math.sqrt(dx * dx + dz * dz) * tileSize
  const thickness = 0.2 // Same as WALL_THICKNESS
  // Extend by half thickness on each end
  const length = baseLength + thickness
  const height = wallHeight

  // Calculate center position (x-z plane is ground, y is up)
  const centerX = ((x1 + x2) / 2) * tileSize
  const centerZ = ((y1 + y2) / 2) * tileSize

  // Calculate rotation around Y axis (vertical)
  // Note: negative dz because Three.js Y-axis rotation transforms local X as (cos(θ), 0, -sin(θ))
  const angle = Math.atan2(-dz, dx)

  return (
    <group position={[centerX, height / 2, centerZ]} rotation={[0, angle, 0]}>
      <mesh>
        <boxGeometry args={[length, height, thickness]} />
        <meshStandardMaterial
          color="#ff4444"
          depthTest={false}
          emissive="#aa2222"
          emissiveIntensity={0.5}
          opacity={0.5}
          transparent
        />
      </mesh>
    </group>
  )
})

DeletePlanePreview.displayName = 'DeletePlanePreview'
