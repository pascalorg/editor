'use client'

import { BuildingMenu } from '@/components/editor/building-menu'
import { ControlModeMenu } from '@/components/editor/control-mode-menu'
import { ColumnBuilder } from '@/components/editor/elements/column-builder'
import { DoorBuilder } from '@/components/editor/elements/door-builder'
import { ImageBuilder } from '@/components/editor/elements/image-builder'
import { animated, useSpring } from '@react-spring/three'
import {
  Environment,
  GizmoHelper,
  GizmoViewport,
  Line,
  OrthographicCamera,
  PerspectiveCamera
} from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
// import { ReferenceImage } from '@/components/editor/elements/reference-image'
import { WindowBuilder } from '@/components/editor/elements/window-builder'
// Node-based API imports for Phase 3 migration
import { emitter } from '@/events/bus'
import { useEditor, type WallSegment } from '@/hooks/use-editor'
import { useReferenceImages, useScans } from '@/hooks/use-nodes'
import {
  setNodePosition,
  setNodeRotation,
  updateNodeProperties
} from '@/lib/nodes/operations'
import { cn } from '@/lib/utils'
import { NodeRenderer } from '../renderer/node-renderer'
import { CustomControls } from './custom-controls'
import { CustomRoomBuilder } from './elements/custom-room-builder'
import { GridTiles } from './elements/grid-tiles'
import { RoofBuilder } from './elements/roof-builder'
import { RoomBuilder } from './elements/room-builder'
import { Scan } from './elements/scan'
import { WallBuilder } from './elements/wall-builder'
import { InfiniteFloor, useGridFadeControls } from './infinite-floor'
import { InfiniteGrid } from './infinite-grid'
import { ProximityGrid } from './proximity-grid'

export const TILE_SIZE = 0.5 // 50cm grid spacing
export const WALL_HEIGHT = 2.5 // 2.5m standard wall height
export const GRID_SIZE = 30 // 30m x 30m
const SHOW_GRID = true // Show grid by default
const GRID_OPACITY = 0.3 // Grid opacity
const IMAGE_OPACITY = 0.5 // Reference image opacity
const IMAGE_SCALE = 1 // Reference image scale
const IMAGE_POSITION: [number, number] = [0, 0] // Reference image position
const IMAGE_ROTATION = 0 // Reference image rotation
const GRID_DIVISIONS = Math.floor(GRID_SIZE / TILE_SIZE) // 60 divisions
const GRID_INTERSECTIONS = GRID_DIVISIONS + 1 // 61 intersections per axis

export const FLOOR_SPACING = 12 // 12m vertical spacing between floors

