'use client'

import { useState, memo, useRef, useMemo, useEffect, forwardRef, Ref } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, OrbitControls, Environment, Grid, Stats, PerspectiveCamera, OrthographicCamera, Line } from '@react-three/drei'
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
import { BuildingMenu } from '@/components/building-menu'
import { ControlModeMenu } from '@/components/control-mode-menu'

const TILE_SIZE = 0.5 // 50cm grid spacing
const WALL_HEIGHT = 2.5 // 2.5m standard wall height
const WALL_THICKNESS = 0.2 // 20cm wall thickness
const MIN_WALL_LENGTH = 0.5 // 50cm minimum wall length
const GRID_SIZE = 30 // 30m x 30m
const GRID_DIVISIONS = Math.floor(GRID_SIZE / TILE_SIZE) // 60 divisions
const GRID_INTERSECTIONS = GRID_DIVISIONS + 1 // 61 intersections per axis

type WallTile = {
  x: number
  y: number
}

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
      // Second click: create wall
      const [x1, y1] = wallStartPoint
      // Ensure wall is at least MIN_WALL_LENGTH
      const dx = Math.abs(x - x1) * TILE_SIZE
      const dy = Math.abs(y - y1) * TILE_SIZE
      const length = Math.sqrt(dx * dx + dy * dy)
      
      if (length >= MIN_WALL_LENGTH && (x === x1 || y === y1)) {
        // Wall is valid (horizontal or vertical, meets min length)
        const wallKey = `${x1},${y1}-${x},${y}`
        setWalls(prev => {
          const next = new Set(prev)
          next.add(wallKey)
          return next
        })
      }
      
      // Reset placement state
      setWallStartPoint(null)
      setWallPreviewEnd(null)
    }
  }

  const handleIntersectionHover = (x: number, y: number | null) => {
    if (wallStartPoint && y !== null) {
      // Calculate projected point on same row or column
      const [x1, y1] = wallStartPoint
      let projectedX = x1
      let projectedY = y1
      
      const dx = Math.abs(x - x1)
      const dy = Math.abs(y - y1)
      
      if (dx > dy) {
        // Project horizontally
        projectedX = x
      } else {
        // Project vertically
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

type GridTilesProps = {
  intersections: number
  tileSize: number
  walls: Set<string>
  onIntersectionClick: (x: number, y: number) => void
  onIntersectionHover: (x: number, y: number | null) => void
  wallStartPoint: [number, number] | null
  wallPreviewEnd: [number, number] | null
  opacity: number
  disableBuild?: boolean
}

const GridTiles = memo(({ intersections, tileSize, walls, onIntersectionClick, onIntersectionHover, wallStartPoint, wallPreviewEnd, opacity, disableBuild = false }: GridTilesProps) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hoveredIntersection, setHoveredIntersection] = useState<{ x: number; y: number } | null>(null)

  const gridSize = (intersections - 1) * tileSize

  const handlePointerMove = (e: any) => {
    e.stopPropagation()
    
    if (e.point && !disableBuild) {
      // e.point is in world coordinates
      // The parent group is offset by [-GRID_SIZE/2, -GRID_SIZE/2, 0]
      // Convert world coords to local coords by adding the offset back
      const localX = e.point.x + (GRID_SIZE / 2)
      const localY = e.point.y + (GRID_SIZE / 2)
      
      // Round to nearest intersection
      const x = Math.round(localX / tileSize)
      const y = Math.round(localY / tileSize)
      
      if (x >= 0 && x < intersections && y >= 0 && y < intersections) {
        setHoveredIntersection({ x, y })
        onIntersectionHover(x, y)
      } else {
        setHoveredIntersection(null)
        onIntersectionHover(0, null)
      }
    }
  }

  const handlePointerDown = (e: any) => {
    e.stopPropagation()
    if (disableBuild || !hoveredIntersection) return
    onIntersectionClick(hoveredIntersection.x, hoveredIntersection.y)
  }

  return (
    <>
      {/* Invisible plane for raycasting */}
      <mesh
        ref={meshRef}
        position={[gridSize / 2, gridSize / 2, 0.001]}
        rotation={[0, 0, 0]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          setHoveredIntersection(null)
          onIntersectionHover(0, null)
        }}
      >
        <planeGeometry args={[gridSize, gridSize]} />
        <meshStandardMaterial 
          color="#404045"
          transparent
          opacity={opacity * 0.3}
        />
      </mesh>
      
      {/* Down arrow at hovered intersection */}
      {hoveredIntersection && !disableBuild && (
        <group position={[hoveredIntersection.x * tileSize, hoveredIntersection.y * tileSize, 2]}>
          <DownArrow />
        </group>
      )}
      
      {/* Start point indicator */}
      {wallStartPoint && (
        <mesh position={[wallStartPoint[0] * tileSize, wallStartPoint[1] * tileSize, 0.01]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color="#44ff44" emissive="#22aa22" />
        </mesh>
      )}
      
      {/* Preview line when placing wall */}
      {wallStartPoint && wallPreviewEnd && (
        <Line
          points={[
            [wallStartPoint[0] * tileSize, wallStartPoint[1] * tileSize, 0.1],
            [wallPreviewEnd[0] * tileSize, wallPreviewEnd[1] * tileSize, 0.1]
          ]}
          color="#44ff44"
          lineWidth={3}
          dashed={false}
        />
      )}
    </>
  )
})

// Down arrow component (2m height, pointing down)
const DownArrow = () => {
  const shaftHeight = 1.7
  const coneHeight = 0.3
  const shaftRadius = 0.03
  const coneRadius = 0.1
  
  return (
    <group>
      {/* Shaft - cylinder is created along Y-axis, rotate to align with Z-axis */}
      <mesh position={[0, 0, -shaftHeight / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftHeight, 8]} />
        <meshStandardMaterial color="white" transparent opacity={0.8} />
      </mesh>
      {/* Cone tip - cone points up by default along Y, rotate to point down along -Z */}
      <mesh position={[0, 0, -(shaftHeight + coneHeight / 2)]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[coneRadius, coneHeight, 8]} />
        <meshStandardMaterial color="white" transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

type WallsProps = {
  wallSegments: WallSegment[]
  tileSize: number
  wallHeight: number
  hoveredWallIndex: number | null
  selectedWallIds: Set<string>
  setSelectedWallIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onWallHover: (index: number | null) => void
  isCameraEnabled?: boolean
  controlMode: string
  onDeleteWalls: () => void
}

const Walls = memo(forwardRef(({ wallSegments, tileSize, wallHeight, hoveredWallIndex, selectedWallIds, setSelectedWallIds, onWallHover, onWallRightClick, isCameraEnabled, controlMode, onDeleteWalls }: WallsProps & { onWallRightClick?: (e: any, wallSegment: WallSegment) => void }, ref: Ref<THREE.Group>) => {
  const [deleteStartWall, setDeleteStartWall] = useState<string | null>(null)
  return (
    <group ref={ref}>
      {wallSegments.map((seg, i) => {
        const [x1, y1] = seg.start
        const [x2, y2] = seg.end
        
        // Calculate wall dimensions
        const dx = x2 - x1
        const dy = y2 - y1
        const length = Math.sqrt(dx * dx + dy * dy) * tileSize
        const thickness = WALL_THICKNESS
        const height = wallHeight
        
        // Calculate center position
        const centerX = (x1 + x2) / 2 * tileSize
        const centerY = (y1 + y2) / 2 * tileSize
        
        // Calculate rotation
        const angle = Math.atan2(dy, dx)
        
        const isSelected = selectedWallIds.has(seg.id);
        const isHovered = hoveredWallIndex === i;

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
          <group key={seg.id} position={[centerX, centerY, height / 2]} rotation={[0, 0, angle]}>
            <mesh
              castShadow
              receiveShadow
              onPointerEnter={(e) => {
                e.stopPropagation();
                onWallHover(i);
              }}
              onPointerLeave={(e) => {
                e.stopPropagation();
                onWallHover(null);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                if (controlMode === 'delete' && deleteStartWall && e.buttons === 1) {
                  // Multi-select during drag
                  setSelectedWallIds(prev => {
                    const next = new Set(prev)
                    next.add(seg.id)
                    return next
                  })
                }
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                
                // Delete mode: left click to select/multi-select for deletion
                if (controlMode === 'delete' && e.button === 0) {
                  setDeleteStartWall(seg.id)
                  setSelectedWallIds(prev => {
                    const next = new Set(prev)
                    next.add(seg.id)
                    return next
                  })
                  return
                }

                // Check for right-click (button 2) and camera not enabled and walls selected
                if (e.button === 2 && !isCameraEnabled && selectedWallIds.size > 0) {
                  // Prevent default browser context menu
                  if (e.nativeEvent) {
                    e.nativeEvent.preventDefault();
                  }
                  onWallRightClick?.(e, seg);
                }
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                
                // Delete mode: release to confirm deletion
                if (controlMode === 'delete' && deleteStartWall) {
                  onDeleteWalls()
                  setDeleteStartWall(null)
                }
              }}
              onPointerMove={(e) => {
                if (controlMode === 'delete' && deleteStartWall && e.buttons === 1) {
                  // Multi-select during drag
                  setSelectedWallIds(prev => {
                    const next = new Set(prev)
                    next.add(seg.id)
                    return next
                  })
                }
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
                
                // Delete mode: handled in onPointerDown/Up
                if (controlMode === 'delete') {
                  return
                }
                
                // Select mode: normal selection behavior
                if (controlMode === 'select') {
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
                }
              }}
            >
              <boxGeometry args={[length, thickness, height]} />
              <meshStandardMaterial
                color={color}
                roughness={0.7}
                metalness={0.1}
                emissive={emissive}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}));


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

const CustomControls = ({ tileSize, controlMode }: { tileSize: number; controlMode: string }) => {
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const dragType = useRef<'pan' | 'rotate' | null>(null);
  const startMouse = useRef(new THREE.Vector2());
  const initialPosition = useRef(new THREE.Vector3());
  const initialTarget = useRef(new THREE.Vector3());
  const currentTarget = useRef(new THREE.Vector3(0, 0, 0));
  const grabbedPoint = useRef(new THREE.Vector3());
  const rotationTarget = useRef(new THREE.Vector3());
  const raycaster = useRef(new THREE.Raycaster());
  const floorPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  
  // Damping state for smooth camera movement
  const targetPosition = useRef(new THREE.Vector3());
  const currentVelocity = useRef(new THREE.Vector3());
  
  // Performance optimization for pointer events
  const pendingPointerMove = useRef<PointerEvent | null>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const h = 30 * tileSize;
    camera.position.set(h, 0, h);
    targetPosition.current.copy(camera.position);
    currentTarget.current.set(0, 0, 0);
    camera.lookAt(currentTarget.current);
  }, [tileSize, camera]);

  useEffect(() => {
    const domElement = gl.domElement;

    const handlePointerDown = (event: PointerEvent) => {
      const mouse = new THREE.Vector2(
        (event.clientX / domElement.clientWidth) * 2 - 1,
        -(event.clientY / domElement.clientHeight) * 2 + 1
      );
      raycaster.current.setFromCamera(mouse, camera);
      const hitPoint = new THREE.Vector3();
      if (!raycaster.current.ray.intersectPlane(floorPlane.current, hitPoint)) {
        return;
      }

      startMouse.current.set(event.clientX, event.clientY);
      initialPosition.current.copy(camera.position);
      initialTarget.current.copy(currentTarget.current);
      dragging.current = true;

      if (event.button === 0) { // left - pan (only in select mode)
        // Only allow panning in select mode
        if (controlMode === 'select') {
          dragType.current = 'pan';
          grabbedPoint.current.copy(hitPoint);
        }
      } else if (event.button === 1) { // middle - pan (works in any mode)
        dragType.current = 'pan';
        grabbedPoint.current.copy(hitPoint);
      } else if (event.button === 2) { // right - rotate (always enabled)
        dragType.current = 'rotate';
        const centerMouse = new THREE.Vector2(0, 0);
        raycaster.current.setFromCamera(centerMouse, camera);
        const hitPoint = new THREE.Vector3();
        if (raycaster.current.ray.intersectPlane(floorPlane.current, hitPoint)) {
          rotationTarget.current.copy(hitPoint);
          currentTarget.current.copy(hitPoint);
        }
      }
    };

    const processPointerMove = (event: PointerEvent) => {
      if (dragType.current === 'pan') {
        const mouse = new THREE.Vector2(
          (event.clientX / domElement.clientWidth) * 2 - 1,
          -(event.clientY / domElement.clientHeight) * 2 + 1
        );
        raycaster.current.setFromCamera(mouse, camera);
        const newPoint = new THREE.Vector3();
        if (raycaster.current.ray.intersectPlane(floorPlane.current, newPoint)) {
          const delta = grabbedPoint.current.clone().sub(newPoint);
          const newPos = initialPosition.current.clone().add(delta);
          camera.position.copy(newPos);
          targetPosition.current.copy(newPos);
          currentTarget.current.copy(initialTarget.current.clone().add(delta));
          camera.lookAt(currentTarget.current);
        }
      } else if (dragType.current === 'rotate') {
        const deltaX = event.clientX - startMouse.current.x;
        const angle = deltaX * -0.002; // sensitivity
        const relative = initialPosition.current.clone().sub(rotationTarget.current);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const newX = relative.x * cosA - relative.y * sinA;
        const newY = relative.x * sinA + relative.y * cosA;
        const newPos = new THREE.Vector3(
          rotationTarget.current.x + newX,
          rotationTarget.current.y + newY,
          initialPosition.current.z // keep height fixed
        );
        camera.position.copy(newPos);
        targetPosition.current.copy(newPos);
        camera.lookAt(rotationTarget.current);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      
      // Store the latest event
      pendingPointerMove.current = event;
      
      // Use RAF to batch updates and sync with display refresh
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(() => {
          if (pendingPointerMove.current) {
            processPointerMove(pendingPointerMove.current);
            pendingPointerMove.current = null;
          }
          rafId.current = null;
        });
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      dragging.current = false;
      dragType.current = null;
      // Cancel any pending RAF
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      pendingPointerMove.current = null;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoomSpeed = 0.001; // Much smaller for smoother zoom
      const direction = targetPosition.current.clone().sub(currentTarget.current).normalize();
      const currentDistance = targetPosition.current.distanceTo(currentTarget.current);
      let newDistance = currentDistance * (1 + event.deltaY * zoomSpeed);

      const minDistance = 5 * tileSize * Math.sqrt(2);
      const maxDistance = 100 * tileSize * Math.sqrt(2);
      newDistance = Math.max(minDistance, Math.min(maxDistance, newDistance));

      targetPosition.current.copy(currentTarget.current.clone().add(direction.multiplyScalar(newDistance)));
    };

    domElement.addEventListener('pointerdown', handlePointerDown);
    domElement.addEventListener('pointermove', handlePointerMove);
    domElement.addEventListener('pointerup', handlePointerUp);
    domElement.addEventListener('pointercancel', handlePointerUp);
    domElement.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      domElement.removeEventListener('pointerdown', handlePointerDown);
      domElement.removeEventListener('pointermove', handlePointerMove);
      domElement.removeEventListener('pointerup', handlePointerUp);
      domElement.removeEventListener('pointercancel', handlePointerUp);
      domElement.removeEventListener('wheel', handleWheel);
      // Clean up any pending RAF
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [camera, gl, tileSize, controlMode]);

  // Smooth damping animation
  useFrame((state, delta) => {
    // Skip damping when actively dragging for instant response
    if (dragging.current) return;

    const dampingFactor = 8; // Higher = faster response
    const epsilon = 0.001; // Threshold to stop interpolation

    // Calculate smooth damped movement
    const distance = camera.position.distanceTo(targetPosition.current);
    
    if (distance > epsilon) {
      // Smooth damp using lerp
      const t = Math.min(1, dampingFactor * delta);
      camera.position.lerp(targetPosition.current, t);
      camera.lookAt(currentTarget.current);
    }
  });

  return null;
};

