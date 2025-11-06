'use client'

import { Gltf, useGLTF } from '@react-three/drei'
import { memo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useEditor } from '@/hooks/use-editor'
import { useWindows } from '@/hooks/use-nodes'
import { handleElementClick } from '@/lib/building-elements'

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

// Single window component
type WindowProps = {
  windowId: string
  position: [number, number]
  rotation: number
  tileSize: number
  wallHeight: number
  isActive: boolean
  isFullView?: boolean
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
    allWindows,
  }: WindowProps) => {
    const movingCamera = useEditor((state) => state.movingCamera)
    const controlMode = useEditor((state) => state.controlMode)
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
}

export const Windows = memo(
  ({ floorId, tileSize, wallHeight, isActive, isFullView = false }: WindowsProps) => {
    // Fetch window nodes for this floor from the node tree
    const windowNodes = useWindows(floorId)

    if (windowNodes.length === 0) return null

    return (
      <>
        {windowNodes.map((windowNode) => (
          <Window
            allWindows={windowNodes}
            isActive={isActive}
            isFullView={isFullView}
            key={windowNode.id}
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