export default function Editor({ className }: { className?: string }) {
  // Use individual selectors for better performance
  const getWallsSet = useEditor((state) => state.getWallsSet)
  const setWalls = useEditor((state) => state.setWalls)
  // Preview wall methods
  const cancelWallPreview = useEditor((state) => state.cancelWallPreview)
  const selectedElements = useEditor((state) => state.selectedElements)
  const setSelectedElements = useEditor((state) => state.setSelectedElements)
  const selectedImageIds = useEditor((state) => state.selectedImageIds)
  const setSelectedImageIds = useEditor((state) => state.setSelectedImageIds)
  const selectedScanIds = useEditor((state) => state.selectedScanIds)
  const setSelectedScanIds = useEditor((state) => state.setSelectedScanIds)
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
  const movingCamera = useEditor((state) => state.movingCamera)
  const setIsManipulatingImage = useEditor((state) => state.setIsManipulatingImage)
  const setIsManipulatingScan = useEditor((state) => state.setIsManipulatingScan)
  const levels = useEditor((state) => state.levels)

  const updateLevels = useEditor((state) => state.updateLevels)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const viewMode = useEditor((state) => state.viewMode)
  const setWallsGroupRef = useEditor((state) => state.setWallsGroupRef)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)

  // Get reference images and scans from node tree for the current level
  const nodeImages = useReferenceImages(selectedFloorId || levels[0].id)
  const nodeScans = useScans(selectedFloorId || levels[0].id)

  // Map node data to the format expected by rendering components
  const images = nodeImages.map((node) => ({
    id: node.id,
    url: node.url,
    name: node.name,
    createdAt: node.createdAt,
    position: node.position,
    rotation: node.rotation,
    scale: node.scale,
    level: 0, // TODO: Get from parent level
    visible: node.visible,
    opacity: node.opacity,
  }))

  const scans = nodeScans.map((node) => ({
    id: node.id,
    url: node.url,
    name: node.name,
    createdAt: node.createdAt,
    position: node.position,
    rotation: node.rotation,
    scale: node.scale,
    level: 0, // TODO: Get from parent level
    yOffset: node.yOffset,
    visible: node.visible,
    opacity: node.opacity,
  }))

  // Grid fade controls for infinite base floor
  const { fadeDistance, fadeStrength } = useGridFadeControls()

  // Get walls as a Set
  const walls = getWallsSet()

  // Use a callback ref to ensure the store is updated when the group is attached
  const allFloorsGroupCallback = useCallback(
    (node: THREE.Group | null) => {
      if (node) {
        setWallsGroupRef(node)
      }
    },
    [setWallsGroupRef],
  )

  // State for two-click wall placement
  const [wallStartPoint, setWallStartPoint] = useState<[number, number] | null>(null)
  const [wallPreviewEnd, setWallPreviewEnd] = useState<[number, number] | null>(null)

  // State for delete mode (two-click selection)
  const [deleteStartPoint, setDeleteStartPoint] = useState<[number, number] | null>(null)
  const [deletePreviewEnd, setDeletePreviewEnd] = useState<[number, number] | null>(null)

  const setPointerPosition = useEditor((state) => state.setPointerPosition)

  // Helper function to clear all placement states and selections
  const clearPlacementStates = () => {
    setWallStartPoint(null)
    setWallPreviewEnd(null)
    setDeleteStartPoint(null)
    setDeletePreviewEnd(null)
    setPointerPosition(null)
    // Cancel any active wall preview
    cancelWallPreview()
    // Clear all selections (building elements, images, and scans)
    setSelectedElements([])
    setSelectedImageIds([])
    setSelectedScanIds([])
  }

  // Clear cursor position when switching floors to prevent grid artifacts
  useEffect(() => {
    setPointerPosition(null)
  }, [selectedFloorId, setPointerPosition])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        // Check if there's an active placement/deletion in progress
        const hasActivePlacement = wallStartPoint !== null || deleteStartPoint !== null

        // Cancel all placement and delete modes
        clearPlacementStates()

        // Only change mode to 'select' if there was no active placement/deletion
        if (!hasActivePlacement) {
          setControlMode('select')
        }
      } else if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        clearPlacementStates()
        setControlMode('select')
      } else if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        clearPlacementStates()
        setControlMode('delete')
      } else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        clearPlacementStates()
        // Default to 'wall' tool if no active tool when entering building mode
        if (activeTool) {
          setControlMode('building')
        } else {
          setActiveTool('wall')
        }
      } else if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        clearPlacementStates()
        setControlMode('guide')
      } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
      } else if (e.key === 'l' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        toggleLevelMode()
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        if (e.shiftKey) {
          e.preventDefault()
          redo()
        } else {
          e.preventDefault()
          undo()
        }
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
    wallStartPoint,
    deleteStartPoint,
    clearPlacementStates,
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

  const intersections = GRID_INTERSECTIONS

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

  const handleDeleteWallPortion = (x1: number, y1: number, x2: number, y2: number) => {
    const deleteSegment: [[number, number], [number, number]] = [
      [x1, y1],
      [x2, y2],
    ]

    const currentWalls = walls
    const next: string[] = []

    // Check each existing wall
    for (const wallKey of currentWalls) {
      const parts = wallKey.split('-')
      if (parts.length !== 2) continue

      const [start, end] = parts
      const [wx1, wy1] = start.split(',').map(Number)
      const [wx2, wy2] = end.split(',').map(Number)

      const wallSegment: [[number, number], [number, number]] = [
        [wx1, wy1],
        [wx2, wy2],
      ]

      // Check if this wall overlaps with the deletion segment
      const result = getOverlappingSegment(wallSegment, deleteSegment)

      if (result.overlap) {
        // Add remaining segments (if any)
        for (const remaining of result.remaining) {
          const [[rx1, ry1], [rx2, ry2]] = remaining
          next.push(`${rx1},${ry1}-${rx2},${ry2}`)
        }
      } else {
        // No overlap, keep the wall
        next.push(wallKey)
      }
    }

    setWalls(next)
  }

  const handleIntersectionClick = useCallback(
    (x: number, y: number) => {
      // Don't handle clicks while camera is moving
      if (movingCamera) return

      emitter.emit('grid:click', {
        position: [x, y],
      })

      // Guide mode: deselect images when clicking on the grid
      if (controlMode === 'guide') {
        setSelectedImageIds([])
        return
      }

      // Check control mode first - delete mode takes priority
      if (controlMode === 'delete') {
        // Delete mode: two-click line selection
        if (deleteStartPoint === null) {
          // First click: set start point
          setDeleteStartPoint([x, y])
        } else {
          // Second click: delete wall portions using deletePreviewEnd (snapped position)
          if (deletePreviewEnd) {
            const [x1, y1] = deleteStartPoint
            const [x2, y2] = deletePreviewEnd

            // Delete wall portions that overlap with the selected segment
            handleDeleteWallPortion(x1, y1, x2, y2)
          }

          // Reset delete state
          setDeleteStartPoint(null)
          setDeletePreviewEnd(null)
        }
        return
      }

      // Building mode - check active tool (only allow building in building mode)
      if (controlMode === 'building' && activeTool === 'wall') {
        // Wall mode: two-click line drawing with node-based preview
        // Handled by WallBuilder component
      } else if (controlMode === 'building' && activeTool === 'column') {
        // Column mode: one-click placement at intersection
        // Handled by ColumnBuilder component
      }
      // Door placement is now handled by DoorPlacementPreview component's onClick
      // Deselect in building mode if no placement action was taken
      if (controlMode === 'building' && wallStartPoint === null) {
        setSelectedElements([])
      }
    },
    [
      movingCamera,
      controlMode,
      deleteStartPoint,
      deletePreviewEnd,
      handleDeleteWallPortion,
      activeTool,
      wallStartPoint,
      setSelectedImageIds,
    ],
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
      // Only track cursor position for non-base levels (base level uses InfiniteGrid)
      const currentFloor = levels.find((level) => level.id === selectedFloorId)
      const currentLevel = currentFloor?.level || 0

      if (currentLevel > 0) {
        // Update cursor position for proximity grid on non-base levels
        if (y !== null) {
          setPointerPosition([x, y])
        } else {
          setPointerPosition(null)
        }
      } else {
        // On base level, don't track cursor position
        setPointerPosition(null)
      }

      // Check control mode first - delete mode takes priority
      if (controlMode === 'delete') {
        // Delete mode: snap to horizontal, vertical, or 45° diagonal (same as wall mode)
        if (deleteStartPoint && y !== null) {
          const [x1, y1] = deleteStartPoint
          let projectedX = x1
          let projectedY = y1

          const dx = x - x1
          const dy = y - y1
          const absDx = Math.abs(dx)
          const absDy = Math.abs(dy)

          // Calculate distances to horizontal, vertical, and diagonal lines
          const horizontalDist = absDy
          const verticalDist = absDx
          const diagonalDist = Math.abs(absDx - absDy)

          // Find the minimum distance to determine which axis to snap to
          const minDist = Math.min(horizontalDist, verticalDist, diagonalDist)

          if (minDist === diagonalDist) {
            // Snap to 45° diagonal
            const diagonalLength = Math.min(absDx, absDy)
            projectedX = x1 + Math.sign(dx) * diagonalLength
            projectedY = y1 + Math.sign(dy) * diagonalLength
          } else if (minDist === horizontalDist) {
            // Snap to horizontal
            projectedX = x
            projectedY = y1
          } else {
            // Snap to vertical
            projectedX = x1
            projectedY = y
          }

          setDeletePreviewEnd([projectedX, projectedY])
        } else if (!deleteStartPoint) {
          setDeletePreviewEnd(null)
        }
        return
      }

      // Building mode - check active tool (only allow previews in building mode)
      // Door, Window, and Column previews are now handled by DoorBuilder, WindowBuilder, and ColumnBuilder components
    },
    [controlMode, deleteStartPoint, setPointerPosition, levels, selectedFloorId],
  )

  // TODO: Set context menu as a generic event handled per component
  const handleCanvasRightClick = (e: React.MouseEvent) => {
    // Only show canvas context menu if no wall was right-clicked
    if (!wallContextMenuTriggeredRef.current) {
      setContextMenuState({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        type: 'wall',
      })
    }
    wallContextMenuTriggeredRef.current = false
  }

  // Use constants for reference image
  const imageOpacity = IMAGE_OPACITY
  const imageScale = IMAGE_SCALE
  const imagePosition = IMAGE_POSITION
  const imageRotation = IMAGE_ROTATION

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Prevent browser context menu
    e.preventDefault()
  }, [])

  const disabledRaycast = useCallback(() => null, [])

  return (
    <div className="relative h-full w-full">
      <Canvas className={cn('bg-[#303035]', className)} onContextMenu={onContextMenu} shadows>
        {cameraMode === 'perspective' ? (
          <PerspectiveCamera far={1000} fov={50} makeDefault near={0.1} position={[10, 10, 10]} />
        ) : (
          <OrthographicCamera
            far={1000}
            makeDefault
            near={-1000}
            position={[10, 10, 10]}
            zoom={20}
          />
        )}
        {/* <fog attach="fog" args={['#212134', 30, 40]} /> */}
        <color args={['#212134']} attach="background" />
        {/* <LightingControls /> */}

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

        {/* Hide guides (reference images and scans) in full view mode */}
        {/* {viewMode === 'level' &&
          images
            .filter((image) => {
              // Filter out hidden images (visible === false or opacity === 0)
              const isHidden =
                image.visible === false || (image.opacity !== undefined && image.opacity === 0)
              return !isHidden
            })
            .map((image) => {
              // Calculate opacity: use custom opacity if set, otherwise use default IMAGE_OPACITY
              const opacity = image.opacity !== undefined ? image.opacity / 100 : imageOpacity

              return (
                <ReferenceImage
                  controlMode={controlMode}
                  id={image.id}
                  isSelected={selectedImageIds.includes(image.id)}
                  key={image.id}
                  level={image.level}
                  movingCamera={movingCamera}
                  onManipulationEnd={() => setIsManipulatingImage(false)}
                  onManipulationStart={() => setIsManipulatingImage(true)}
                  onSelect={() => setSelectedImageIds([image.id])}
                  onUpdate={(updates, pushToUndo = true) => {
                    let updatedLevels = levels

                    // Apply each update operation
                    if (updates.position !== undefined) {
                      updatedLevels = setNodePosition(updatedLevels, image.id, updates.position)
                    }
                    if (updates.rotation !== undefined) {
                      updatedLevels = setNodeRotation(updatedLevels, image.id, updates.rotation)
                    }
                    if (updates.scale !== undefined) {
                      updatedLevels = setNodeSize(updatedLevels, image.id, [
                        updates.scale,
                        updates.scale,
                      ])
                    }

                    updateLevels(updatedLevels, pushToUndo)
                  }}
                  opacity={opacity}
                  position={image.position}
                  rotation={image.rotation}
                  scale={image.scale}
                  url={image.url}
                />
              )
            })} */}

        {/* Render 3D scans */}
        {viewMode === 'level' &&
          scans
            .filter((scan) => {
              // Filter out hidden scans (visible === false or opacity === 0)
              const isHidden =
                scan.visible === false || (scan.opacity !== undefined && scan.opacity === 0)
              return !isHidden
            })
            .map((scan) => {
              // Calculate opacity: use custom opacity if set, otherwise use 1 (fully visible)
              const scanOpacity = scan.opacity !== undefined ? scan.opacity / 100 : 1

              return (
                <Scan
                  controlMode={controlMode}
                  id={scan.id}
                  isSelected={selectedScanIds.includes(scan.id)}
                  key={scan.id}
                  level={scan.level}
                  movingCamera={movingCamera}
                  onManipulationEnd={() => setIsManipulatingScan(false)}
                  onManipulationStart={() => setIsManipulatingScan(true)}
                  onSelect={() => setSelectedScanIds([scan.id])}
                  onUpdate={(updates, pushToUndo = true) => {
                    let updatedLevels = levels

                    // Apply each update operation
                    if (updates.position !== undefined) {
                      updatedLevels = setNodePosition(updatedLevels, scan.id, updates.position)
                    }
                    if (updates.rotation !== undefined) {
                      updatedLevels = setNodeRotation(updatedLevels, scan.id, updates.rotation)
                    }
                    if (updates.scale !== undefined || updates.yOffset !== undefined) {
                      // Use updateNodeProperties with proper typing for scan-specific properties
                      const scanUpdates: Partial<{
                        scale: number
                        yOffset: number
                      }> = {}
                      if (updates.scale !== undefined) scanUpdates.scale = updates.scale
                      if (updates.yOffset !== undefined) scanUpdates.yOffset = updates.yOffset

                      // Type assertion is safe here as we know the node is a ScanNode
                      updatedLevels = updateNodeProperties(
                        updatedLevels,
                        scan.id,
                        scanUpdates as any,
                      )
                    }

                    updateLevels(updatedLevels, pushToUndo)
                  }}
                  opacity={scanOpacity}
                  position={scan.position}
                  rotation={scan.rotation}
                  scale={scan.scale}
                  url={scan.url}
                  yOffset={scan.yOffset}
                />
              )
            })}

        {/* Loop through all floors and render grid + walls for each */}
        <group ref={allFloorsGroupCallback}>
          {levels
            .filter((level) => {
              // Filter out hidden floors (visible === false or opacity === 0)
              const isHidden =
                level.visible === false || (level.opacity !== undefined && level.opacity === 0)
              return level.type === 'level' && !isHidden
            })
            .map((floor) => {
              const floorLevel = floor.level || 0
              const yPosition =
                (levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT) * floorLevel
              const isActiveFloor = selectedFloorId === floor.id

              // Find the level directly below (for reference grid)
              const levelBelow = floorLevel > 0 ? floorLevel - 1 : null
              const floorBelow =
                levelBelow !== null
                  ? levels.find((level) => level.type === 'level' && level.level === levelBelow)
                  : null

              return (
                <AnimatedLevel key={floor.id} positionY={yPosition}>
                  {/* Grid for visual reference only - not interactive */}
                  {showGrid && (
                    <group raycast={() => null}>
                      {floorLevel === 0 ? (
                        // Base level: show infinite grid
                        isActiveFloor ? (
                          <InfiniteGrid
                            fadeDistance={fadeDistance}
                            fadeStrength={fadeStrength}
                            gridSize={tileSize}
                            lineColor="#ffffff"
                            lineWidth={1.0}
                          />
                        ) : (
                          levelMode === 'exploded' && (
                            <InfiniteGrid
                              fadeDistance={fadeDistance}
                              fadeStrength={fadeStrength}
                              gridSize={tileSize}
                              lineColor="#ffffff"
                              lineWidth={1.0}
                            />
                          )
                        )
                      ) : (
                        // Non-base level: show proximity-based grid around elements
                        <>
                          {isActiveFloor && (
                            <ProximityGrid
                              components={[]} // TODO: Migrate to use node tree
                              fadeWidth={0.5}
                              floorId={floor.id}
                              gridSize={tileSize}
                              lineColor="#ffffff"
                              lineWidth={1.0}
                              maxSize={GRID_SIZE}
                              offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                              opacity={0.3}
                              padding={1.5}
                              previewRoof={null}
                              previewWall={
                                wallStartPoint && wallPreviewEnd
                                  ? { start: wallStartPoint, end: wallPreviewEnd }
                                  : null
                              }
                            />
                          )}
                          {!isActiveFloor && levelMode === 'exploded' && (
                            <ProximityGrid
                              components={[]} // TODO: Migrate to use node tree
                              fadeWidth={0.5}
                              floorId={floor.id}
                              gridSize={tileSize}
                              lineColor="#ffffff"
                              lineWidth={1.0}
                              maxSize={GRID_SIZE}
                              offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                              opacity={0.15}
                              padding={1.5}
                              previewCustomRoom={null}
                              previewRoof={null}
                              previewRoom={null}
                              previewWall={null}
                            />
                          )}
                        </>
                      )}
                    </group>
                  )}

                  {/* Show grid from level below as reference for non-base levels (only in exploded mode) */}
                  {showGrid &&
                    floorLevel > 0 &&
                    isActiveFloor &&
                    floorBelow &&
                    levelMode === 'exploded' && (
                      <group
                        position={[0, -(levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT), 0]}
                        raycast={() => null}
                      >
                        <ProximityGrid
                          components={[]} // TODO: Migrate to use node tree
                          fadeWidth={0.5}
                          floorId={floorBelow.id}
                          gridSize={tileSize}
                          lineColor="#ffffff"
                          lineWidth={1.0}
                          maxSize={GRID_SIZE}
                          offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                          opacity={0.08}
                          padding={1.5}
                          previewCustomRoom={null}
                          previewRoof={null}
                          previewRoom={null}
                          previewWall={null}
                        />
                      </group>
                    )}

                  <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
                    {controlMode === 'building' && activeTool === 'wall' && isActiveFloor && (
                      <WallBuilder />
                    )}
                    {controlMode === 'building' && activeTool === 'room' && isActiveFloor && (
                      <RoomBuilder />
                    )}
                    {controlMode === 'building' &&
                      activeTool === 'custom-room' &&
                      isActiveFloor && <CustomRoomBuilder />}
                    {controlMode === 'building' && activeTool === 'roof' && isActiveFloor && (
                      <RoofBuilder />
                    )}
                    {controlMode === 'building' && activeTool === 'column' && isActiveFloor && (
                      <ColumnBuilder />
                    )}
                    {controlMode === 'building' && activeTool === 'door' && isActiveFloor && (
                      <DoorBuilder />
                    )}
                    {controlMode === 'building' && activeTool === 'window' && isActiveFloor && (
                      <WindowBuilder />
                    )}

                      <NodeRenderer node={floor} />
                    {/* Only show interactive grid tiles for the active floor */}
                    {isActiveFloor && (
                      <GridTiles
                        controlMode={controlMode}
                        deletePreviewEnd={deletePreviewEnd}
                        deleteStartPoint={deleteStartPoint}
                        disableBuild={
                          (controlMode === 'building' && !activeTool) ||
                          controlMode === 'select' ||
                          controlMode === 'guide'
                        }
                        intersections={intersections}
                        onIntersectionClick={handleIntersectionClick}
                        onIntersectionDoubleClick={handleIntersectionDoubleClick}
                        onIntersectionHover={handleIntersectionHover}
                        opacity={
                          floor.opacity !== undefined
                            ? (floor.opacity / 100) * gridOpacity
                            : gridOpacity
                        }
                        tileSize={tileSize}
                        wallHeight={wallHeight}
                        wallPreviewEnd={wallPreviewEnd}
                      />
                    )}
                  </group>
                </AnimatedLevel>
              )
            })}
        </group>

        <CustomControls />
        {/* Image builder for handling image manipulation in guide mode */}
        {controlMode === 'guide' && <ImageBuilder />}
        <Environment preset="city" />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
        </GizmoHelper>
        {/* <Stats/> */}
      </Canvas>

      {contextMenuState.isOpen &&
        contextMenuState.type === 'wall' &&
        selectedElements.length > 0 && (
          <div
            className="fixed z-50 min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{
              top: `${contextMenuState.position.y}px`,
              left: `${contextMenuState.position.x}px`,
            }}
          >
            {contextMenuState.wallSegment && (
              <div
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  handleDeleteSelectedElements()
                  setContextMenuState((prev) => ({ ...prev, isOpen: false }))
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete Selected Elements
              </div>
            )}
          </div>
        )}

      <ControlModeMenu onModeChange={clearPlacementStates} />
      <BuildingMenu />
    </div>
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
