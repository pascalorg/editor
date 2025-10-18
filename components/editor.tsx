'use client'

import { useState, memo, useRef, useMemo, useEffect, forwardRef, Ref } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, OrbitControls, Environment, Grid, Stats, PerspectiveCamera, OrthographicCamera } from '@react-three/drei'
import { useControls } from 'leva'
import { cn } from '@/lib/utils'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { useEditorContext, WallSegment } from '@/hooks/use-editor'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Trash2 } from 'lucide-react'
import { Vector2, Vector3, Plane, Raycaster } from 'three'

const TILE_SIZE = 0.15 // 15cm
const WALL_HEIGHT = 2.5 // 2.5m standard wall height
const GRID_SIZE = 30 // 30m x 30m
const GRID_ROWS = Math.floor(GRID_SIZE / TILE_SIZE) // 200 tiles
const GRID_COLS = Math.floor(GRID_SIZE / TILE_SIZE) // 200 tiles

type WallTile = {
  x: number
  y: number
}

export default function Editor({ className }: { className?: string }) {
  const { walls, setWalls, imageURL, wallSegments, selectedWallIds, setSelectedWallIds, handleDeleteSelectedWalls, undo, redo } = useEditorContext()

  const wallsGroupRef = useRef(null)
  const { setWallsGroupRef } = useEditorContext()

  useEffect(() => {
    setWallsGroupRef(wallsGroupRef.current)
  }, [setWallsGroupRef])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
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
  }, [undo, redo])

  const { wallHeight, tileSize, showGrid, gridOpacity, cameraType } = useControls({
    wallHeight: { value: WALL_HEIGHT, min: 1, max: 5, step: 0.1, label: 'Wall Height (m)' },
    tileSize: { value: TILE_SIZE, min: 0.1, max: 0.5, step: 0.01, label: 'Tile Size (m)' },
    showGrid: { value: true, label: 'Show Grid' },
    gridOpacity: { value: 0.3, min: 0, max: 1, step: 0.1, label: 'Grid Opacity' },
    cameraType: { value: 'perspective', options: { Perspective: 'perspective', Orthographic: 'orthographic' }, label: 'View Type' }
  })

  const [isCameraEnabled, setIsCameraEnabled] = useState(false)
  const [hoveredWallIndex, setHoveredWallIndex] = useState<number | null>(null)
  const [hoveredFace, setHoveredFace] = useState<{
    wallIndex: number
    faceNormal: THREE.Vector3
    facePosition: THREE.Vector3
  } | null>(null)
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean
    position: { x: number; y: number }
    type: 'canvas' | 'wall'
    wallSegment?: WallSegment
  }>({ isOpen: false, position: { x: 0, y: 0 }, type: 'canvas' })
  const wallContextMenuTriggeredRef = useRef(false)
  const [draggingFace, setDraggingFace] = useState<{
    wallIndex: number;
    segment: WallSegment;
    normal: THREE.Vector3;
    originalPoint: THREE.Vector3;
    isEndFace: boolean;
    sign: number;
    axis: 'x' | 'y';
  } | null>(null)
  const [previewNum, setPreviewNum] = useState(0)
  const [currentMouse, setCurrentMouse] = useState({x: 0, y: 0})
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), [])

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

  useEffect(() => {
    if (!draggingFace) return

    const handleDragMove = (event: PointerEvent) => {
      setCurrentMouse({x: event.clientX, y: event.clientY})
    }

    const handleDragUp = (event: PointerEvent) => {
      if (draggingFace && previewNum > 0) {
        setWalls(prev => {
          const next = new Set(prev)
          const {segment: s, isEndFace, sign} = draggingFace

          if (isEndFace) {
            const fixedMin = s.minFixed
            const fixedMax = s.maxFixed
            const varyingSign = sign
            for (let k = 1; k <= previewNum; k++) {
              const offset = varyingSign > 0 ? s.endVarying + k : s.startVarying - k
              for (let f = fixedMin; f <= fixedMax; f++) {
                const tileX = s.isHorizontal ? offset : f
                const tileY = s.isHorizontal ? f : offset
                next.add(`${tileX},${tileY}`)
              }
            }
          } else {
            const fixedSign = sign
            for (let k = 1; k <= previewNum; k++) {
              const newFixed = fixedSign > 0 ? s.maxFixed + k : s.minFixed - k
              for (let v = s.startVarying; v <= s.endVarying; v++) {
                const tileX = s.isHorizontal ? v : newFixed
                const tileY = s.isHorizontal ? newFixed : v
                next.add(`${tileX},${tileY}`)
              }
            }
          }
          return next
        })
      }
      document.removeEventListener('pointermove', handleDragMove)
      document.removeEventListener('pointerup', handleDragUp)
      setDraggingFace(null)
      setPreviewNum(0)
    }

    document.addEventListener('pointermove', handleDragMove)
    document.addEventListener('pointerup', handleDragUp)

    return () => {
      document.removeEventListener('pointermove', handleDragMove)
      document.removeEventListener('pointerup', handleDragUp)
    }
  }, [draggingFace, previewNum, setWalls, tileSize])

  const UpdatePreview = () => {
    const { camera, size } = useThree()
    useFrame(() => {
      if (!draggingFace) {
        setPreviewNum(0)
        return
      }
      const mouse = new Vector2()
      mouse.x = (currentMouse.x / size.width) * 2 - 1
      mouse.y = - (currentMouse.y / size.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const intersectPoint = new Vector3()
      if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
        const { originalPoint, normal, axis } = draggingFace
        const coord = axis === 'x' ? intersectPoint.x : intersectPoint.y
        const original_coord = axis === 'x' ? originalPoint.x : originalPoint.y
        const adjustedDelta = draggingFace.sign * (coord - original_coord) / tileSize
        setPreviewNum(Math.max(0, Math.floor(adjustedDelta)))
      }
    })
    return null
  }

  const rows = Math.floor(GRID_SIZE / tileSize)
  const cols = Math.floor(GRID_SIZE / tileSize)

  const handleTileInteract = (x: number, y: number, action: 'toggle' | 'add') => {
    const key = `${x},${y}`
    setWalls(prev => {
      const next = new Set(prev)
      if (action === 'toggle') {
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
      } else if (action === 'add' && !next.has(key)) {
        next.add(key)
      }
      return next
    })
  }

  const handleCanvasRightClick = (e: React.MouseEvent) => {
    // Only show canvas context menu if no wall was right-clicked
    if (!wallContextMenuTriggeredRef.current) {
      setContextMenuState({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        type: 'canvas'
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
          // Don't show context menu when camera controls are enabled (spacebar held)
          if (isCameraEnabled) {
            return;
          }
          // Only prevent default if we're showing our own context menu
          if (!wallContextMenuTriggeredRef.current) {
            e.preventDefault()
          }
          handleCanvasRightClick(e)
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
        
        {imageURL && (
          <ReferenceImage 
            url={imageURL}
            opacity={imageOpacity}
            scale={imageScale}
            position={imagePosition}
            rotation={imageRotation}
          />
        )}

        <group position={[-(cols * tileSize) / 2, -(rows * tileSize) / 2, 0]}>
          <GridTiles 
            rows={rows} 
            cols={cols} 
            tileSize={tileSize}
            walls={walls}
            onTileInteract={handleTileInteract}
            opacity={gridOpacity}
            disableBuild={isCameraEnabled || !!draggingFace}
          />
          <Walls
            wallSegments={wallSegments}
            tileSize={tileSize}
            wallHeight={wallHeight}
            hoveredWallIndex={hoveredWallIndex}
            hoveredFace={hoveredFace}
            selectedWallIds={selectedWallIds}
            setSelectedWallIds={setSelectedWallIds}
            onWallHover={setHoveredWallIndex}
            onWallRightClick={handleWallRightClick}
            onFaceHover={setHoveredFace}
            isCameraEnabled={isCameraEnabled}
            ref={wallsGroupRef}
            setDraggingFace={setDraggingFace}
            draggingFace={draggingFace}
            previewNum={previewNum}
          />
          <FaceHighlight
            wallSegments={wallSegments}
            tileSize={tileSize}
            wallHeight={wallHeight}
            hoveredFace={hoveredFace}
          />
          <UpdatePreview />
        </group>

        <OrbitControls 
          makeDefault 
          target={[0, 0, 0]}
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2}
          screenSpacePanning={true}
          enabled={isCameraEnabled}
        />
        <Environment preset="city" />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
        </GizmoHelper>
        <Stats/>
      </Canvas>

      {contextMenuState.isOpen && (contextMenuState.type === 'canvas' || (contextMenuState.type === 'wall' && selectedWallIds.size > 0)) && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground border rounded-md shadow-lg p-1 min-w-[8rem]"
          style={{
            left: contextMenuState.position.x,
            top: contextMenuState.position.y,
          }}
        >
          {contextMenuState.type === 'wall' && contextMenuState.wallSegment && selectedWallIds.size > 0 && (
            <div
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
              onClick={handleDeleteWall}
            >
              <Trash2 className="h-4 w-4" />
              Delete Wall
            </div>
          )}
          {contextMenuState.type === 'canvas' && (
            <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-50 cursor-not-allowed">
              Canvas Options (Coming Soon)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

type GridTilesProps = {
  rows: number
  cols: number
  tileSize: number
  walls: Set<string>
  onTileInteract: (x: number, y: number, action: 'toggle' | 'add') => void
  opacity: number
  disableBuild?: boolean
}

const GridTiles = memo(({ rows, cols, tileSize, walls, onTileInteract, opacity, disableBuild = false }: GridTilesProps) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hoveredTile, setHoveredTile] = useState<{ x: number; y: number } | null>(null)
  const isDraggingRef = useRef(false)
  const hasMovedRef = useRef(false)
  const initialTileRef = useRef<{x: number, y: number} | null>(null)
  const prevHoveredRef = useRef<{x: number, y: number} | null>(null)

  const handlePointerMove = (e: any) => {
    e.stopPropagation()
    
    if (e.uv) {
      const x = Math.floor(e.uv.x * cols)
      const y = Math.floor(e.uv.y * rows)
      
      const newHovered = (x >= 0 && x < cols && y >= 0 && y < rows) ? {x, y} : null
      setHoveredTile(newHovered)
      
      if (isDraggingRef.current && newHovered) {
        if (!prevHoveredRef.current || prevHoveredRef.current.x !== newHovered.x || prevHoveredRef.current.y !== newHovered.y) {
          hasMovedRef.current = true
          onTileInteract(newHovered.x, newHovered.y, 'add')
          prevHoveredRef.current = newHovered
        }
      } else if (!newHovered) {
        prevHoveredRef.current = null
      }
    } else {
      setHoveredTile(null)
      prevHoveredRef.current = null
    }
  }

  const handlePointerDown = (e: any) => {
    e.stopPropagation()
    if (disableBuild || !e.uv) return
    const x = Math.floor(e.uv.x * cols)
    const y = Math.floor(e.uv.y * rows)
    if (x < 0 || x >= cols || y < 0 || y >= rows) return
    initialTileRef.current = {x, y}
    isDraggingRef.current = true
    hasMovedRef.current = false
    prevHoveredRef.current = {x, y}
    // Place the wall immediately on pointer down
    onTileInteract(x, y, 'add')
    document.addEventListener('pointerup', handlePointerUp)
  }

  const handlePointerUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      // If no movement occurred (single click), toggle the wall that was added on pointer down
      if (!hasMovedRef.current && initialTileRef.current) {
        onTileInteract(initialTileRef.current.x, initialTileRef.current.y, 'toggle')
      }
      // If movement occurred, keep the wall that was added on pointer down
    }
    document.removeEventListener('pointerup', handlePointerUp)
  }

  return (
    <>
      <mesh
        ref={meshRef}
        position={[(cols * tileSize) / 2, (rows * tileSize) / 2, 0.001]}
        rotation={[0, 0, 0]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          setHoveredTile(null)
          prevHoveredRef.current = null
        }}
      >
        <planeGeometry args={[cols * tileSize, rows * tileSize]} />
        <meshStandardMaterial 
          color="#404045"
          transparent
          opacity={opacity}
        />
      </mesh>
      
      {hoveredTile && !walls.has(`${hoveredTile.x},${hoveredTile.y}`) && (
        <mesh
          position={[
            hoveredTile.x * tileSize + tileSize / 2,
            hoveredTile.y * tileSize + tileSize / 2,
            0.002
          ]}
          rotation={[0, 0, 0]}
        >
          <planeGeometry args={[tileSize * 0.95, tileSize * 0.95]} />
          <meshStandardMaterial 
            color="#5a5a5f"
            transparent
            opacity={0.6}
          />
        </mesh>
      )}
      
      {Array.from(walls).map(key => {
        const [x, y] = key.split(',').map(Number)
        return (
          <mesh
            key={key}
            position={[
              x * tileSize + tileSize / 2,
              y * tileSize + tileSize / 2,
              0.002
            ]}
            rotation={[0, 0, 0]}
          >
            <planeGeometry args={[tileSize * 0.95, tileSize * 0.95]} />
            <meshStandardMaterial 
              color="#9d4b4b"
              transparent
              opacity={0.8}
            />
          </mesh>
        )
      })}
    </>
  )
})

type WallsProps = {
  wallSegments: WallSegment[]
  tileSize: number
  wallHeight: number
  hoveredWallIndex: number | null
  hoveredFace: {
    wallIndex: number
    faceNormal: THREE.Vector3
    facePosition: THREE.Vector3
  } | null
  selectedWallIds: Set<string>
  setSelectedWallIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onWallHover: (index: number | null) => void
  onFaceHover: (face: { wallIndex: number; faceNormal: THREE.Vector3; facePosition: THREE.Vector3 } | null) => void
  isCameraEnabled?: boolean
  setDraggingFace: (info: any) => void
  draggingFace: {
    wallIndex: number
    segment: WallSegment
    normal: THREE.Vector3
    originalPoint: THREE.Vector3
    isEndFace: boolean
    sign: number
    axis: 'x' | 'y'
  } | null
  previewNum: number
}

const Walls = memo(forwardRef(({ wallSegments, tileSize, wallHeight, hoveredWallIndex, hoveredFace, selectedWallIds, setSelectedWallIds, onWallHover, onWallRightClick, onFaceHover, isCameraEnabled, setDraggingFace, draggingFace, previewNum }: WallsProps & { onWallRightClick?: (e: any, wallSegment: WallSegment) => void }, ref: Ref<THREE.Group>) => {
  return (
    <group ref={ref}>
      {wallSegments.map((seg, i) => {
        let width, depth, posX, posY;
        const height = wallHeight;
        const isSelected = selectedWallIds.has(seg.id);
        const isHovered = hoveredWallIndex === i;
        const isDragged = draggingFace?.wallIndex === i && previewNum > 0

        let minF = seg.minFixed
        let maxF = seg.maxFixed
        let startV = seg.startVarying
        let endV = seg.endVarying

        if (isDragged) {
          const sign = draggingFace.sign
          const isEnd = draggingFace.isEndFace
          if (isEnd) {
            if (sign > 0) endV += previewNum
            else startV -= previewNum
          } else {
            if (sign > 0) maxF += previewNum
            else minF -= previewNum
          }
        }

        if (seg.isHorizontal) {
          width = (endV - startV + 1) * tileSize;
          depth = (maxF - minF + 1) * tileSize;
          posX = startV * tileSize + width / 2;
          posY = minF * tileSize + depth / 2;
        } else {
          width = (maxF - minF + 1) * tileSize;
          depth = (endV - startV + 1) * tileSize;
          posX = minF * tileSize + width / 2;
          posY = startV * tileSize + depth / 2;
        }

        // Determine color based on selection and hover state
        let color = "#aaaabf"; // default
        let emissive = "#000000";

        if (isSelected && isHovered) {
          color = "#ff4444"; // selected and hovered
          emissive = "#441111";
        } else if (isSelected) {
          color = "#ff8888"; // selected
          emissive = "#331111";
        } else if (isHovered) {
          color = "#ff6b6b"; // hovered
          emissive = "#331111";
        }

        return (
          <mesh
            key={seg.id}
            position={[posX, posY, height / 2]}
            castShadow
            receiveShadow
            onPointerEnter={(e) => {
              e.stopPropagation();
              onWallHover(i);
            }}
            onPointerLeave={(e) => {
              e.stopPropagation();
              onWallHover(null);
              onFaceHover(null);
            }}
            onPointerMove={(e) => {
              e.stopPropagation();
              if (draggingFace) {
                onFaceHover(null);
                return;
              }

              // Face detection using raycasting
              if (e.intersections && e.intersections.length > 0) {
                const intersection = e.intersections[0];
                if (intersection.face) {
                  const normal = intersection.face.normal.clone();
                  // Transform normal to world space
                  normal.transformDirection(e.object.matrixWorld);

                  // Only highlight vertical faces (exclude top/bottom)
                  if (Math.abs(normal.z) < 0.1) {
                    const facePosition = intersection.point.clone();
                    onFaceHover({
                      wallIndex: i,
                      faceNormal: normal,
                      facePosition: facePosition
                    });
                  } else {
                    onFaceHover(null);
                  }
                }
              }
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              // Check for right-click (button 2) and camera not enabled and walls selected
              if (e.button === 2 && !isCameraEnabled && selectedWallIds.size > 0) {
                // Prevent default browser context menu
                if (e.nativeEvent) {
                  e.nativeEvent.preventDefault();
                }
                onWallRightClick?.(e, seg);
              }
              if (e.button === 0 && isSelected) {
                e.stopPropagation()
                const intersection = e.intersections[0]
                if (intersection && intersection.face) {
                  const normal = intersection.face.normal.clone().transformDirection(e.object.matrixWorld)
                  if (Math.abs(normal.z) < 0.1) {
                    const axis = Math.abs(normal.x) > Math.abs(normal.y) ? 'x' : 'y'
                    const sign = Math.sign(normal[axis])
                    const isEndFace = (seg.isHorizontal && axis === 'x') || (!seg.isHorizontal && axis === 'y')
                    setDraggingFace({
                      wallIndex: i,
                      segment: seg,
                      normal,
                      originalPoint: intersection.point.clone(),
                      isEndFace,
                      sign,
                      axis
                    })
                    return // Prevent selection click
                  }
                }
              }
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
            }}
            onContextMenu={(e) => {
              // Prevent default browser context menu for walls (only when camera not enabled and walls selected)
              if (!isCameraEnabled && selectedWallIds.size > 0) {
                e.stopPropagation();
                if (e.nativeEvent) {
                  e.nativeEvent.preventDefault();
                }
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedWallIds(prev => {
                const next = new Set(prev);
                if (e.shiftKey) {
                  // Shift+click: add/remove from selection
                  if (next.has(seg.id)) {
                    next.delete(seg.id);
                  } else {
                    next.add(seg.id);
                  }
                } else {
                  // Regular click: select only this wall
                  next.clear();
                  next.add(seg.id);
                }
                return next;
              });
            }}
          >
            <boxGeometry args={[width, depth, height]} />
            <meshStandardMaterial
              color={color}
              roughness={0.7}
              metalness={0.1}
              emissive={emissive}
            />
          </mesh>
        );
      })}
    </group>
  );
}));

const FaceHighlight = ({ wallSegments, tileSize, wallHeight, hoveredFace }: {
  wallSegments: WallSegment[]
  tileSize: number
  wallHeight: number
  hoveredFace: {
    wallIndex: number
    faceNormal: THREE.Vector3
    facePosition: THREE.Vector3
  } | null
}) => {
  if (!hoveredFace) return null;

  const seg = wallSegments[hoveredFace.wallIndex];
  if (!seg) return null;

  let width, depth, posX, posY;
  const height = wallHeight;

  let minF = seg.minFixed
  let maxF = seg.maxFixed
  let startV = seg.startVarying
  let endV = seg.endVarying

  if (seg.isHorizontal) {
    width = (endV - startV + 1) * tileSize;
    depth = (maxF - minF + 1) * tileSize;
    posX = startV * tileSize + width / 2;
    posY = minF * tileSize + depth / 2;
  } else {
    width = (maxF - minF + 1) * tileSize;
    depth = (endV - startV + 1) * tileSize;
    posX = minF * tileSize + width / 2;
    posY = startV * tileSize + depth / 2;
  }

  // Determine which face based on normal
  const normal = hoveredFace.faceNormal;
  let faceCenterX = posX;
  let faceCenterY = posY;
  let faceCenterZ = height / 2;

  // Face center offsets based on normal direction
  if (Math.abs(normal.x) > 0.9) { // Left/Right face
    faceCenterX += normal.x * width / 2;
  } else if (Math.abs(normal.y) > 0.9) { // Front/Back face
    faceCenterY += normal.y * depth / 2;
  }

  // Create a rectangle outline for the specific face
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const halfHeight = height / 2;

  let corners: THREE.Vector3[];

  if (Math.abs(normal.x) > 0.9) { // Left/Right face - YZ plane
    corners = [
      new THREE.Vector3(faceCenterX, faceCenterY - halfDepth, faceCenterZ - halfHeight),
      new THREE.Vector3(faceCenterX, faceCenterY + halfDepth, faceCenterZ - halfHeight),
      new THREE.Vector3(faceCenterX, faceCenterY + halfDepth, faceCenterZ + halfHeight),
      new THREE.Vector3(faceCenterX, faceCenterY - halfDepth, faceCenterZ + halfHeight),
    ];
  } else { // Front/Back face - XZ plane
    corners = [
      new THREE.Vector3(faceCenterX - halfWidth, faceCenterY, faceCenterZ - halfHeight),
      new THREE.Vector3(faceCenterX + halfWidth, faceCenterY, faceCenterZ - halfHeight),
      new THREE.Vector3(faceCenterX + halfWidth, faceCenterY, faceCenterZ + halfHeight),
      new THREE.Vector3(faceCenterX - halfWidth, faceCenterY, faceCenterZ + halfHeight),
    ];
  }

  // Create edges geometry for the face outline
  const edgesGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    // Rectangle outline
    corners[0].x, corners[0].y, corners[0].z, corners[1].x, corners[1].y, corners[1].z,
    corners[1].x, corners[1].y, corners[1].z, corners[2].x, corners[2].y, corners[2].z,
    corners[2].x, corners[2].y, corners[2].z, corners[3].x, corners[3].y, corners[3].z,
    corners[3].x, corners[3].y, corners[3].z, corners[0].x, corners[0].y, corners[0].z,
  ]);

  edgesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  return (
    <group>
      <ThickLine start={corners[0]} end={corners[1]} />
      <ThickLine start={corners[1]} end={corners[2]} />
      <ThickLine start={corners[2]} end={corners[3]} />
      <ThickLine start={corners[3]} end={corners[0]} />
    </group>
  );
};

const ThickLine = ({ start, end, radius = 0.01, color = "white" }: { start: THREE.Vector3; end: THREE.Vector3; radius?: number; color?: string }) => {
  const length = start.distanceTo(end);
  const position = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(end, start).normalize();
  const orientation = new THREE.Quaternion();
  orientation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  return (
    <mesh position={position} quaternion={orientation}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} depthTest={false} />
    </mesh>
  );
};

const ReferenceImage = ({ url, opacity, scale, position, rotation }: {
  url: string
  opacity: number
  scale: number
  position: [number, number]
  rotation: number
}) => {
  const texture = useTexture(url)
  
  return (
    <mesh
      position={[position[0], position[1], 0.001]}
      rotation={[0, 0, rotation]}
      scale={scale}
    >
      <planeGeometry args={[GRID_SIZE, GRID_SIZE]} />
      <meshStandardMaterial 
        map={texture}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

const CameraSetup = () => {
  const { camera } = useThree()
  useEffect(() => {
    camera.up.set(0, 0, 1)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}

