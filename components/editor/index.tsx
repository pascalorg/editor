'use client'

import { BuildingMenu } from '@/components/editor/building-menu'
import { ControlModeMenu } from '@/components/editor/control-mode-menu'
import { ColumnShadowPreview, Columns } from '@/components/editor/elements/column'
import { DoorPlacementPreview, Doors } from '@/components/editor/elements/door'
import { ReferenceImage } from '@/components/editor/elements/reference-image'
import { Roofs } from '@/components/editor/elements/roof'
import { Walls } from '@/components/editor/elements/wall'
import { WindowPlacementPreview, Windows } from '@/components/editor/elements/window'
import { useEditor, type WallSegment } from '@/hooks/use-editor'
import { animated, useSpring } from '@react-spring/three'
import {
  Environment,
  GizmoHelper,
  GizmoViewport,
  Line,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
// Node-based API imports for Phase 3 migration
import { useDoors, useReferenceImages, useScans, useWalls, useWindows } from '@/hooks/use-nodes'
import {
  addColumnToLevel,
  setNodePosition,
  setNodeRotation,
  setNodeSize,
} from '@/lib/nodes/operations'
import { cn } from '@/lib/utils'
import { CustomControls } from './custom-controls'
import { GridTiles } from './elements/grid-tiles'
import { Scan } from './elements/scan'
import { InfiniteFloor, useGridFadeControls } from './infinite-floor'
import { InfiniteGrid } from './infinite-grid'
import { ProximityGrid } from './proximity-grid'

const TILE_SIZE = 0.5 // 50cm grid spacing
export const WALL_HEIGHT = 2.5 // 2.5m standard wall height
const MIN_WALL_LENGTH = 0.5 // 50cm minimum wall length
export const GRID_SIZE = 30 // 30m x 30m
const SHOW_GRID = true // Show grid by default
const GRID_OPACITY = 0.3 // Grid opacity
const CAMERA_TYPE = 'perspective' as 'perspective' | 'orthographic' // Camera type
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
  const getRoofsSet = useEditor((state) => state.getRoofsSet)
  const setWalls = useEditor((state) => state.setWalls)
  const setRoofs = useEditor((state) => state.setRoofs)
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
  const nodeImages = useReferenceImages(selectedFloorId || 'level_0')
  const nodeScans = useScans(selectedFloorId || 'level_0')

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

  // Helper function to convert wall nodes to wall segments
  const convertWallNodesToSegments = useCallback(
    (wallNodes: any[]): WallSegment[] =>
      wallNodes.map((node) => {
        const [x1, y1] = node.position
        const length = node.size[0]
        const x2 = x1 + Math.cos(node.rotation) * length
        const y2 = y1 + Math.sin(node.rotation) * length

        return {
          start: [x1, y1] as [number, number],
          end: [x2, y2] as [number, number],
          id: node.id,
          isHorizontal: Math.abs(node.rotation) < 0.1 || Math.abs(node.rotation - Math.PI) < 0.1,
          visible: node.visible ?? true,
          opacity: node.opacity ?? 100,
        }
      }),
    [],
  )

  // Grid fade controls for infinite base floor
  const { fadeDistance, fadeStrength } = useGridFadeControls()

  // Get walls as a Set
  const walls = getWallsSet()

  // Get wall/door/window data for the currently selected floor (for placement validation)
  const currentFloorWallNodes = useWalls(selectedFloorId || 'level_0')
  const currentFloorDoorNodes = useDoors(selectedFloorId || 'level_0')
  const currentFloorWindowNodes = useWindows(selectedFloorId || 'level_0')

  const currentFloorWallSegments = useMemo(
    () => convertWallNodesToSegments(currentFloorWallNodes),
    [currentFloorWallNodes, convertWallNodesToSegments],
  )

  const currentFloorExistingDoors = useMemo(
    () =>
      currentFloorDoorNodes.map((node) => ({
        position: node.position,
        rotation: node.rotation,
      })),
    [currentFloorDoorNodes],
  )

  const currentFloorExistingWindows = useMemo(
    () =>
      currentFloorWindowNodes.map((node) => ({
        position: node.position,
        rotation: node.rotation,
      })),
    [currentFloorWindowNodes],
  )

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

  // State for room mode (rectangle with 4 walls)
  const [roomStartPoint, setRoomStartPoint] = useState<[number, number] | null>(null)
  const [roomPreviewEnd, setRoomPreviewEnd] = useState<[number, number] | null>(null)

  // State for custom-room mode (multi-point polygon)
  const [customRoomPoints, setCustomRoomPoints] = useState<Array<[number, number]>>([])
  const [customRoomPreviewEnd, setCustomRoomPreviewEnd] = useState<[number, number] | null>(null)

  // State for roof mode (two-click ridge line)
  const [roofStartPoint, setRoofStartPoint] = useState<[number, number] | null>(null)
  const [roofPreviewEnd, setRoofPreviewEnd] = useState<[number, number] | null>(null)

  // State for door mode (one-click placement with preview)
  const [doorPreviewPosition, setDoorPreviewPosition] = useState<[number, number] | null>(null)

  // State for window mode (one-click placement with preview)
  const [windowPreviewPosition, setWindowPreviewPosition] = useState<[number, number] | null>(null)

  // State for column mode (one-click placement with preview)
  const [columnPreviewPosition, setColumnPreviewPosition] = useState<[number, number] | null>(null)

  // State for delete mode (two-click selection)
  const [deleteStartPoint, setDeleteStartPoint] = useState<[number, number] | null>(null)
  const [deletePreviewEnd, setDeletePreviewEnd] = useState<[number, number] | null>(null)

  // State for tracking mouse cursor position (for proximity grid)
  const [cursorPosition, setCursorPosition] = useState<[number, number] | null>(null)

  // Helper function to clear all placement states and selections
  const clearPlacementStates = () => {
    setWallStartPoint(null)
    setWallPreviewEnd(null)
    setRoomStartPoint(null)
    setRoomPreviewEnd(null)
    setCustomRoomPoints([])
    setCustomRoomPreviewEnd(null)
    setRoofStartPoint(null)
    setRoofPreviewEnd(null)
    setDoorPreviewPosition(null)
    setWindowPreviewPosition(null)
    setColumnPreviewPosition(null)
    setDeleteStartPoint(null)
    setDeletePreviewEnd(null)
    setCursorPosition(null)
    // Clear all selections (building elements, images, and scans)
    setSelectedElements([])
    setSelectedImageIds([])
    setSelectedScanIds([])
  }

  // Clear cursor position when switching floors to prevent grid artifacts
  useEffect(() => {
    setCursorPosition(null)
  }, [selectedFloorId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        // Check if there's an active placement/deletion in progress
        const hasActivePlacement =
          wallStartPoint !== null ||
          roomStartPoint !== null ||
          customRoomPoints.length > 0 ||
          roofStartPoint !== null ||
          deleteStartPoint !== null

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
    roomStartPoint,
    customRoomPoints,
    deleteStartPoint,
    roofStartPoint,
    clearPlacementStates,
    selectedElements,
    selectedImageIds,
    selectedScanIds,
    handleDeleteSelectedElements,
    handleDeleteSelectedImages,
    handleDeleteSelectedScans,
  ])

  // Use constants instead of Leva controls
  const wallHeight = WALL_HEIGHT
  const tileSize = TILE_SIZE
  const showGrid = SHOW_GRID
  const gridOpacity = GRID_OPACITY

  const [isCameraEnabled, setIsCameraEnabled] = useState(false)
  const [hoveredWallIndex, setHoveredWallIndex] = useState<number | null>(null)
  const [hoveredRoofIndex, setHoveredRoofIndex] = useState<number | null>(null)
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

  const handleIntersectionClick = (x: number, y: number) => {
    // Don't handle clicks while camera is moving
    if (movingCamera) return

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
      // Wall mode: two-click line drawing
      if (wallStartPoint === null) {
        // First click: set start point
        setWallStartPoint([x, y])
      } else {
        // Second click: create wall using wallPreviewEnd (snapped position)
        if (wallPreviewEnd) {
          const [x1, y1] = wallStartPoint
          const [x2, y2] = wallPreviewEnd
          // Ensure wall is at least MIN_WALL_LENGTH
          const dx = Math.abs(x2 - x1) * TILE_SIZE
          const dy = Math.abs(y2 - y1) * TILE_SIZE
          const length = Math.sqrt(dx * dx + dy * dy)

          const absDxGrid = Math.abs(x2 - x1)
          const absDyGrid = Math.abs(y2 - y1)
          const isHorizontal = y2 === y1
          const isVertical = x2 === x1
          const isDiagonal = absDxGrid === absDyGrid // 45° diagonal

          if (length >= MIN_WALL_LENGTH && (isHorizontal || isVertical || isDiagonal)) {
            // Wall is valid (horizontal, vertical, or 45° diagonal, meets min length)
            const wallKey = `${x1},${y1}-${x2},${y2}`
            const currentWalls = Array.from(walls)
            if (!currentWalls.includes(wallKey)) {
              setWalls([...currentWalls, wallKey])
            }
          }
        }

        // Reset placement state
        setWallStartPoint(null)
        setWallPreviewEnd(null)
      }
    } else if (controlMode === 'building' && activeTool === 'roof') {
      // Roof mode: two-click rectangle (defines base footprint)
      if (roofStartPoint === null) {
        // First click: set start corner
        setRoofStartPoint([x, y])
      } else {
        // Second click: create roof from base rectangle
        if (roofPreviewEnd) {
          const [x1, y1] = roofStartPoint
          const [x2, y2] = roofPreviewEnd

          // Calculate base dimensions
          const width = Math.abs(x2 - x1)
          const depth = Math.abs(y2 - y1)

          // Ensure roof base is at least MIN_WALL_LENGTH
          if (width * TILE_SIZE >= MIN_WALL_LENGTH && depth * TILE_SIZE >= MIN_WALL_LENGTH) {
            // Calculate ridge line along the longer axis
            // Ridge runs parallel to the longer side, centered in the rectangle
            const minX = Math.min(x1, x2)
            const maxX = Math.max(x1, x2)
            const minY = Math.min(y1, y2)
            const maxY = Math.max(y1, y2)
            const centerX = (minX + maxX) / 2
            const centerY = (minY + maxY) / 2

            let ridgeStart: [number, number]
            let ridgeEnd: [number, number]
            let roofWidth: number // Distance from ridge to each edge in grid units

            if (width >= depth) {
              // Ridge runs along X axis (longer side)
              ridgeStart = [minX, centerY]
              ridgeEnd = [maxX, centerY]
              roofWidth = depth / 2
            } else {
              // Ridge runs along Y axis (longer side)
              ridgeStart = [centerX, minY]
              ridgeEnd = [centerX, maxY]
              roofWidth = width / 2
            }

            // Store roof with widths: "x1,y1-x2,y2:leftWidth,rightWidth"
            const roofKey = `${ridgeStart[0]},${ridgeStart[1]}-${ridgeEnd[0]},${ridgeEnd[1]}:${roofWidth * TILE_SIZE},${roofWidth * TILE_SIZE}`
            const currentRoofs = Array.from(getRoofsSet())
            if (!currentRoofs.includes(roofKey)) {
              setRoofs([...currentRoofs, roofKey])
            }
          }
        }

        // Reset placement state
        setRoofStartPoint(null)
        setRoofPreviewEnd(null)
      }
    } else if (controlMode === 'building' && activeTool === 'room') {
      // Room mode: two-click rectangle (4 walls)
      if (roomStartPoint === null) {
        // First click: set start corner
        setRoomStartPoint([x, y])
      } else {
        // Second click: create 4 walls forming a rectangle
        if (roomPreviewEnd) {
          const [x1, y1] = roomStartPoint
          const [x2, y2] = roomPreviewEnd

          // Create 4 walls: top, bottom, left, right
          const currentWalls = Array.from(walls)
          const newWalls = [
            `${x1},${y2}-${x2},${y2}`, // Top wall
            `${x1},${y1}-${x2},${y1}`, // Bottom wall
            `${x1},${y1}-${x1},${y2}`, // Left wall
            `${x2},${y1}-${x2},${y2}`, // Right wall
          ]
          setWalls([...currentWalls, ...newWalls])
        }

        // Reset placement state
        setRoomStartPoint(null)
        setRoomPreviewEnd(null)
      }
    } else if (controlMode === 'building' && activeTool === 'custom-room') {
      // Custom-room mode: multi-point polygon
      // Use the snapped preview position instead of raw x,y
      const snappedX = customRoomPreviewEnd ? customRoomPreviewEnd[0] : x
      const snappedY = customRoomPreviewEnd ? customRoomPreviewEnd[1] : y

      // Check if clicking on the first point to close the shape
      if (
        customRoomPoints.length >= 3 &&
        snappedX === customRoomPoints[0][0] &&
        snappedY === customRoomPoints[0][1]
      ) {
        // Complete the custom room polygon by creating walls between all points
        const currentWalls = Array.from(walls)
        const newWalls: string[] = []
        // Create walls between consecutive points (including closing wall)
        for (let i = 0; i < customRoomPoints.length; i++) {
          const [x1, y1] = customRoomPoints[i]
          const [x2, y2] = customRoomPoints[(i + 1) % customRoomPoints.length]
          newWalls.push(`${x1},${y1}-${x2},${y2}`)
        }
        setWalls([...currentWalls, ...newWalls])
        // Reset custom room state
        setCustomRoomPoints([])
        setCustomRoomPreviewEnd(null)
      } else {
        // Add snapped point to the list and reset preview
        setCustomRoomPoints((prev) => [...prev, [snappedX, snappedY]])
        // Reset preview so it recalculates from the new point on next hover
        setCustomRoomPreviewEnd(null)
      }
    } else if (controlMode === 'building' && activeTool === 'column') {
      // Column mode: one-click placement at intersection
      if (!selectedFloorId) return

      // Check if column already exists at this position
      const level = levels.find((l) => l.id === selectedFloorId)
      if (!level) return

      const existingColumn = level.children.find(
        (child) =>
          child.type === 'column' &&
          (child as any).position[0] === x &&
          (child as any).position[1] === y,
      )

      if (!existingColumn) {
        // Create column node
        const columnId = `col-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
        const columnNode = {
          id: columnId,
          type: 'column' as const,
          name: `Column at ${x},${y}`,
          position: [x, y] as [number, number],
          rotation: 0,
          size: [0.3, 0.3] as [number, number], // 30cm x 30cm column
          visible: true,
          opacity: 100,
          children: [] as [],
        }

        // Add column to level using node operation
        const updatedLevels = addColumnToLevel(levels, selectedFloorId, columnNode)
        updateLevels(updatedLevels)
      }
    }
    // Door placement is now handled by DoorPlacementPreview component's onClick
    // Deselect in building mode if no placement action was taken
    if (
      controlMode === 'building' &&
      wallStartPoint === null &&
      roofStartPoint === null &&
      roomStartPoint === null &&
      customRoomPoints.length === 0
    ) {
      setSelectedElements([])
    }
  }

  const handleIntersectionDoubleClick = () => {
    // Don't handle double-clicks while camera is moving
    if (movingCamera) return

    if (
      controlMode === 'building' &&
      activeTool === 'custom-room' &&
      customRoomPoints.length >= 1
    ) {
      // Add the current preview point (from the first click of the double-click)
      // But only if it's different from the last point
      let finalPoints = customRoomPoints
      if (customRoomPreviewEnd) {
        const lastPoint = customRoomPoints[customRoomPoints.length - 1]
        const isDifferent =
          lastPoint[0] !== customRoomPreviewEnd[0] || lastPoint[1] !== customRoomPreviewEnd[1]
        if (isDifferent) {
          finalPoints = [...customRoomPoints, customRoomPreviewEnd]
        }
      }

      // Create walls between consecutive points (NOT closing the shape)
      if (finalPoints.length >= 2) {
        const currentWalls = Array.from(walls)
        const newWalls: string[] = []
        // Create walls between consecutive points only (no closing wall)
        for (let i = 0; i < finalPoints.length - 1; i++) {
          const [x1, y1] = finalPoints[i]
          const [x2, y2] = finalPoints[i + 1]
          newWalls.push(`${x1},${y1}-${x2},${y2}`)
        }
        setWalls([...currentWalls, ...newWalls])
      }

      // Reset custom room state
      setCustomRoomPoints([])
      setCustomRoomPreviewEnd(null)
    }
  }

  const handleIntersectionHover = (x: number, y: number | null) => {
    // Only track cursor position for non-base levels (base level uses InfiniteGrid)
    const currentFloor = levels.find((level) => level.id === selectedFloorId)
    const currentLevel = currentFloor?.level || 0

    if (currentLevel > 0) {
      // Update cursor position for proximity grid on non-base levels
      if (y !== null) {
        setCursorPosition([x, y])
      } else {
        setCursorPosition(null)
      }
    } else {
      // On base level, don't track cursor position
      setCursorPosition(null)
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
    if (controlMode === 'building' && activeTool === 'wall') {
      // Wall mode: snap to horizontal, vertical, or 45° diagonal
      if (wallStartPoint && y !== null) {
        // Calculate projected point on same row, column, or 45° diagonal
        const [x1, y1] = wallStartPoint
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

        setWallPreviewEnd([projectedX, projectedY])
      } else if (!wallStartPoint) {
        setWallPreviewEnd(null)
      }
    } else if (controlMode === 'building' && activeTool === 'roof') {
      // Roof mode: show rectangle preview (base footprint snaps to grid)
      if (roofStartPoint && y !== null) {
        setRoofPreviewEnd([x, y])
      } else if (!roofStartPoint) {
        setRoofPreviewEnd(null)
      }
    } else if (controlMode === 'building' && activeTool === 'room') {
      // Room mode: show rectangle preview
      if (roomStartPoint && y !== null) {
        setRoomPreviewEnd([x, y])
      } else if (!roomStartPoint) {
        setRoomPreviewEnd(null)
      }
    } else if (controlMode === 'building' && activeTool === 'custom-room') {
      // Custom-room mode: show preview line to current hover point with snapping
      if (y !== null) {
        if (customRoomPoints.length > 0) {
          const lastPoint = customRoomPoints[customRoomPoints.length - 1]
          const [x1, y1] = lastPoint
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

          setCustomRoomPreviewEnd([projectedX, projectedY])
        } else {
          // No points yet, just follow the cursor
          setCustomRoomPreviewEnd([x, y])
        }
      } else {
        setCustomRoomPreviewEnd(null)
      }
    } else if (controlMode === 'building' && activeTool === 'door') {
      // Door mode: show preview at current grid position
      if (y !== null) {
        setDoorPreviewPosition([x, y])
      } else {
        setDoorPreviewPosition(null)
      }
    } else if (controlMode === 'building' && activeTool === 'window') {
      // Window mode: show preview at current grid position
      if (y !== null) {
        setWindowPreviewPosition([x, y])
      } else {
        setWindowPreviewPosition(null)
      }
    } else if (controlMode === 'building' && activeTool === 'column') {
      // Column mode: show preview at current grid position
      if (y !== null) {
        setColumnPreviewPosition([x, y])
      } else {
        setColumnPreviewPosition(null)
      }
    }
  }

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

  const handleWallRightClick = (e: any, wallSegment: WallSegment) => {
    e.stopPropagation()
    wallContextMenuTriggeredRef.current = true

    // Only show context menu if there are selected elements to delete
    if (selectedElements.length === 0) {
      return
    }

    // Get mouse position - try different approaches for R3F events
    let clientX, clientY

    if (e.nativeEvent) {
      // Standard DOM event
      clientX = e.nativeEvent.clientX
      clientY = e.nativeEvent.clientY
    } else if (e.pointer) {
      // Three.js pointer event - convert to screen coordinates
      const canvas = document.querySelector('canvas')
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        clientX = rect.left + ((e.pointer.x + 1) * rect.width) / 2
        clientY = rect.top + ((-e.pointer.y + 1) * rect.height) / 2
      }
    }

    if (clientX !== undefined && clientY !== undefined) {
      setContextMenuState({
        isOpen: true,
        position: { x: clientX, y: clientY },
        type: 'wall',
        wallSegment,
      })
    }
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

  console.log('levels in 3D view:', levels)

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
        {viewMode === 'level' &&
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
            })}

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
                    if (updates.scale !== undefined) {
                      updatedLevels = setNodeSize(updatedLevels, scan.id, [
                        updates.scale,
                        updates.scale,
                      ])
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
                              cursorPosition={cursorPosition}
                              fadeWidth={0.5}
                              floorId={floor.id}
                              gridSize={tileSize}
                              lineColor="#ffffff"
                              lineWidth={1.0}
                              maxSize={GRID_SIZE}
                              offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                              opacity={0.3}
                              padding={1.5}
                              previewCustomRoom={
                                customRoomPoints.length > 0
                                  ? { points: customRoomPoints, previewEnd: customRoomPreviewEnd }
                                  : null
                              }
                              previewRoof={
                                roofStartPoint && roofPreviewEnd
                                  ? { corner1: roofStartPoint, corner2: roofPreviewEnd }
                                  : null
                              }
                              previewRoom={
                                roomStartPoint && roomPreviewEnd
                                  ? { corner1: roomStartPoint, corner2: roomPreviewEnd }
                                  : null
                              }
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
                              cursorPosition={null}
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
                          cursorPosition={null}
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
                    {/* Only show interactive grid tiles for the active floor */}
                    {isActiveFloor && (
                      <GridTiles
                        controlMode={controlMode}
                        customRoomPoints={customRoomPoints}
                        customRoomPreviewEnd={customRoomPreviewEnd}
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
                        roofPreviewEnd={roofPreviewEnd}
                        roofStartPoint={roofStartPoint}
                        roomPreviewEnd={roomPreviewEnd}
                        roomStartPoint={roomStartPoint}
                        tileSize={tileSize}
                        wallHeight={wallHeight}
                        wallPreviewEnd={wallPreviewEnd}
                        wallStartPoint={wallStartPoint}
                      />
                    )}

                    {/* Walls component fetches its own data based on floorId */}
                    <Walls
                      controlMode={controlMode}
                      floorId={floor.id}
                      hoveredWallIndex={hoveredWallIndex}
                      isActive={isActiveFloor}
                      isCameraEnabled={isCameraEnabled}
                      isFullView={viewMode === 'full'}
                      key={`${floor.id}-${isActiveFloor}`}
                      movingCamera={movingCamera}
                      onDeleteWalls={handleDeleteSelectedElements}
                      onWallHover={setHoveredWallIndex}
                      onWallRightClick={handleWallRightClick}
                      selectedElements={selectedElements}
                      setControlMode={setControlMode}
                      setSelectedElements={setSelectedElements}
                      tileSize={tileSize}
                      wallHeight={wallHeight}
                    />

                    {/* Roofs component fetches its own data based on floorId */}
                    <Roofs
                      baseHeight={wallHeight}
                      controlMode={controlMode}
                      floorId={floor.id}
                      hoveredRoofIndex={hoveredRoofIndex}
                      isActive={isActiveFloor}
                      isCameraEnabled={isCameraEnabled}
                      isFullView={viewMode === 'full'}
                      key={`roof-${floor.id}-${isActiveFloor}`}
                      movingCamera={movingCamera}
                      onDeleteRoofs={handleDeleteSelectedElements}
                      onRoofHover={setHoveredRoofIndex}
                      onRoofRightClick={undefined}
                      selectedElements={selectedElements}
                      setControlMode={setControlMode}
                      setSelectedElements={setSelectedElements}
                      tileSize={tileSize}
                    />

                    {/* Columns component fetches its own data based on floorId */}
                    <Columns
                      columnHeight={wallHeight}
                      controlMode={controlMode}
                      floorId={floor.id}
                      isActive={isActiveFloor}
                      isFullView={viewMode === 'full'}
                      key={`column-${floor.id}-${isActiveFloor}`}
                      movingCamera={movingCamera}
                      selectedElements={selectedElements}
                      setControlMode={setControlMode}
                      setSelectedElements={setSelectedElements}
                      tileSize={tileSize}
                    />

                    {/* Column placement preview */}
                    {isActiveFloor &&
                      controlMode === 'building' &&
                      activeTool === 'column' &&
                      columnPreviewPosition && (
                        <ColumnShadowPreview
                          columnHeight={wallHeight}
                          position={columnPreviewPosition}
                          tileSize={tileSize}
                        />
                      )}

                    {/* Doors component renders placed doors */}
                    <Doors
                      floorId={floor.id}
                      isActive={isActiveFloor}
                      isFullView={viewMode === 'full'}
                      tileSize={tileSize}
                      wallHeight={wallHeight}
                    />

                    {/* Door placement preview */}
                    {isActiveFloor &&
                      controlMode === 'building' &&
                      activeTool === 'door' &&
                      doorPreviewPosition && (
                        <DoorPlacementPreview
                          existingDoors={currentFloorExistingDoors}
                          existingWindows={currentFloorExistingWindows}
                          floorId={floor.id}
                          mouseGridPosition={doorPreviewPosition}
                          onPlaced={() => setDoorPreviewPosition(null)}
                          tileSize={tileSize}
                          wallHeight={wallHeight}
                          wallSegments={currentFloorWallSegments}
                        />
                      )}

                    {/* Windows component renders placed windows */}
                    <Windows
                      floorId={floor.id}
                      isActive={isActiveFloor}
                      isFullView={viewMode === 'full'}
                      tileSize={tileSize}
                      wallHeight={wallHeight}
                    />

                    {/* Window placement preview */}
                    {isActiveFloor &&
                      controlMode === 'building' &&
                      activeTool === 'window' &&
                      windowPreviewPosition && (
                        <WindowPlacementPreview
                          existingDoors={currentFloorExistingDoors}
                          existingWindows={currentFloorExistingWindows}
                          floorId={floor.id}
                          mouseGridPosition={windowPreviewPosition}
                          onPlaced={() => setWindowPreviewPosition(null)}
                          tileSize={tileSize}
                          wallHeight={wallHeight}
                          wallSegments={currentFloorWallSegments}
                        />
                      )}
                  </group>
                </AnimatedLevel>
              )
            })}
        </group>

        <CustomControls />
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
