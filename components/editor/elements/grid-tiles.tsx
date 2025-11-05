'use client'

import { type CameraControlsImpl, Line } from '@react-three/drei'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { useEditor, type WallSegment } from '@/hooks/use-editor'
import { useWalls } from '@/hooks/use-nodes'
import { RoofShadowPreview } from './roof'

const GRID_SIZE = 30 // 30m x 30m

type GridTilesProps = {
  intersections: number
  tileSize: number
  onIntersectionClick: (x: number, y: number) => void
  onIntersectionDoubleClick: () => void
  onIntersectionHover: (x: number, y: number | null) => void
  wallPreviewEnd: [number, number] | null
  roofStartPoint: [number, number] | null
  roofPreviewEnd: [number, number] | null
  deleteStartPoint: [number, number] | null
  deletePreviewEnd: [number, number] | null
  opacity: number
  disableBuild?: boolean
  wallHeight: number
  controlMode: 'select' | 'delete' | 'building' | 'guide'
}

export const GridTiles = memo(
  ({
    intersections,
    tileSize,
    onIntersectionClick,
    onIntersectionDoubleClick,
    onIntersectionHover,
    wallPreviewEnd,
    roofStartPoint,
    roofPreviewEnd,
    deleteStartPoint,
    deletePreviewEnd,
    opacity,
    disableBuild = false,
    wallHeight,
    controlMode,
  }: GridTilesProps) => {
    const activeTool = useEditor((state) => state.activeTool)
    const selectedFloorId = useEditor((state) => state.selectedFloorId)
    const meshRef = useRef<THREE.Mesh>(null)
    const [hoveredIntersection, setHoveredIntersection] = useState<{ x: number; y: number } | null>(
      null,
    )
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

    const gridSize = (intersections - 1) * tileSize

    const handlePointerLeave = useCallback(() => {
      setHoveredIntersection(null)
      onIntersectionHover(0, null)
    }, [onIntersectionHover])

    const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()

      // Don't show hover indicators in guide mode (reserved for image manipulation)
      if (controlMode === 'guide') {
        setHoveredIntersection(null)
        onIntersectionHover(0, null)
        return
      }

      if (e.point && !disableBuild) {
        // e.point is in world coordinates
        // The parent group is offset by [-GRID_SIZE/2, 0, -GRID_SIZE/2]
        // Convert world coords to local coords by adding the offset back
        const localX = e.point.x + GRID_SIZE / 2
        const localZ = e.point.z + GRID_SIZE / 2

        // Round to nearest intersection
        const x = Math.round(localX / tileSize)
        const y = Math.round(localZ / tileSize) // y in grid space is z in 3D space

        if (x >= 0 && x < intersections && y >= 0 && y < intersections) {
          setHoveredIntersection({ x, y })
          onIntersectionHover(x, y)
        } else {
          setHoveredIntersection(null)
          onIntersectionHover(0, null)
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
        onIntersectionClick(0, 0) // Trigger deselection (coordinates don't matter)
        return
      }

      if (disableBuild || !hoveredIntersection) return

      const now = Date.now()
      const timeSinceLastClick = now - lastClickTimeRef.current

      // Detect double-click within 300ms
      if (activeTool === 'custom-room' && timeSinceLastClick < 300) {
        // This is a double-click
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current)
          clickTimeoutRef.current = null
        }
        onIntersectionDoubleClick()
        lastClickTimeRef.current = 0 // Reset to prevent triple-click issues
      } else {
        // Single click
        if (activeTool === 'custom-room') {
          // For custom-room mode, delay the click to check if it's part of a double-click
          if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current)
          }
          clickTimeoutRef.current = setTimeout(() => {
            onIntersectionClick(hoveredIntersection.x, hoveredIntersection.y)
            clickTimeoutRef.current = null
          }, 300)
        } else {
          // For other modes, handle click immediately
          onIntersectionClick(hoveredIntersection.x, hoveredIntersection.y)
        }
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

    return (
      <>
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

        {/* Down arrow at hovered intersection or snapped preview position */}
        {hoveredIntersection &&
          !disableBuild &&
          activeTool !== 'door' &&
          activeTool !== 'window' && (
            <group
              position={[
                // For wall mode, use wallPreviewEnd for snapped position
                // For delete mode, use deletePreviewEnd for snapped position
                // For other modes, use the raw hovered intersection
                activeTool === 'wall' && wallPreviewEnd
                  ? wallPreviewEnd[0] * tileSize
                  : controlMode === 'delete' && deletePreviewEnd
                    ? deletePreviewEnd[0] * tileSize
                    : hoveredIntersection.x * tileSize,
                2,
                activeTool === 'wall' && wallPreviewEnd
                  ? wallPreviewEnd[1] * tileSize
                  : controlMode === 'delete' && deletePreviewEnd
                    ? deletePreviewEnd[1] * tileSize
                    : hoveredIntersection.y * tileSize,
              ]}
            >
              <DownArrow />
            </group>
          )}

        {/* Roof mode preview - rectangular base outline + 3D roof geometry */}
        {roofStartPoint && roofPreviewEnd && activeTool === 'roof' && (
          <>
            {/* Start point indicator */}
            <mesh position={[roofStartPoint[0] * tileSize, 0.01, roofStartPoint[1] * tileSize]}>
              <sphereGeometry args={[0.1, 16, 16]} />
              <meshStandardMaterial color="#44ff44" depthTest={false} emissive="#22aa22" />
            </mesh>

            {/* Preview rectangular outline on ground (base footprint) */}
            {/* Occluded version - dimmer */}
            <Line
              color="#336633"
              dashed={false}
              depthTest={false}
              lineWidth={2}
              opacity={0.3}
              points={[
                [roofStartPoint[0] * tileSize, 0.1, roofStartPoint[1] * tileSize],
                [roofPreviewEnd[0] * tileSize, 0.1, roofStartPoint[1] * tileSize],
                [roofPreviewEnd[0] * tileSize, 0.1, roofPreviewEnd[1] * tileSize],
                [roofStartPoint[0] * tileSize, 0.1, roofPreviewEnd[1] * tileSize],
                [roofStartPoint[0] * tileSize, 0.1, roofStartPoint[1] * tileSize],
              ]}
              transparent
            />
            {/* Visible version - brighter */}
            <Line
              color="#44ff44"
              dashed={false}
              depthTest={true}
              lineWidth={3}
              points={[
                [roofStartPoint[0] * tileSize, 0.1, roofStartPoint[1] * tileSize],
                [roofPreviewEnd[0] * tileSize, 0.1, roofStartPoint[1] * tileSize],
                [roofPreviewEnd[0] * tileSize, 0.1, roofPreviewEnd[1] * tileSize],
                [roofStartPoint[0] * tileSize, 0.1, roofPreviewEnd[1] * tileSize],
                [roofStartPoint[0] * tileSize, 0.1, roofStartPoint[1] * tileSize],
              ]}
            />

            {/* 3D roof preview - calculate ridge from base corners */}
            {(() => {
              const [x1, y1] = roofStartPoint
              const [x2, y2] = roofPreviewEnd
              const width = Math.abs(x2 - x1)
              const depth = Math.abs(y2 - y1)

              // Calculate ridge line along the longer axis
              const minX = Math.min(x1, x2)
              const maxX = Math.max(x1, x2)
              const minY = Math.min(y1, y2)
              const maxY = Math.max(y1, y2)
              const centerX = (minX + maxX) / 2
              const centerY = (minY + maxY) / 2

              let ridgeStart: [number, number]
              let ridgeEnd: [number, number]
              let roofWidth: number // Distance from ridge to each edge

              if (width >= depth) {
                // Ridge runs along X axis (longer side)
                ridgeStart = [minX, centerY]
                ridgeEnd = [maxX, centerY]
                roofWidth = (depth * tileSize) / 2
              } else {
                // Ridge runs along Y axis (longer side)
                ridgeStart = [centerX, minY]
                ridgeEnd = [centerX, maxY]
                roofWidth = (width * tileSize) / 2
              }

              return (
                <RoofShadowPreview
                  baseHeight={wallHeight}
                  end={ridgeEnd}
                  leftWidth={roofWidth}
                  rightWidth={roofWidth}
                  start={ridgeStart}
                  tileSize={tileSize}
                />
              )
            })()}
          </>
        )}

        {/* Delete mode preview - red line and plane */}
        {controlMode === 'delete' && deleteStartPoint && (
          <>
            {/* Start point indicator for delete mode */}
            <mesh position={[deleteStartPoint[0] * tileSize, 0.01, deleteStartPoint[1] * tileSize]}>
              <sphereGeometry args={[0.1, 16, 16]} />
              <meshStandardMaterial color="#ff4444" depthTest={false} emissive="#aa2222" />
            </mesh>

            {/* Preview line and transparent red plane when selecting deletion area */}
            {deletePreviewEnd && (
              <>
                <Line
                  color="#ff4444"
                  dashed={false}
                  depthTest={false}
                  lineWidth={3}
                  points={[
                    [deleteStartPoint[0] * tileSize, 0.1, deleteStartPoint[1] * tileSize],
                    [deletePreviewEnd[0] * tileSize, 0.1, deletePreviewEnd[1] * tileSize],
                  ]}
                />

                {/* Transparent red plane showing what will be deleted */}
                <DeletePlanePreview
                  end={deletePreviewEnd}
                  start={deleteStartPoint}
                  tileSize={tileSize}
                  wallHeight={wallHeight}
                />
              </>
            )}
          </>
        )}
      </>
    )
  },
)

GridTiles.displayName = 'GridTiles'

// Down arrow component (2m height, pointing down along -Y axis)
const DownArrow = () => {
  const shaftHeight = 1.7
  const coneHeight = 0.3
  const shaftRadius = 0.03
  const coneRadius = 0.1

  return (
    <group>
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
