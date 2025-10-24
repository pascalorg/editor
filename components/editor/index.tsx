'use client'

import { BuildingMenu } from '@/components/editor/building-menu'
import { ControlModeMenu } from '@/components/editor/control-mode-menu'
import { GridTiles } from '@/components/editor/elements/grid'
import { ReferenceImage } from '@/components/editor/elements/reference-image'
import { Walls } from '@/components/editor/elements/wall'
import { useEditor, useEditorContext, type WallSegment } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import { Environment, GizmoHelper, GizmoViewport, Grid, Line, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CustomControls } from './custom-controls'

const TILE_SIZE = 0.5 // 50cm grid spacing
const WALL_HEIGHT = 2.5 // 2.5m standard wall height
const MIN_WALL_LENGTH = 0.5 // 50cm minimum wall length
const GRID_SIZE = 30 // 30m x 30m
const SHOW_GRID = true // Show grid by default
const GRID_OPACITY = 0.3 // Grid opacity
const CAMERA_TYPE = 'perspective' as 'perspective' | 'orthographic' // Camera type
const IMAGE_OPACITY = 0.5 // Reference image opacity
const IMAGE_SCALE = 1 // Reference image scale
const IMAGE_POSITION: [number, number] = [0, 0] // Reference image position
const IMAGE_ROTATION = 0 // Reference image rotation
const GRID_DIVISIONS = Math.floor(GRID_SIZE / TILE_SIZE) // 60 divisions
const GRID_INTERSECTIONS = GRID_DIVISIONS + 1 // 61 intersections per axis

