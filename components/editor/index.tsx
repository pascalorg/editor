'use client'

import { animated, useSpring } from '@react-spring/three'
import {
  Environment,
  GizmoHelper,
  GizmoViewport,
  Gltf,
  Line,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { componentRegistry } from '@/lib/nodes/registry'
import '@/components/nodes'
import { useEditor, type WallSegment } from '@/hooks/use-editor'
import type { BuildingNode } from '@/lib/nodes/types'
import { cn } from '@/lib/utils'
import { NodeRenderer } from '../renderer/node-renderer'
import { CustomControls } from './custom-controls'
import { GridTiles } from './elements/grid-tiles'
import { InfiniteFloor, useGridFadeControls } from './infinite-floor'
import { InfiniteGrid } from './infinite-grid'
import { ProximityGrid } from './proximity-grid'
import SelectionManager from './selection-manager'

export const TILE_SIZE = 0.5 // 50cm grid spacing
export const WALL_HEIGHT = 2.5 // 2.5m standard wall height
export const GRID_SIZE = 30 // 30m x 30m
const SHOW_GRID = true // Show grid by default
const GRID_OPACITY = 0.3 // Grid opacity
const GRID_DIVISIONS = Math.floor(GRID_SIZE / TILE_SIZE) // 60 divisions
export const GRID_INTERSECTIONS = GRID_DIVISIONS + 1 // 61 intersections per axis

export const FLOOR_SPACING = 12 // 12m vertical spacing between floors

export default function Editor({ className }: { className?: string }) {
  const selectedElements = useEditor((state) => state.selectedElements)
  const selectedImageIds = useEditor((state) => state.selectedImageIds)
  const selectedScanIds = useEditor((state) => state.selectedScanIds)
  const handleDeleteSelectedElements = useEditor((state) => state.handleDeleteSelectedElements)
  const handleDeleteSelectedImages = useEditor((state) => state.handleDeleteSelectedImages)
  const handleDeleteSelectedScans = useEditor((state) => state.handleDeleteSelectedScans)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const activeTool = useEditor((state) => state.activeTool)
  const controlMode = useEditor((state) => state.controlMode)
  const setControlMode = useEditor((state) => state.setControlMode)
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)

  const building = useEditor((state) => state.root.children[0])

  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)

  // Grid fade controls for infinite base floor
  const { fadeDistance, fadeStrength } = useGridFadeControls()

  const setPointerPosition = useEditor((state) => state.setPointerPosition)

  // Clear cursor position when switching floors to prevent grid artifacts
  useEffect(() => {
    setPointerPosition(null)
  }, [setPointerPosition])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        setControlMode('select')
      } else if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('select')
      } else if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('delete')
      } else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        // Default to 'wall' tool if no active tool when entering building mode
        if (activeTool) {
          setControlMode('building')
        } else {
          setActiveTool('wall')
        }
      } else if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('guide')
      } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
      } else if (e.key === 'l' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        toggleLevelMode()
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        undo()
      } else if (e.key === 'Z' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selectedElements.length > 0) {
          handleDeleteSelectedElements()
        } else if (selectedImageIds.length > 0) {
          // Handle image deletion separately (not building elements)
          handleDeleteSelectedImages()
        } else if (selectedScanIds.length > 0) {
          // Handle scan deletion separately
          handleDeleteSelectedScans()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    undo,
    redo,
    setControlMode,
    setActiveTool,
    activeTool,
    cameraMode,
    setCameraMode,
    selectedElements,
    selectedImageIds,
    selectedScanIds,
    handleDeleteSelectedElements,
    handleDeleteSelectedImages,
    handleDeleteSelectedScans,
    toggleLevelMode,
  ])

  // Use constants instead of Leva controls
  const wallHeight = WALL_HEIGHT
  const tileSize = TILE_SIZE
  const showGrid = SHOW_GRID
  const gridOpacity = GRID_OPACITY

  const [isCameraEnabled, setIsCameraEnabled] = useState(false)
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean
    position: { x: number; y: number }
    type: 'wall'
    wallSegment?: WallSegment
  }>({ isOpen: false, position: { x: 0, y: 0 }, type: 'wall' })
  const wallContextMenuTriggeredRef = useRef(false)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setIsCameraEnabled(true)
        e.preventDefault()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setIsCameraEnabled(false)
      }
    }

    const handleClickOutside = () => {
      setContextMenuState((prev) => ({ ...prev, isOpen: false }))
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    document.addEventListener('click', handleClickOutside)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [])

  // Helper function to check if two line segments overlap (for collinear segments only)
  const getOverlappingSegment = (
    seg1: [[number, number], [number, number]],
    seg2: [[number, number], [number, number]],
  ): { overlap: boolean; remaining: Array<[[number, number], [number, number]]> } => {
    const [[x1, y1], [x2, y2]] = seg1
    const [[x3, y3], [x4, y4]] = seg2

    // Check if segments are collinear (on same line)
    const isHorizontal1 = y1 === y2
    const isHorizontal2 = y3 === y4
    const isVertical1 = x1 === x2
    const isVertical2 = x3 === x4

    // Calculate diagonal direction for diagonal segments
    const dx1 = x2 - x1
    const dy1 = y2 - y1
    const dx2 = x4 - x3
    const dy2 = y4 - y3

    const isDiagonal1 = !(isHorizontal1 || isVertical1) && Math.abs(dx1) === Math.abs(dy1)
    const isDiagonal2 = !(isHorizontal2 || isVertical2) && Math.abs(dx2) === Math.abs(dy2)

    // For segments to overlap, they must be on the same line
    if (isHorizontal1 && isHorizontal2 && y1 === y3) {
      // Both horizontal on same row
      const minX1 = Math.min(x1, x2)
      const maxX1 = Math.max(x1, x2)
      const minX2 = Math.min(x3, x4)
      const maxX2 = Math.max(x3, x4)

      // Check for overlap
      const overlapStart = Math.max(minX1, minX2)
      const overlapEnd = Math.min(maxX1, maxX2)

      if (overlapStart <= overlapEnd) {
        // There is overlap, calculate remaining segments
        const remaining: Array<[[number, number], [number, number]]> = []

        if (minX1 < overlapStart) {
          remaining.push([
            [minX1, y1],
            [overlapStart, y1],
          ])
        }
        if (maxX1 > overlapEnd) {
          remaining.push([
            [overlapEnd, y1],
            [maxX1, y1],
          ])
        }

        return { overlap: true, remaining }
      }
    } else if (isVertical1 && isVertical2 && x1 === x3) {
      // Both vertical on same column
      const minY1 = Math.min(y1, y2)
      const maxY1 = Math.max(y1, y2)
      const minY2 = Math.min(y3, y4)
      const maxY2 = Math.max(y3, y4)

      // Check for overlap
      const overlapStart = Math.max(minY1, minY2)
      const overlapEnd = Math.min(maxY1, maxY2)

      if (overlapStart <= overlapEnd) {
        // There is overlap, calculate remaining segments
        const remaining: Array<[[number, number], [number, number]]> = []

        if (minY1 < overlapStart) {
          remaining.push([
            [x1, minY1],
            [x1, overlapStart],
          ])
        }
        if (maxY1 > overlapEnd) {
          remaining.push([
            [x1, overlapEnd],
            [x1, maxY1],
          ])
        }

        return { overlap: true, remaining }
      }
    } else if (isDiagonal1 && isDiagonal2) {
      // Both diagonal - check if they're on the same diagonal line
      // For diagonals, we need to check if they have the same slope and intercept
      const slope1 = dy1 / dx1
      const slope2 = dy2 / dx2

      if (Math.abs(slope1 - slope2) < 0.001) {
        // Same slope - check if they're on the same line
        const intercept1 = y1 - slope1 * x1
        const intercept2 = y3 - slope2 * x3

        if (Math.abs(intercept1 - intercept2) < 0.001) {
          // Same line - check for overlap using x-coordinates (assuming slope is consistent)
          const minX1 = Math.min(x1, x2)
          const maxX1 = Math.max(x1, x2)
          const minX2 = Math.min(x3, x4)
          const maxX2 = Math.max(x3, x4)

          const overlapStartX = Math.max(minX1, minX2)
          const overlapEndX = Math.min(maxX1, maxX2)

          if (overlapStartX <= overlapEndX) {
            // There is overlap
            const remaining: Array<[[number, number], [number, number]]> = []

            if (minX1 < overlapStartX) {
              const startY = y1 + slope1 * (minX1 - x1)
              const endY = y1 + slope1 * (overlapStartX - x1)
              remaining.push([
                [minX1, Math.round(startY)],
                [overlapStartX, Math.round(endY)],
              ])
            }
            if (maxX1 > overlapEndX) {
              const startY = y1 + slope1 * (overlapEndX - x1)
              const endY = y1 + slope1 * (maxX1 - x1)
              remaining.push([
                [overlapEndX, Math.round(startY)],
                [maxX1, Math.round(endY)],
              ])
            }

            return { overlap: true, remaining }
          }
        }
      }
    }

    return { overlap: false, remaining: [seg1] }
  }

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Prevent browser context menu
    e.preventDefault()
    console.log('Context menu event', e)
  }, [])

  const disabledRaycast = useCallback(() => null, [])
  return (
    <Canvas className={cn('bg-[#303035]', className)} onContextMenu={onContextMenu} shadows>
      {cameraMode === 'perspective' ? (
        <PerspectiveCamera far={1000} fov={50} makeDefault near={0.1} position={[10, 10, 10]} />
      ) : (
        <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
      )}
      {/* <fog attach="fog" args={['#212134', 30, 40]} /> */}
      <color args={['#212134']} attach="background" />

      {/* TMP FUNNY TO SEE TODO: Create a true node with it's "builder" to be able to move it and save it */}
      <Gltf src="/models/Casual.gltf" />
      {/* Lighting setup with shadows */}
      <ambientLight intensity={0.1} />
      <directionalLight
        castShadow
        intensity={2}
        position={[20, 30, 20]}
        shadow-bias={-0.0001}
        shadow-camera-bottom={-30}
        shadow-camera-far={100}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-mapSize={[2048, 2048]}
      />

      {/* Infinite dashed axis lines - visual only, not interactive */}
      <group raycast={disabledRaycast}>
        {/* X axis (red) */}
        <Line
          color="white"
          dashed
          dashSize={0.5}
          gapSize={0.25}
          lineWidth={1}
          opacity={0.4}
          points={[
            [-1000, 0, 0],
            [1000, 0, 0],
          ]}
        />
        {/* Y axis (green) - vertical */}
        <Line
          color="white"
          dashed
          dashSize={0.5}
          gapSize={0.25}
          lineWidth={1}
          opacity={0.4}
          points={[
            [0, -1000, 0],
            [0, 1000, 0],
          ]}
        />
        {/* Z axis (blue) */}
        <Line
          color="white"
          dashed
          dashSize={0.5}
          gapSize={0.25}
          lineWidth={1}
          opacity={0.4}
          points={[
            [0, 0, -1000],
            [0, 0, 1000],
          ]}
        />
      </group>

      {/* Infinite floor - rendered outside export group */}
      <InfiniteFloor />

      {/* Loop through all floors and render grid + walls for each */}
      <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
        <NodeRenderer node={building} />
      </group>

      {controlMode === 'select' && <SelectionManager />}
      <CustomControls />

      <Environment preset="city" />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
      </GizmoHelper>
      {/* <Stats/> */}
    </Canvas>
  )
}

interface AnimatedLevelProps {
  children: React.ReactNode
  positionY?: number
}

const AnimatedLevel: React.FC<AnimatedLevelProps> = ({ positionY, children }) => {
  const animatedProps = useSpring({
    positionY,
    config: { mass: 1, tension: 170, friction: 26 },
  })

  return <animated.group position-y={animatedProps.positionY}>{children}</animated.group>
}
