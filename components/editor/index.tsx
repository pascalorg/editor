'use client'

import { useState, useRef, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Environment, Grid, PerspectiveCamera, OrthographicCamera, Line } from '@react-three/drei'
import { useControls } from 'leva'
import { cn } from '@/lib/utils'
import { useEditorContext, type WallSegment } from '@/hooks/use-editor'
import { Trash2 } from 'lucide-react'
import { BuildingMenu } from '@/components/editor/building-menu'
import { ControlModeMenu } from '@/components/editor/control-mode-menu'
import { CustomControls } from '@/components/editor/custom-controls'
import { CameraSetup } from '@/components/editor/camera-setup'
import { Walls } from '@/components/editor/elements/wall'
import { GridTiles } from '@/components/editor/elements/grid'
import { ReferenceImage } from '@/components/editor/elements/reference-image'

const TILE_SIZE = 0.5 // 50cm grid spacing
const WALL_HEIGHT = 2.5 // 2.5m standard wall height
const MIN_WALL_LENGTH = 0.5 // 50cm minimum wall length
const GRID_SIZE = 30 // 30m x 30m
const GRID_DIVISIONS = Math.floor(GRID_SIZE / TILE_SIZE) // 60 divisions
const GRID_INTERSECTIONS = GRID_DIVISIONS + 1 // 61 intersections per axis

export default function Editor({ className }: { className?: string }) {
  const { walls, setWalls, images, wallSegments, selectedWallIds, setSelectedWallIds, handleDeleteSelectedWalls, undo, redo, activeTool, controlMode, setControlMode } = useEditorContext()

  const wallsGroupRef = useRef(null)
  const { setWallsGroupRef } = useEditorContext()

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
        // Cancel wall placement if in progress
        setWallStartPoint(null)
        setWallPreviewEnd(null)
        setControlMode('select')
      } else if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('select')
      } else if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setControlMode('delete')
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
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
  }, [undo, redo, setControlMode])

  const { wallHeight, tileSize, showGrid, gridOpacity, cameraType } = useControls({
    wallHeight: { value: WALL_HEIGHT, min: 1, max: 5, step: 0.1, label: 'Wall Height (m)' },
    tileSize: { value: TILE_SIZE, min: 0.1, max: 0.5, step: 0.01, label: 'Tile Size (m)' },
    showGrid: { value: true, label: 'Show Grid' },
    gridOpacity: { value: 0.3, min: 0, max: 1, step: 0.1, label: 'Grid Opacity' },
    cameraType: { value: 'perspective', options: { Perspective: 'perspective', Orthographic: 'orthographic' }, label: 'View Type' }
  })

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

  // State for two-click wall placement
  const [wallStartPoint, setWallStartPoint] = useState<[number, number] | null>(null)
  const [wallPreviewEnd, setWallPreviewEnd] = useState<[number, number] | null>(null)

  const handleIntersectionClick = (x: number, y: number) => {
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
  }

  const handleIntersectionHover = (x: number, y: number | null) => {
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

  const { imageOpacity, imageScale, imagePosition, imageRotation } = useControls('Reference Image', {
    imageOpacity: { value: 0.5, min: 0, max: 1, step: 0.1 },
    imageScale: { value: 1, min: 0.1, max: 5, step: 0.1 },
    imagePosition: { value: [0, 0], step: 0.1, joystick: 'invertY' },
    imageRotation: { value: 0, min: -Math.PI, max: Math.PI, step: 0.1 }
  }, { collapsed: true })

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
            position={[10, 0, 5]} 
            fov={50}
            near={0.1}
            far={1000}
          />
        ) : (
          <OrthographicCamera 
            makeDefault 
            position={[10, 0, 5]} 
            zoom={20}
            near={-1000}
            far={1000}
          />
        )}
        <CameraSetup />
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
        
        {/* Drei Grid for visual reference and snapping */}
        {showGrid && (
          <Grid
            position={[0, 0, 0]}
            args={[GRID_SIZE, GRID_SIZE]}
            cellSize={tileSize}
            cellThickness={0.5}
            cellColor="#aaaabf"
            sectionSize={tileSize * 5}
            sectionThickness={1}
            sectionColor="#9d4b4b"
            fadeDistance={GRID_SIZE * 2}
            fadeStrength={1}
            infiniteGrid={false}
            side={2}
            rotation={[Math.PI / 2, 0, 0]}
          />
        )}
        
        {/* Infinite dashed axis lines */}
        <Line 
          points={[[-1000, 0, 0.001], [1000, 0, 0.001]]} 
          lineWidth={1}
          dashed
          dashSize={0.5}
          gapSize={0.25}
          color="white"
          opacity={0.01}
          depthTest={false}
        />
        <Line 
          points={[[0, -1000, 0.001], [0, 1000, 0.001]]} 
          lineWidth={1}
          dashed
          dashSize={0.5}
          gapSize={0.25}
          color="white"
          opacity={0.01}
          depthTest={false}
        />
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
        
        {images.map((image) => (
          <ReferenceImage 
            key={image.id}
            url={image.url}
            opacity={imageOpacity}
            scale={imageScale}
            position={imagePosition}
            rotation={imageRotation}
          />
        ))}

        <group position={[-(GRID_SIZE) / 2, -(GRID_SIZE) / 2, 0]}>
          <GridTiles 
            intersections={intersections}
            tileSize={tileSize}
            walls={walls}
            onIntersectionClick={handleIntersectionClick}
            onIntersectionHover={handleIntersectionHover}
            wallStartPoint={wallStartPoint}
            wallPreviewEnd={wallPreviewEnd}
            opacity={gridOpacity}
            disableBuild={controlMode !== 'building' || activeTool !== 'wall'}
            wallHeight={wallHeight}
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
            onDeleteWalls={handleDeleteSelectedWalls}
          />
        </group>

        <CustomControls tileSize={tileSize} controlMode={controlMode} />
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

      <ControlModeMenu />
      <BuildingMenu />
    </div>
  )
}
