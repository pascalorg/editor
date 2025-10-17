'use client'

import { useState, memo, useRef, useMemo, useEffect, forwardRef, Ref } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, OrbitControls, Environment, Grid, Stats, PerspectiveCamera, OrthographicCamera } from '@react-three/drei'
import { useControls } from 'leva'
import { cn } from '@/lib/utils'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { useEditorContext, WallSegment } from '@/hooks/use-editor'

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
  const { walls, setWalls, imageURL, wallsGroupRef, wallSegments, selectedWallIds, setSelectedWallIds } = useEditorContext()

  const { wallHeight, tileSize, showGrid, gridOpacity, cameraType } = useControls({
    wallHeight: { value: WALL_HEIGHT, min: 1, max: 5, step: 0.1, label: 'Wall Height (m)' },
    tileSize: { value: TILE_SIZE, min: 0.1, max: 0.5, step: 0.01, label: 'Tile Size (m)' },
    showGrid: { value: true, label: 'Show Grid' },
    gridOpacity: { value: 0.3, min: 0, max: 1, step: 0.1, label: 'Grid Opacity' },
    cameraType: { value: 'perspective', options: { Perspective: 'perspective', Orthographic: 'orthographic' }, label: 'View Type' }
  })

  const [isCameraEnabled, setIsCameraEnabled] = useState(false)
  const [hoveredWallIndex, setHoveredWallIndex] = useState<number | null>(null)

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

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

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
            disableBuild={isCameraEnabled}
          />
          <Walls
            wallSegments={wallSegments}
            tileSize={tileSize}
            wallHeight={wallHeight}
            hoveredWallIndex={hoveredWallIndex}
            selectedWallIds={selectedWallIds}
            setSelectedWallIds={setSelectedWallIds}
            onWallHover={setHoveredWallIndex}
            ref={wallsGroupRef}
          />
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
    document.addEventListener('pointerup', handlePointerUp)
  }

  const handlePointerUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      if (!hasMovedRef.current && initialTileRef.current) {
        onTileInteract(initialTileRef.current.x, initialTileRef.current.y, 'toggle')
      } else if (hasMovedRef.current && initialTileRef.current) {
        onTileInteract(initialTileRef.current.x, initialTileRef.current.y, 'add')
      }
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
  selectedWallIds: Set<string>
  setSelectedWallIds: React.Dispatch<React.SetStateAction<Set<string>>>
  onWallHover: (index: number | null) => void
}

const Walls = memo(forwardRef(({ wallSegments, tileSize, wallHeight, hoveredWallIndex, selectedWallIds, setSelectedWallIds, onWallHover }: WallsProps, ref: Ref<THREE.Group>) => {
  return (
    <group ref={ref}>
      {wallSegments.map((seg, i) => {
        let width, depth, posX, posY;
        const height = wallHeight;
        const isSelected = selectedWallIds.has(seg.id);
        const isHovered = hoveredWallIndex === i;

        if (seg.isHorizontal) {
          const num = seg.end - seg.start + 1;
          width = num * tileSize;
          depth = tileSize;
          posX = seg.start * tileSize + width / 2;
          posY = seg.fixed * tileSize + tileSize / 2;
        } else {
          width = tileSize;
          depth = (seg.end - seg.start + 1) * tileSize;
          posX = seg.fixed * tileSize + tileSize / 2;
          posY = seg.start * tileSize + depth / 2;
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
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedWallIds(prev => {
                const next = new Set(prev);
                if (next.has(seg.id)) {
                  next.delete(seg.id);
                } else {
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

