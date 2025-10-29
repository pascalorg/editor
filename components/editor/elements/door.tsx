'use client'

import { Gltf } from '@react-three/drei'
import { memo, useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import type { Component, DoorComponentData, WallSegment } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import { validateWallElementPlacement } from '@/lib/wall-element-validation'

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

type DoorPlacementPreviewProps = {
  mouseGridPosition: [number, number] | null // Mouse position in grid coordinates
  wallSegments: WallSegment[]
  existingDoors: Array<{ position: [number, number]; rotation: number }>
  existingWindows: Array<{ position: [number, number]; rotation: number }>
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
    existingWindows,
    tileSize,
    wallHeight,
    floorId,
    onPlaced,
  }: DoorPlacementPreviewProps) => {
    // Track the last valid rotation to maintain it when preview becomes invalid
    const lastValidRotationRef = useRef<number>(0)

    // Calculate placement data based on mouse position and nearby walls
    const placement = useMemo(() => {
      // Combine existing doors and windows to check for conflicts with both
      const existingElements = [...existingDoors, ...existingWindows]

      const result = validateWallElementPlacement({
        mouseGridPosition,
        wallSegments,
        existingElements,
        elementWidth: 2, // Doors are 2 cells wide
      })

      if (!result) return null

      // Update last valid rotation if we found a valid wall
      if (result.nearestWall && result.rotation !== 0) {
        lastValidRotationRef.current = result.rotation
      }

      return {
        gridPosition: result.gridPosition,
        centeredPosition: result.centeredPosition,
        canPlace: result.canPlace,
        rotation: result.nearestWall ? result.rotation : lastValidRotationRef.current,
        nearestWall: result.nearestWall,
      }
    }, [mouseGridPosition, wallSegments, existingDoors, existingWindows])

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
