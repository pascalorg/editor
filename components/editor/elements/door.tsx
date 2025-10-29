'use client'

import { Gltf } from '@react-three/drei'
import { memo, useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import type { Component, DoorComponentData, WallSegment } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'

const OUTLINE_RADIUS = 0.02 // 2cm radius for selection outline cylinders

// Helper function to create a cylinder between two points
function createEdgeCylinder(start: number[], end: number[]) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)

  const geometry = new THREE.CylinderGeometry(OUTLINE_RADIUS, OUTLINE_RADIUS, length, 8)
  const midpoint = new THREE.Vector3(
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
    (start[2] + end[2]) / 2,
  )

  // Calculate rotation to align cylinder with edge
  const direction = new THREE.Vector3(dx, dy, dz).normalize()
  const axis = new THREE.Vector3(0, 1, 0).cross(direction).normalize()
  const angle = Math.acos(new THREE.Vector3(0, 1, 0).dot(direction))

  return { geometry, midpoint, axis, angle }
}

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

// Helper function to check if a grid point lies on a wall segment
function isPointOnSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): boolean {
  const EPSILON = 0.001 // Tiny tolerance for floating point errors

  const px = point[0]
  const py = point[1]
  const x1 = segStart[0]
  const y1 = segStart[1]
  const x2 = segEnd[0]
  const y2 = segEnd[1]

  // Check if point is within the bounding box of the segment
  const minX = Math.min(x1, x2) - EPSILON
  const maxX = Math.max(x1, x2) + EPSILON
  const minY = Math.min(y1, y2) - EPSILON
  const maxY = Math.max(y1, y2) + EPSILON

  if (px < minX || px > maxX || py < minY || py > maxY) {
    return false
  }

  // Check if point is collinear with the segment
  // Using cross product: if (p - start) × (end - start) ≈ 0, then collinear
  const crossProduct = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1)

  return Math.abs(crossProduct) < EPSILON
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

        // Calculate the direction along the wall (normalized)
        const wallLength = Math.sqrt(dx * dx + dz * dz)
        if (wallLength > 0) {
          const wallDirX = dx / wallLength
          const wallDirZ = dz / wallLength

          // Snap nearestPoint to the nearest grid point
          const snappedGridPoint: [number, number] = [
            Math.round(nearestPoint[0]),
            Math.round(nearestPoint[1]),
          ]

          // Door visual is centered at gridPosition and extends 1 cell in EACH direction
          // So we need to check BOTH endpoints: gridPosition ± 1 in wall direction
          const gridPoint1: [number, number] = [
            snappedGridPoint[0] + Math.round(wallDirX),
            snappedGridPoint[1] + Math.round(wallDirZ),
          ]
          const gridPoint2: [number, number] = [
            snappedGridPoint[0] - Math.round(wallDirX),
            snappedGridPoint[1] - Math.round(wallDirZ),
          ]

          // Check that door placement is valid:
          // 1. Both endpoints must have a wall in the correct direction
          // 2. No point (endpoints OR center) should have a conflicting perpendicular wall
          canPlace = true

          // Check all 3 points: both endpoints AND the center
          const pointsToCheck = [gridPoint1, gridPoint2, snappedGridPoint]
          const endpointIndices = [0, 1] // First two are endpoints

          for (let i = 0; i < pointsToCheck.length; i++) {
            const gridPoint = pointsToCheck[i]
            const isEndpoint = endpointIndices.includes(i)
            let hasCorrectWall = false
            let hasConflictingWall = false

            // Check all wall segments at this grid point
            for (const wall of wallSegments) {
              // Check if the grid point lies exactly on this wall segment
              if (isPointOnSegment(gridPoint, wall.start, wall.end)) {
                // Check wall orientation
                const segDx = wall.end[0] - wall.start[0]
                const segDz = wall.end[1] - wall.start[1]
                const segAngle = Math.atan2(segDz, segDx)
                const angleDiff = Math.abs(wallAngle - segAngle)
                // Normalize angle difference to [0, PI]
                const normalizedDiff = Math.min(angleDiff, Math.abs(angleDiff - Math.PI * 2))

                if (normalizedDiff < 0.1 || Math.abs(normalizedDiff - Math.PI) < 0.1) {
                  // Wall is parallel (same or opposite direction)
                  hasCorrectWall = true
                } else {
                  // Wall has a different direction - conflict!
                  hasConflictingWall = true
                }
              }
            }

            // Endpoints must have correct wall, all points must not have conflicting walls
            if (isEndpoint && !hasCorrectWall) {
              canPlace = false
              break
            }
            if (hasConflictingWall) {
              canPlace = false
              break
            }
          }

          // Calculate centered position (average of the two endpoints = snappedGridPoint)
          centeredPosition = [
            (gridPoint1[0] + gridPoint2[0]) / 2,
            (gridPoint1[1] + gridPoint2[1]) / 2,
          ]

          if (canPlace) {
            // Check if there's already a door occupying either of our two grid points
            for (const existingDoor of existingDoors) {
              // Calculate the two ENDPOINT grid points occupied by the existing door
              // The door is centered at position and extends ±1 cell in wall direction
              // rotation = -wallAngle, so wallAngle = -rotation
              // wallDir = [cos(wallAngle), sin(wallAngle)] = [cos(-rotation), sin(-rotation)]
              const existingWallDirX = Math.cos(-existingDoor.rotation)
              const existingWallDirZ = Math.sin(-existingDoor.rotation)

              const existingGridPoint1: [number, number] = [
                existingDoor.position[0] + Math.round(existingWallDirX),
                existingDoor.position[1] + Math.round(existingWallDirZ),
              ]
              const existingGridPoint2: [number, number] = [
                existingDoor.position[0] - Math.round(existingWallDirX),
                existingDoor.position[1] - Math.round(existingWallDirZ),
              ]

              // Check if any of the existing door's grid points overlap with our grid points
              const overlap =
                (Math.abs(existingGridPoint1[0] - gridPoint1[0]) < 0.01 &&
                  Math.abs(existingGridPoint1[1] - gridPoint1[1]) < 0.01) ||
                (Math.abs(existingGridPoint1[0] - gridPoint2[0]) < 0.01 &&
                  Math.abs(existingGridPoint1[1] - gridPoint2[1]) < 0.01) ||
                (Math.abs(existingGridPoint2[0] - gridPoint1[0]) < 0.01 &&
                  Math.abs(existingGridPoint2[1] - gridPoint1[1]) < 0.01) ||
                (Math.abs(existingGridPoint2[0] - gridPoint2[0]) < 0.01 &&
                  Math.abs(existingGridPoint2[1] - gridPoint2[1]) < 0.01)

              if (overlap) {
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
        gridPosition: shouldSnap ? [Math.round(nearestPoint[0]), Math.round(nearestPoint[1])] as [number, number] : mouseGridPosition, // Snapped grid point
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

  // Calculate corners for edge rendering (door occupies 2x2 cells)
  const halfWidth = tileSize
  const halfDepth = tileSize

  const bottomCorners = [
    [-halfWidth, 0, -halfDepth],
    [halfWidth, 0, -halfDepth],
    [halfWidth, 0, halfDepth],
    [-halfWidth, 0, halfDepth],
  ]

  const topCorners = [
    [-halfWidth, wallHeight, -halfDepth],
    [halfWidth, wallHeight, -halfDepth],
    [halfWidth, wallHeight, halfDepth],
    [-halfWidth, wallHeight, halfDepth],
  ]

  return (
    <group position={[worldX, 0, worldZ]} rotation={[0, rotation, 0]}>
      <group position={[0.42, 0, 0]} scale={[0.5, 0.5, 1.2]}>
        <Gltf src="/models/Door.glb" />
      </group>

      {/* Selection outline - 3D cylinders (same as walls) */}
      {isSelected && (
        <>
          {(() => {
            const edges = []
            // Bottom rectangle edges
            for (let j = 0; j < bottomCorners.length; j++) {
              edges.push([bottomCorners[j], bottomCorners[(j + 1) % bottomCorners.length]])
            }
            // Top rectangle edges
            for (let j = 0; j < topCorners.length; j++) {
              edges.push([topCorners[j], topCorners[(j + 1) % topCorners.length]])
            }
            // Vertical edges connecting bottom to top
            for (let j = 0; j < bottomCorners.length; j++) {
              edges.push([bottomCorners[j], topCorners[j]])
            }

            return edges.map((edge, idx) => {
              const { geometry: cylGeom, midpoint, axis, angle } = createEdgeCylinder(edge[0], edge[1])
              return (
                <mesh
                  geometry={cylGeom}
                  key={idx}
                  position={midpoint}
                  quaternion={new THREE.Quaternion().setFromAxisAngle(axis, angle)}
                  renderOrder={999}
                >
                  <meshStandardMaterial
                    color="#ffffff"
                    depthTest={false}
                    emissive="#ffffff"
                    emissiveIntensity={0.5}
                  />
                </mesh>
              )
            })
          })()}
        </>
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
