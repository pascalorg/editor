'use client'

import { Gltf, useGLTF } from '@react-three/drei'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { WallSegment } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import { useDoors } from '@/hooks/use-nodes'
import { handleElementClick } from '@/lib/building-elements'
import { createId } from '@/lib/utils'
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
    const levels = useEditor((state) => state.levels)
    const updateLevels = useEditor((state) => state.updateLevels)

    const handleClick = useCallback(() => {
      if (!(placement?.canPlace && placement?.nearestWall)) {
        return
      }

      // Create door node
      const doorNode = {
        id: createId('door'),
        type: 'door' as const,
        name: 'Door',
        position: placement.gridPosition,
        rotation: placement.rotation,
        size: [1, 2] as [number, number], // 1m x 2m door
        visible: true,
        opacity: 100,
        children: [] as [],
      }

      // Add door to the nearest wall using node operations
      const wallId = placement.nearestWall.id
      const { addDoorToWall } = require('@/lib/nodes/operations')
      const updatedLevels = addDoorToWall(levels, wallId, doorNode)
      updateLevels(updatedLevels)

      // Notify parent component
      onPlaced?.()
    }, [placement, floorId, levels, updateLevels, onPlaced])

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

        <group scale={[2, 2, 5]}>
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
  isActive: boolean
  isFullView?: boolean
  allDoors: Array<{ id: string }>
}

const Door = memo(
  ({
    doorId,
    position,
    rotation,
    tileSize,
    wallHeight,
    isActive,
    isFullView = false,
    allDoors,
  }: DoorProps) => {
    const controlMode = useEditor((state) => state.controlMode)
    const movingCamera = useEditor((state) => state.movingCamera)
    const worldX = position[0] * tileSize
    const worldZ = position[1] * tileSize
    const selectedElements = useEditor((state) => state.selectedElements)
    const setSelectedElements = useEditor((state) => state.setSelectedElements)
    const setControlMode = useEditor((state) => state.setControlMode)
    const doorRef = useRef<THREE.Group>(null)

    // Check if this door is selected
    const isSelected = selectedElements.some((el) => el.id === doorId && el.type === 'door')

    // Calculate opacity based on active floor (same logic as walls)
    const opacity = isFullView || isActive ? 1 : 0.2

    // Apply opacity to all materials in the door model
    useEffect(() => {
      if (!doorRef.current) return

      // Use a small delay to ensure GLTF is fully loaded
      const applyOpacity = () => {
        if (!doorRef.current) return

        doorRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const material = child.material as THREE.Material
            if (material.name === 'glass') {
              // TODO: Find a better way to handle glass materials
              return // Skip glass materials
            }
            if ('opacity' in material && 'transparent' in material && 'depthWrite' in material) {
              material.opacity = opacity
              material.transparent = opacity < 1
              // Keep depthWrite enabled to maintain proper depth sorting
              material.depthWrite = true
              material.side = THREE.DoubleSide
            }
          }
        })
      }

      // Apply immediately
      applyOpacity()

      // Also apply after a short delay to catch late-loading GLTF materials
      const timeoutId = setTimeout(applyOpacity, 50)

      return () => clearTimeout(timeoutId)
    }, [opacity])

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
      <group
        onClick={(e) => {
          if (movingCamera || controlMode === 'delete' || controlMode === 'guide') {
            return
          }
          e.stopPropagation()

          // Handle element selection
          const updatedSelection = handleElementClick({
            selectedElements,
            segments: allDoors,
            elementId: doorId,
            type: 'door',
            event: e,
          })
          setSelectedElements(updatedSelection)

          // Switch to building mode unless we're in select mode
          if (controlMode !== 'select') {
            setControlMode('building')
          }
        }}
        position={[worldX, 0, worldZ]}
        rotation={[0, rotation, 0]}
      >
        <group position={[0, 0, 0]} ref={doorRef} scale={[2, 2, 2]}>
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
                const {
                  geometry: cylGeom,
                  midpoint,
                  axis,
                  angle,
                } = createEdgeCylinder(edge[0], edge[1])
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
                      opacity={opacity}
                      transparent
                    />
                  </mesh>
                )
              })
            })()}
          </>
        )}
      </group>
    )
  },
)

Door.displayName = 'Door'

// Component to render all placed doors for a floor
type DoorsProps = {
  floorId: string
  tileSize: number
  wallHeight: number
  isActive: boolean
  isFullView?: boolean
}

export const Doors = memo(
  ({ floorId, tileSize, wallHeight, isActive, isFullView = false }: DoorsProps) => {
    // Fetch door nodes for this floor from the node tree
    const doorNodes = useDoors(floorId)

    if (doorNodes.length === 0) return null

    return (
      <>
        {doorNodes.map((doorNode) => (
          <Door
            allDoors={doorNodes}
            doorId={doorNode.id}
            isActive={isActive}
            isFullView={isFullView}
            key={doorNode.id}
            position={doorNode.position}
            rotation={doorNode.rotation}
            tileSize={tileSize}
            wallHeight={wallHeight}
          />
        ))}
      </>
    )
  },
)

Doors.displayName = 'Doors'

// Preload GLTFs
useGLTF.preload('/models/Door.glb')