export default function Editor({ className }: { className?: string }) {
  const { walls, setWalls, images, setImages, wallSegments, selectedWallIds, setSelectedWallIds, selectedImageIds, setSelectedImageIds, handleDeleteSelectedWalls, undo, redo, activeTool, controlMode, setControlMode, setActiveTool, movingCamera, setIsManipulatingImage } = useEditorContext()

  const wallsGroupRef = useRef(null)
  const { setWallsGroupRef } = useEditorContext()

  // State for two-click wall placement
  const [wallStartPoint, setWallStartPoint] = useState<[number, number] | null>(null)
  const [wallPreviewEnd, setWallPreviewEnd] = useState<[number, number] | null>(null)

  // State for room mode (rectangle with 4 walls)
  const [roomStartPoint, setRoomStartPoint] = useState<[number, number] | null>(null)
  const [roomPreviewEnd, setRoomPreviewEnd] = useState<[number, number] | null>(null)

  // State for custom-room mode (multi-point polygon)
  const [customRoomPoints, setCustomRoomPoints] = useState<Array<[number, number]>>([])
  const [customRoomPreviewEnd, setCustomRoomPreviewEnd] = useState<[number, number] | null>(null)

  // State for delete mode (two-click selection)
  const [deleteStartPoint, setDeleteStartPoint] = useState<[number, number] | null>(null)
  const [deletePreviewEnd, setDeletePreviewEnd] = useState<[number, number] | null>(null)
  
  // Helper function to clear all placement states and selections
  const clearPlacementStates = () => {
    setWallStartPoint(null)
    setWallPreviewEnd(null)
    setRoomStartPoint(null)
    setRoomPreviewEnd(null)
    setCustomRoomPoints([])
    setCustomRoomPreviewEnd(null)
    setDeleteStartPoint(null)
    setDeletePreviewEnd(null)
    // Clear all selections (walls and images)
    setSelectedWallIds(new Set([]))
    setSelectedImageIds(new Set([]))
  }

  useEffect(() => {
    setWallsGroupRef(wallsGroupRef.current)
  }, [setWallsGroupRef])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        // Check if there's an active placement/deletion in progress
        const hasActivePlacement = wallStartPoint !== null || roomStartPoint !== null || customRoomPoints.length > 0 || deleteStartPoint !== null

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
      }  else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        clearPlacementStates()
        // Default to 'wall' tool if no active tool when entering building mode
        if (!activeTool) {
          setActiveTool('wall')
        } else {
          setControlMode('building')
        }
      } else if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        clearPlacementStates()
        setControlMode('guide')
      }
       else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        if (e.shiftKey) {
          e.preventDefault()
          redo()
        } else {
          e.preventDefault()
          undo()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, setControlMode, setActiveTool, activeTool, wallStartPoint, roomStartPoint, customRoomPoints, deleteStartPoint, clearPlacementStates])

  // Use constants instead of Leva controls
  const wallHeight = WALL_HEIGHT
  const tileSize = TILE_SIZE
  const showGrid = SHOW_GRID
  const gridOpacity = GRID_OPACITY
  const cameraType = CAMERA_TYPE

  const [isCameraEnabled, setIsCameraEnabled] = useState(false)
  const [hoveredWallIndex, setHoveredWallIndex] = useState<number | null>(null)
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
      setContextMenuState(prev => ({ ...prev, isOpen: false }))
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
    seg2: [[number, number], [number, number]]
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

    const isDiagonal1 = !isHorizontal1 && !isVertical1 && Math.abs(dx1) === Math.abs(dy1)
    const isDiagonal2 = !isHorizontal2 && !isVertical2 && Math.abs(dx2) === Math.abs(dy2)

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
          remaining.push([[minX1, y1], [overlapStart, y1]])
        }
        if (maxX1 > overlapEnd) {
          remaining.push([[overlapEnd, y1], [maxX1, y1]])
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
          remaining.push([[x1, minY1], [x1, overlapStart]])
        }
        if (maxY1 > overlapEnd) {
          remaining.push([[x1, overlapEnd], [x1, maxY1]])
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
              remaining.push([[minX1, Math.round(startY)], [overlapStartX, Math.round(endY)]])
            }
            if (maxX1 > overlapEndX) {
              const startY = y1 + slope1 * (overlapEndX - x1)
              const endY = y1 + slope1 * (maxX1 - x1)
              remaining.push([[overlapEndX, Math.round(startY)], [maxX1, Math.round(endY)]])
            }

            return { overlap: true, remaining }
          }
        }
      }
    }

    return { overlap: false, remaining: [seg1] }
  }

  const handleDeleteWallPortion = (x1: number, y1: number, x2: number, y2: number) => {
    const deleteSegment: [[number, number], [number, number]] = [[x1, y1], [x2, y2]]

    setWalls(prev => {
      const next = new Set<string>()

      // Check each existing wall
      for (const wallKey of prev) {
        const parts = wallKey.split('-')
        if (parts.length !== 2) continue

        const [start, end] = parts
        const [wx1, wy1] = start.split(',').map(Number)
        const [wx2, wy2] = end.split(',').map(Number)

        const wallSegment: [[number, number], [number, number]] = [[wx1, wy1], [wx2, wy2]]

        // Check if this wall overlaps with the deletion segment
        const result = getOverlappingSegment(wallSegment, deleteSegment)

        if (result.overlap) {
          // Add remaining segments (if any)
          for (const remaining of result.remaining) {
            const [[rx1, ry1], [rx2, ry2]] = remaining
            next.add(`${rx1},${ry1}-${rx2},${ry2}`)
          }
        } else {
          // No overlap, keep the wall
          next.add(wallKey)
        }
      }

      return next
    })
  }

  const handleIntersectionClick = (x: number, y: number) => {
    // Don't handle clicks while camera is moving
    if (movingCamera) return;
    
    // Guide mode: deselect images when clicking on the grid
    if (controlMode === 'guide') {
      setSelectedImageIds(new Set([]))
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
            setWalls(prev => {
              const next = new Set(prev)
              next.add(wallKey)
              return next
            })
          }
        }

        // Reset placement state
        setWallStartPoint(null)
        setWallPreviewEnd(null)
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
          setWalls(prev => {
            const next = new Set(prev)
            // Top wall
            next.add(`${x1},${y2}-${x2},${y2}`)
            // Bottom wall
            next.add(`${x1},${y1}-${x2},${y1}`)
            // Left wall
            next.add(`${x1},${y1}-${x1},${y2}`)
            // Right wall
            next.add(`${x2},${y1}-${x2},${y2}`)
            return next
          })
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
      if (customRoomPoints.length >= 3 && snappedX === customRoomPoints[0][0] && snappedY === customRoomPoints[0][1]) {
        // Complete the custom room polygon by creating walls between all points
        setWalls(prev => {
          const next = new Set(prev)
          // Create walls between consecutive points (including closing wall)
          for (let i = 0; i < customRoomPoints.length; i++) {
            const [x1, y1] = customRoomPoints[i]
            const [x2, y2] = customRoomPoints[(i + 1) % customRoomPoints.length]
            next.add(`${x1},${y1}-${x2},${y2}`)
          }
          return next
        })
        // Reset custom room state
        setCustomRoomPoints([])
        setCustomRoomPreviewEnd(null)
      } else {
        // Add snapped point to the list and reset preview
        setCustomRoomPoints(prev => [...prev, [snappedX, snappedY]])
        // Reset preview so it recalculates from the new point on next hover
        setCustomRoomPreviewEnd(null)
      }
    }
  }

  const handleIntersectionDoubleClick = () => {
    // Don't handle double-clicks while camera is moving
    if (movingCamera) return;
    
    if (controlMode === 'building' && activeTool === 'custom-room' && customRoomPoints.length >= 1) {
      // Add the current preview point (from the first click of the double-click)
      // But only if it's different from the last point
      let finalPoints = customRoomPoints
      if (customRoomPreviewEnd) {
        const lastPoint = customRoomPoints[customRoomPoints.length - 1]
        const isDifferent = lastPoint[0] !== customRoomPreviewEnd[0] || lastPoint[1] !== customRoomPreviewEnd[1]
        if (isDifferent) {
          finalPoints = [...customRoomPoints, customRoomPreviewEnd]
        }
      }

      // Create walls between consecutive points (NOT closing the shape)
      if (finalPoints.length >= 2) {
        setWalls(prev => {
          const next = new Set(prev)
          // Create walls between consecutive points only (no closing wall)
          for (let i = 0; i < finalPoints.length - 1; i++) {
            const [x1, y1] = finalPoints[i]
            const [x2, y2] = finalPoints[i + 1]
            next.add(`${x1},${y1}-${x2},${y2}`)
          }
          return next
        })
      }

      // Reset custom room state
      setCustomRoomPoints([])
      setCustomRoomPreviewEnd(null)
    }
  }

  const handleIntersectionHover = (x: number, y: number | null) => {
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
    }
  }

  const handleCanvasRightClick = (e: React.MouseEvent) => {
    // Only show canvas context menu if no wall was right-clicked
    if (!wallContextMenuTriggeredRef.current) {
      setContextMenuState({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        type: 'wall'
      })
    }
    wallContextMenuTriggeredRef.current = false
  }

  const handleWallRightClick = (e: any, wallSegment: WallSegment) => {
    e.stopPropagation()
    wallContextMenuTriggeredRef.current = true

    // Only show context menu if there are selected walls to delete
    if (selectedWallIds.size === 0) {
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
        clientX = rect.left + (e.pointer.x + 1) * rect.width / 2
        clientY = rect.top + (-e.pointer.y + 1) * rect.height / 2
      }
    }

    if (clientX !== undefined && clientY !== undefined) {
      setContextMenuState({
        isOpen: true,
        position: { x: clientX, y: clientY },
        type: 'wall',
        wallSegment
      })
    }
  }

  const handleDeleteWall = () => {
    if (contextMenuState.wallSegment) {
      // Select the wall segment and delete it
      setSelectedWallIds(new Set([contextMenuState.wallSegment.id]))
      handleDeleteSelectedWalls()
    }
    setContextMenuState(prev => ({ ...prev, isOpen: false }))
  }

  const handleCloseContextMenu = () => {
    setContextMenuState(prev => ({ ...prev, isOpen: false }))
  }

  // Use constants for reference image
  const imageOpacity = IMAGE_OPACITY
  const imageScale = IMAGE_SCALE
  const imagePosition = IMAGE_POSITION
  const imageRotation = IMAGE_ROTATION

  const currentLevel = useEditor(state => state.currentLevel);

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        className={cn('bg-[#303035]', className)}
        onContextMenu={(e) => {
          // Prevent browser context menu
          e.preventDefault();
        }}
      >
        {cameraType === 'perspective' ? (
          <PerspectiveCamera
            makeDefault
            position={[10, 10, 10]}
            fov={50}
            near={0.1}
            far={1000}
          />
        ) : (
          <OrthographicCamera
            makeDefault
            position={[10, 10, 10]}
            zoom={20}
            near={-1000}
            far={1000}
          />
        )}
        {/* <fog attach="fog" args={['#17171b', 30, 40]} /> */}
        <color attach="background" args={['#17171b']} />
        <ambientLight intensity={0.5} />
        <directionalLight 
          position={[10, 10, 5]} 
          intensity={1} 
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-15}
          shadow-camera-right={15}
          shadow-camera-top={15}
          shadow-camera-bottom={-15}
        />

        {/* LEVELS */}
        <group position-y={10 * ((currentLevel|| 1) - 1) }>
        {/* Drei Grid for visual reference only - not interactive */}
        {showGrid && (
          <group raycast={() => null}>
            <Grid
              position={[0, 0, 0]}
              args={[GRID_SIZE, GRID_SIZE]}
              cellSize={tileSize}
              cellThickness={0.5}
              cellColor="#aaaabf"
              sectionSize={tileSize * 2}
              sectionThickness={1}
              sectionColor="#9d4b4b"
              fadeDistance={GRID_SIZE * 2}
              fadeStrength={1}
              infiniteGrid={false}
              side={2}
            />
          </group>
        )}
        
        {/* Infinite dashed axis lines - visual only, not interactive */}
        <group raycast={() => null}>
          {/* X axis (red) */}
          <Line
            points={[[-1000, 0, 0], [1000, 0, 0]]}
            lineWidth={1}
            dashed
            dashSize={0.5}
            gapSize={0.25}
            color="white"
            opacity={0.01}
            depthTest={false}
          />
          {/* Y axis (green) - vertical */}
          <Line
            points={[[0, -1000, 0], [0, 1000, 0]]}
            lineWidth={1}
            dashed
            dashSize={0.5}
            gapSize={0.25}
            color="white"
            opacity={0.01}
            depthTest={false}
          />
          {/* Z axis (blue) */}
          <Line
            points={[[0, 0, -1000], [0, 0, 1000]]}
            lineWidth={1}
            dashed
            dashSize={0.5}
            gapSize={0.25}
            color="white"
            opacity={0.01}
            depthTest={false}
          />
        </group>
        
        {images.map((image) => (
          <ReferenceImage 
            key={image.id}
            id={image.id}
            url={image.url}
            opacity={imageOpacity}
            scale={image.scale}
            position={image.position}
            rotation={image.rotation}
            isSelected={selectedImageIds.has(image.id)}
            controlMode={controlMode}
            movingCamera={movingCamera}
            onSelect={() => setSelectedImageIds(new Set([image.id]))}
            onUpdate={(updates, pushToUndo = true) => setImages(images.map(i => i.id === image.id ? { ...i, ...updates } : i), pushToUndo)}
            onManipulationStart={() => setIsManipulatingImage(true)}
            onManipulationEnd={() => setIsManipulatingImage(false)}
          />
        ))}

        <group position={[-(GRID_SIZE) / 2, 0, -(GRID_SIZE) / 2]}>
          <GridTiles
            intersections={intersections}
            tileSize={tileSize}
            walls={walls}
            onIntersectionClick={handleIntersectionClick}
            onIntersectionDoubleClick={handleIntersectionDoubleClick}
            onIntersectionHover={handleIntersectionHover}
            wallStartPoint={wallStartPoint}
            wallPreviewEnd={wallPreviewEnd}
            roomStartPoint={roomStartPoint}
            roomPreviewEnd={roomPreviewEnd}
            customRoomPoints={customRoomPoints}
            customRoomPreviewEnd={customRoomPreviewEnd}
            deleteStartPoint={deleteStartPoint}
            deletePreviewEnd={deletePreviewEnd}
            opacity={gridOpacity}
            disableBuild={(controlMode === 'building' && !activeTool) || controlMode === 'select' || controlMode === 'guide'}
            wallHeight={wallHeight}
            controlMode={controlMode}
          />
          <Walls
            wallSegments={wallSegments}
            tileSize={tileSize}
            wallHeight={wallHeight}
            hoveredWallIndex={hoveredWallIndex}
            selectedWallIds={selectedWallIds}
            setSelectedWallIds={setSelectedWallIds}
            onWallHover={setHoveredWallIndex}
            onWallRightClick={handleWallRightClick}
            isCameraEnabled={isCameraEnabled}
            ref={wallsGroupRef}
            controlMode={controlMode}
            movingCamera={movingCamera}
            onDeleteWalls={handleDeleteSelectedWalls}
          />
        </group>
        </group>

        <CustomControls />
        <Environment preset="city" />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
        </GizmoHelper>
        {/* <Stats/> */}
      </Canvas>

      {contextMenuState.isOpen && contextMenuState.type === 'wall' && selectedWallIds.size > 0 && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground border rounded-md shadow-lg p-1 min-w-[8rem]"
          style={{
            top: `${contextMenuState.position.y}px`,
            left: `${contextMenuState.position.x}px`,
          }}
        >
          {contextMenuState.wallSegment && (
            <div
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                handleDeleteSelectedWalls();
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete Selected Walls
            </div>
          )}
        </div>
      )}

      <ControlModeMenu onModeChange={clearPlacementStates} />
      <BuildingMenu />
    </div>
  )
}
