'use client'

import { Gltf } from '@react-three/drei'
import { memo, useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import type { Component, DoorComponentData, WallSegment } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'

// Helper function to find the closest point on a line segment
function closestPointOnSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): { point: [number, number]; distance: number } {
  const px = point[0]
  const py = point[1]
  const x1 = segStart[0]
  const y1 = segStart[1]
  const x2 = segEnd[0]
  const y2 = segEnd[1]

  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    // Segment is a point
    const dist = Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    return { point: [x1, y1], distance: dist }
  }

  // Calculate parameter t along the line
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t)) // Clamp to segment

  const closestX = x1 + t * dx
  const closestY = y1 + t * dy
  const distance = Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2)

  return { point: [closestX, closestY], distance }
}

type DoorPlacementPreviewProps = {
  mouseGridPosition: [number, number] | null // Mouse position in grid coordinates
  wallSegments: WallSegment[]
  existingDoors: Array<{ position: [number, number]; rotation: number }>
  tileSize: number
  wallHeight: number
  floorId: string
  onPlaced?: () => void // Callback when door is placed
}

export const DoorPlacementPreview = memo(
  ({
    mouseGridPosition,
    wallSegments,
    existingDoors,
    tileSize,
    wallHeight,
    floorId,
    onPlaced,
  }: DoorPlacementPreviewProps) => {
    // Track the last valid rotation to maintain it when preview becomes invalid
    const lastValidRotationRef = useRef<number>(0)

    // Calculate placement data based on mouse position and nearby walls
    const placement = useMemo(() => {
      if (!mouseGridPosition) return null

      // Find nearest wall and snap to it
      let nearestWall: WallSegment | null = null
      let nearestPoint: [number, number] = mouseGridPosition
      let minDistance = Number.POSITIVE_INFINITY

      for (const wall of wallSegments) {
        const result = closestPointOnSegment(mouseGridPosition, wall.start, wall.end)
        if (result.distance < minDistance) {
          minDistance = result.distance
          nearestPoint = result.point
          nearestWall = wall
        }
      }

      const SNAP_THRESHOLD = 0.5 // 0.5 grid units (0.25m)

      // Only consider snapping if we're close enough to a wall
      const shouldSnap = nearestWall !== null && minDistance <= SNAP_THRESHOLD
      let canPlace = false

      let rotation = 0
      let centeredPosition = nearestPoint
      if (shouldSnap && nearestWall) {
        // Calculate wall direction
        const dx = nearestWall.end[0] - nearestWall.start[0]
        const dz = nearestWall.end[1] - nearestWall.start[1]
        const wallAngle = Math.atan2(dz, dx)
        rotation = -wallAngle

        canPlace = true // Start as true, will be checked further below

        // Door needs 2 cells width - check if there's continuous wall coverage
        // Calculate the direction along the wall (normalized)
        const wallLength = Math.sqrt(dx * dx + dz * dz)
        if (wallLength > 0) {
          const wallDirX = dx / wallLength
          const wallDirZ = dz / wallLength

          // Define the 2-cell span we need to cover (check multiple points along the span)
          const numCheckPoints = 5 // Check 5 points along the 2-cell span for continuous coverage
          let hasContinuousWall = true

          for (let i = 0; i <= numCheckPoints; i++) {
            const t = (i / numCheckPoints) * 1.0 // 0 to 1.0 (checking 1 full cell span)
            const checkPoint: [number, number] = [
              nearestPoint[0] + wallDirX * t,
              nearestPoint[1] + wallDirZ * t,
            ]

            // Check if there's a wall at this point with the same orientation
            let foundWallAtPoint = false
            for (const wall of wallSegments) {
              const result = closestPointOnSegment(checkPoint, wall.start, wall.end)
              if (result.distance <= SNAP_THRESHOLD) {
                // Check if this wall has the same orientation
                const adjDx = wall.end[0] - wall.start[0]
                const adjDz = wall.end[1] - wall.start[1]
                const adjAngle = Math.atan2(adjDz, adjDx)
                const angleDiff = Math.abs(wallAngle - adjAngle)
                // Allow small angle difference (normalize for angles wrapping around)
                const normalizedDiff = Math.min(angleDiff, Math.abs(angleDiff - Math.PI * 2))
                if (normalizedDiff < 0.1) {
                  // ~5.7 degrees tolerance
                  foundWallAtPoint = true
                  break
                }
              }
            }

            if (!foundWallAtPoint) {
              hasContinuousWall = false
              break
            }
          }

          canPlace = canPlace && hasContinuousWall

          // Always calculate centered position when snapped (even if can't place, for visualization)
          // Center position for door placement (offset by 0.5 cells along wall)
          centeredPosition = [nearestPoint[0] + wallDirX * 0.5, nearestPoint[1] + wallDirZ * 0.5]

          if (canPlace) {
            // Check if there's already a door at or near this position
            const DOOR_COLLISION_THRESHOLD = 1.5 // 1.5 grid units
            for (const existingDoor of existingDoors) {
              const dx = centeredPosition[0] - existingDoor.position[0]
              const dz = centeredPosition[1] - existingDoor.position[1]
              const distance = Math.sqrt(dx * dx + dz * dz)
              if (distance < DOOR_COLLISION_THRESHOLD) {
                canPlace = false
                break
              }
            }
          }
        }
      }

      // Update last valid rotation if we found a valid wall
      if (shouldSnap && rotation !== 0) {
        lastValidRotationRef.current = rotation
      }

      return {
        gridPosition: shouldSnap ? nearestPoint : mouseGridPosition, // Only snap when close to wall
        centeredPosition: shouldSnap ? centeredPosition : mouseGridPosition, // Centered position for door model
        canPlace,
        rotation: shouldSnap ? rotation : lastValidRotationRef.current, // Use last valid rotation when not snapped
        nearestWall: shouldSnap ? nearestWall : null,
      }
    }, [mouseGridPosition, wallSegments, existingDoors])

    // Create rectangle geometry (2 cells along wall, 2 cells perpendicular)
    // Must be before early return to avoid conditional hooks
    const rectangleGeometry = useMemo(() => {
      const width = tileSize * 2 // Width along the wall (2 cells)
      const depth = tileSize * 2 // Depth perpendicular to wall (1 cell front, 1 cell back)
      const geometry = new THREE.PlaneGeometry(width, depth)
      geometry.rotateX(-Math.PI / 2) // Rotate to lie flat on ground
      return geometry
    }, [tileSize])

    // Handle click to place door
    const addComponent = useEditor((state) => state.addComponent)

    const handleClick = useCallback(() => {
      if (!(placement?.canPlace && placement?.nearestWall)) {
        return
      }

      // Create door component
      const doorId = `door_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const doorComponent: Component = {
        id: doorId,
        type: 'door',
        group: floorId,
        label: 'Door',
        createdAt: new Date().toISOString(),
        data: {
          position: placement.gridPosition,
          rotation: placement.rotation,
          width: 2,
        } as DoorComponentData,
      }

      // Add door to components using store method
      addComponent(doorComponent)

      // Notify parent component
      onPlaced?.()
    }, [placement, floorId, onPlaced, addComponent])

    if (!placement) {
      return null
    }

    // Convert grid position to world position for the rectangle
    const worldX = placement.gridPosition[0] * tileSize
    const worldZ = placement.gridPosition[1] * tileSize

    // Color based on whether we can place
    const color = placement.canPlace ? '#44ff44' : '#ff4444'

    return (
      <group
        onClick={handleClick}
        position={[worldX, 0, worldZ]}
        rotation={[0, placement.rotation, 0]}
      >
        {/* Placement indicator rectangle on ground */}
        <mesh geometry={rectangleGeometry} position={[0, 0.01, 0]}>
          <meshStandardMaterial
            color={color}
            depthTest={false}
            depthWrite={false}
            opacity={0.3}
            transparent
          />
        </mesh>

        {/* Door model - offset to center on 2-cell width (X-axis only) */}
        <group position={[0.42, 0, 0]} scale={[0.5, 0.5, 1.2]}>
          <Gltf src="/models/Door.glb" />
        </group>
      </group>
    )
  },
)

DoorPlacementPreview.displayName = 'DoorPlacementPreview'

// Single door component
type DoorProps = {
  doorId: string
  position: [number, number]
  rotation: number
  tileSize: number
  wallHeight: number
}

const Door = memo(({ doorId, position, rotation, tileSize, wallHeight }: DoorProps) => {
  const worldX = position[0] * tileSize
  const worldZ = position[1] * tileSize
  const selectedElements = useEditor((state) => state.selectedElements)

  // Check if this door is selected
  const isSelected = selectedElements.some((el) => el.id === doorId && el.type === 'door')

  return (
    <group position={[worldX, 0, worldZ]} rotation={[0, rotation, 0]}>
      <group position={[0.42, 0, 0]} scale={[0.5, 0.5, 1.2]}>
        <Gltf src="/models/Door.glb" />
      </group>

      {/* Box helper when selected - shows door bounds */}
      {isSelected && (
        <mesh position={[0, wallHeight / 2, 0]}>
          <boxGeometry args={[tileSize * 2, wallHeight, tileSize * 2]} />
          <meshBasicMaterial color="#44ff44" opacity={0.4} transparent wireframe />
        </mesh>
      )}
    </group>
  )
})

Door.displayName = 'Door'

// Component to render all placed doors for a floor
type DoorsProps = {
  floorId: string
  tileSize: number
  wallHeight: number
}

export const Doors = memo(({ floorId, tileSize, wallHeight }: DoorsProps) => {
  // Fetch door components for this floor from the store
  const doorComponents = useEditor(
    useShallow((state) => state.components.filter((c) => c.type === 'door' && c.group === floorId)),
  )

  if (doorComponents.length === 0) return null

  return (
    <group>
      {doorComponents.map((component) => {
        if (component.type !== 'door') return null

        const { position, rotation } = component.data

        return (
          <Door
            doorId={component.id}
            key={component.id}
            position={position}
            rotation={rotation}
            tileSize={tileSize}
            wallHeight={wallHeight}
          />
        )
      })}
    </group>
  )
})

Doors.displayName = 'Doors'
