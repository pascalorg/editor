'use client'

import type { WallSegment } from '@/hooks/use-editor'
import { useEditor } from '@/hooks/use-editor'
import { useWindows } from '@/hooks/use-nodes'
import { validateWallElementPlacement } from '@/lib/wall-element-validation'
import { handleElementClick } from '@/lib/building-elements'
import { Gltf, useGLTF } from '@react-three/drei'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

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
    const levels = useEditor((state) => state.levels)
    const updateLevels = useEditor((state) => state.updateLevels)

    const handleClick = useCallback(() => {
      if (!(placement?.canPlace && placement?.nearestWall)) {
        return
      }

      // Create window node
      const windowId = `window-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      const windowNode = {
        id: windowId,
        type: 'window' as const,
        name: 'Window',
        position: placement.gridPosition,
        rotation: placement.rotation,
        size: [1, 1.2] as [number, number], // 1m x 1.2m window
        visible: true,
        opacity: 100,
        children: [] as [],
      }

      // Add window to the nearest wall using node operations
      const wallId = placement.nearestWall.id
      const { addWindowToWall } = require('@/lib/nodes/operations')
      const updatedLevels = addWindowToWall(levels, wallId, windowNode)
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
  isActive: boolean
  isFullView?: boolean
  controlMode: string
  movingCamera: boolean
  allWindows: Array<{ id: string }>
}

const Window = memo(
  ({
    windowId,
    position,
    rotation,
    tileSize,
    wallHeight,
    isActive,
    isFullView = false,
    controlMode,
    movingCamera,
    allWindows,
  }: WindowProps) => {
    const worldX = position[0] * tileSize
    const worldZ = position[1] * tileSize
    const selectedElements = useEditor((state) => state.selectedElements)
    const setSelectedElements = useEditor((state) => state.setSelectedElements)
    const setControlMode = useEditor((state) => state.setControlMode)
    const windowRef = useRef<THREE.Group>(null)

    // Check if this window is selected
    const isSelected = selectedElements.some((el) => el.id === windowId && el.type === 'window')

    // Calculate opacity based on active floor (same logic as walls)
    const opacity = isFullView || isActive ? 1 : 0.2

    // Apply opacity to all materials in the window model
    useEffect(() => {
      if (!windowRef.current) return

      // Use a small delay to ensure GLTF is fully loaded
      const applyOpacity = () => {
        if (!windowRef.current) return

        windowRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const material = child.material as THREE.Material
            if (material.name.toLowerCase() === 'glass') {
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

    return (
      <group
        onClick={(e) => {
          if (!isActive || movingCamera || controlMode === 'delete' || controlMode === 'guide') {
            return
          }
          e.stopPropagation()

          // Handle element selection
          const updatedSelection = handleElementClick({
            selectedElements,
            segments: allWindows,
            elementId: windowId,
            type: 'window',
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
        <group ref={windowRef}>
          <Gltf position-y={0.5} scale={[1, 1, 2]} src="/models/Window.glb" />
        </group>

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

Window.displayName = 'Window'

// Component to render all placed windows for a floor
type WindowsProps = {
  floorId: string
  tileSize: number
  wallHeight: number
  isActive: boolean
  isFullView?: boolean
  controlMode: string
  movingCamera: boolean
}

export const Windows = memo(
  ({
    floorId,
    tileSize,
    wallHeight,
    isActive,
    isFullView = false,
    controlMode,
    movingCamera,
  }: WindowsProps) => {
    // Fetch window nodes for this floor from the node tree
    const windowNodes = useWindows(floorId)

    if (windowNodes.length === 0) return null

    return (
      <>
        {windowNodes.map((windowNode) => (
          <Window
            allWindows={windowNodes}
            controlMode={controlMode}
            isActive={isActive}
            isFullView={isFullView}
            key={windowNode.id}
            movingCamera={movingCamera}
            position={windowNode.position}
            rotation={windowNode.rotation}
            tileSize={tileSize}
            wallHeight={wallHeight}
            windowId={windowNode.id}
          />
        ))}
      </>
    )
  },
)

Windows.displayName = 'Windows'

// Preload GLTFs
useGLTF.preload('/models/Window.glb')
