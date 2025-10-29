'use client'

import type { Component, WallSegment, WindowComponentData } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import { validateWallElementPlacement } from '@/lib/wall-element-validation'
import { Gltf } from '@react-three/drei'
import { memo, useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'

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

type WindowPlacementPreviewProps = {
  mouseGridPosition: [number, number] | null // Mouse position in grid coordinates
  wallSegments: WallSegment[]
  existingWindows: Array<{ position: [number, number]; rotation: number }>
  existingDoors: Array<{ position: [number, number]; rotation: number }>
  tileSize: number
  wallHeight: number
  floorId: string
  onPlaced?: () => void // Callback when window is placed
}

export const WindowPlacementPreview = memo(
  ({
    mouseGridPosition,
    wallSegments,
    existingWindows,
    existingDoors,
    tileSize,
    wallHeight,
    floorId,
    onPlaced,
  }: WindowPlacementPreviewProps) => {
    // Track the last valid rotation to maintain it when preview becomes invalid
    const lastValidRotationRef = useRef<number>(0)

    // Calculate placement data based on mouse position and nearby walls
    const placement = useMemo(() => {
      // Combine existing windows and doors to check for conflicts with both
      const existingElements = [...existingWindows, ...existingDoors]

      const result = validateWallElementPlacement({
        mouseGridPosition,
        wallSegments,
        existingElements,
        elementWidth: 2, // Windows are 2 cells wide
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
    }, [mouseGridPosition, wallSegments, existingWindows, existingDoors])

    // Create rectangle geometry (2 cells along wall, 2 cells perpendicular)
    // Must be before early return to avoid conditional hooks
    const rectangleGeometry = useMemo(() => {
      const width = tileSize * 2 // Width along the wall (2 cells)
      const depth = tileSize * 2 // Depth perpendicular to wall (1 cell front, 1 cell back)
      const geometry = new THREE.PlaneGeometry(width, depth)
      geometry.rotateX(-Math.PI / 2) // Rotate to lie flat on ground
      return geometry
    }, [tileSize])

    // Handle click to place window
    const addComponent = useEditor((state) => state.addComponent)

    const handleClick = useCallback(() => {
      if (!(placement?.canPlace && placement?.nearestWall)) {
        return
      }

      // Create window component
      const windowId = `window_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const windowComponent: Component = {
        id: windowId,
        type: 'window',
        group: floorId,
        label: 'Window',
        createdAt: new Date().toISOString(),
        data: {
          position: placement.gridPosition,
          rotation: placement.rotation,
          width: 2,
        } as WindowComponentData,
      }

      // Add window to components using store method
      addComponent(windowComponent)

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

        <Gltf position-y={0.5} scale={[1, 1, 5]} src="/models/Window.glb" />
      </group>
    )
  },
)

WindowPlacementPreview.displayName = 'WindowPlacementPreview'

// Single window component
type WindowProps = {
  windowId: string
  position: [number, number]
  rotation: number
  tileSize: number
  wallHeight: number
}

const Window = memo(({ windowId, position, rotation, tileSize, wallHeight }: WindowProps) => {
  const worldX = position[0] * tileSize
  const worldZ = position[1] * tileSize
  const selectedElements = useEditor((state) => state.selectedElements)

  console.log('Window component rendering:', {
    windowId,
    position,
    rotation,
    worldX,
    worldZ,
    tileSize,
  })

  // Check if this window is selected
  const isSelected = selectedElements.some((el) => el.id === windowId && el.type === 'window')

  // Calculate corners for edge rendering (window occupies 2x2 cells)
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
  console.log('Window THREE.js group will render at:', {
    position: [worldX, 0, worldZ],
    rotation: [0, rotation, 0],
  })

  return (
    <group position={[worldX, 0, worldZ]} rotation={[0, rotation, 0]}>
      <Gltf position-y={0.5} scale={[1, 1, 5]} src="/models/Window.glb" />

      {/* Selection outline - 3D cylinders (same as walls and doors) */}
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

Window.displayName = 'Window'

// Component to render all placed windows for a floor
type WindowsProps = {
  floorId: string
  tileSize: number
  wallHeight: number
}

export const Windows = memo(({ floorId, tileSize, wallHeight }: WindowsProps) => {
  // Fetch window components for this floor from the store
  const windowComponents = useEditor(
    useShallow((state) =>
      state.components.filter((c) => c.type === 'window' && c.group === floorId),
    ),
  )

  // DEBUG: Log what we're rendering
  console.log('Windows render:', {
    floorId,
    count: windowComponents.length,
    components: windowComponents.map((c) => ({
      id: c.id,
      type: c.type,
      data: c.type === 'window' ? c.data : null,
    })),
  })

  if (windowComponents.length === 0) return null

  return (
    <group>
      {windowComponents.map((component) => {
        if (component.type !== 'window') return null

        const { position, rotation } = component.data

        console.log('Rendering individual window:', { id: component.id, position, rotation })

        return (
          <Window
            key={component.id}
            position={position}
            rotation={rotation}
            tileSize={tileSize}
            wallHeight={wallHeight}
            windowId={component.id}
          />
        )
      })}
    </group>
  )
})

Windows.displayName = 'Windows'
