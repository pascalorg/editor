'use client'

import { Arrow } from '@radix-ui/react-popover'
import { type CameraControlsImpl, Html, useCursor } from '@react-three/drei'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Hammer, Image, MousePointer2, Paintbrush, Pencil, Trash2 } from 'lucide-react'
import { memo, useCallback, useRef } from 'react'
import type * as THREE from 'three'
import { furnishTools } from '@/components/editor/action-menu/furnish-tools'
import { structureTools } from '@/components/editor/action-menu/structure-tools'
import { emitter } from '@/events/bus'
import { type ControlMode, useEditor } from '@/hooks/use-editor'
import { GRID_INTERSECTIONS, TILE_SIZE } from '.'

// Map control modes to their icons and colors (matching toolbar active colors)
// Background is color-500 at 20% opacity, icon is color-400
const modeConfig: Record<
  ControlMode,
  { icon: typeof MousePointer2; bgColor: string; iconColor: string }
> = {
  select: { icon: MousePointer2, bgColor: 'rgba(59, 130, 246, 0.2)', iconColor: '#60a5fa' }, // blue-500/20, blue-400
  edit: { icon: Pencil, bgColor: 'rgba(249, 115, 22, 0.2)', iconColor: '#fb923c' }, // orange-500/20, orange-400
  delete: { icon: Trash2, bgColor: 'rgba(239, 68, 68, 0.2)', iconColor: '#f87171' }, // red-500/20, red-400
  build: { icon: Hammer, bgColor: 'rgba(34, 197, 94, 0.2)', iconColor: '#4ade80' }, // green-500/20, green-400
  building: { icon: Hammer, bgColor: 'rgba(34, 197, 94, 0.2)', iconColor: '#4ade80' }, // green-500/20, green-400 (legacy)
  painting: { icon: Paintbrush, bgColor: 'rgba(6, 182, 212, 0.2)', iconColor: '#22d3ee' }, // cyan-500/20, cyan-400
  guide: { icon: Image, bgColor: 'rgba(168, 85, 247, 0.2)', iconColor: '#c084fc' }, // purple-500/20, purple-400
}

const GRID_SIZE = 30 // 30m x 30m

export const GridTiles = memo(() => {
  const meshRef = useRef<THREE.Mesh>(null)

  const lastClickTimeRef = useRef<number>(0)

  const gridSize = 10_000 // Large enough to be effectively infinite
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

      hoveredIntersection.current = { x, y }
      handleIntersectionHover(x, y)
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

    // Emit grid:pointerdown event
    if (hoveredIntersection.current) {
      emitter.emit('grid:pointerdown', {
        position: [hoveredIntersection.current.x, hoveredIntersection.current.y],
      })
    }

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
      // Emit grid:pointerup event for left-click
      if (e.button === 0 && hoveredIntersection.current) {
        emitter.emit('grid:pointerup', {
          position: [hoveredIntersection.current.x, hoveredIntersection.current.y],
        })
      }

      if (useEditor.getState().controlMode === 'building') {
        return
      }
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
        // Center the raycast plane to cover negative coordinates as well
        position={[0, 0.002, 0]}
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

// Combined tools from structure and furnish modes for icon lookup
const allTools = [...structureTools, ...furnishTools]

// Helper function to get icon for a building tool
function getBuildingToolIcon(toolId: string, category: string | null): string | null {
  // For item tools, find by both tool id and catalog category
  if (toolId === 'item' && category) {
    const tool = allTools.find(
      (t) => t.id === 'item' && 'catalogCategory' in t && t.catalogCategory === category,
    )
    return tool?.iconSrc ?? null
  }
  // For other tools, find by tool id only
  const tool = allTools.find(
    (t) => t.id === toolId && !('catalogCategory' in t && t.catalogCategory),
  )
  return tool?.iconSrc ?? null
}

// Down arrow component (2m height, pointing down along -Y axis)
const DownArrow = () => {
  const shaftHeight = 1.7
  const coneHeight = 0.3
  const shaftRadius = 0.03
  const coneRadius = 0.1
  const iconCircleRadius = 0.15

  const cursorPosition = useEditor((state) => state.pointerPosition)
  const controlMode = useEditor((state) => state.controlMode)
  const activeTool = useEditor((state) => state.activeTool)
  const catalogCategory = useEditor((state) => state.catalogCategory)

  const iconRef = useRef<THREE.Group>(null)
  useFrame(({ clock }, delta) => {
    if (iconRef.current) {
      iconRef.current.position.y = Math.sin(clock.getElapsedTime() * 1) * 0.05
    }
  })

  if (!cursorPosition) return null

  // Get icon and colors
  const { icon: Icon, bgColor, iconColor } = modeConfig[controlMode]

  // For building mode, get the PNG icon path
  const buildingIconSrc =
    controlMode === 'building' && activeTool
      ? getBuildingToolIcon(activeTool, catalogCategory)
      : null

  // Building mode with tool selected: black background, larger icon
  // Other modes: translucent colored background, colored icon
  const isBuildingWithTool = controlMode === 'building' && buildingIconSrc

  return (
    <group position={[cursorPosition[0] * TILE_SIZE, 2, cursorPosition[1] * TILE_SIZE]}>
      {/* Icon circle at the top */}
      <group ref={iconRef}>
        <Html center position={[0, iconCircleRadius + 0.05, 0]} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              width: isBuildingWithTool ? 32 : 28,
              height: isBuildingWithTool ? 32 : 28,
              borderRadius: '50%',
              backgroundColor: isBuildingWithTool ? '#000000' : bgColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            {buildingIconSrc ? (
              <img
                alt=""
                height={24}
                src={buildingIconSrc}
                style={{ objectFit: 'contain' }}
                width={24}
              />
            ) : (
              <Icon color={iconColor} size={16} strokeWidth={2.5} />
            )}
          </div>
        </Html>
      </group>
      {/* Shaft - cylinder is created along Y-axis, no rotation needed */}
      <mesh position={[0, -shaftHeight / 2, 0]} renderOrder={999}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftHeight, 8]} />
        <meshStandardMaterial color="white" depthTest={false} opacity={0.8} transparent />
      </mesh>
      {/* Cone tip - cone points up by default along Y, rotate 180° to point down */}
      <mesh
        position={[0, -(shaftHeight + coneHeight / 2), 0]}
        renderOrder={999}
        rotation={[0, 0, Math.PI]}
      >
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
