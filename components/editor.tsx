'use client'

import { useState, memo, useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, OrbitControls, Environment, Grid, Stats } from '@react-three/drei'
import { useControls } from 'leva'
import { cn } from '@/lib/utils'
import * as THREE from 'three'

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
  const [walls, setWalls] = useState<Set<string>>(new Set())
  
  const { wallHeight, tileSize, showGrid, gridOpacity } = useControls({
    wallHeight: { value: WALL_HEIGHT, min: 1, max: 5, step: 0.1, label: 'Wall Height (m)' },
    tileSize: { value: TILE_SIZE, min: 0.1, max: 0.5, step: 0.01, label: 'Tile Size (m)' },
    showGrid: { value: true, label: 'Show Grid' },
    gridOpacity: { value: 0.3, min: 0, max: 1, step: 0.1, label: 'Grid Opacity' },
  })

  const [isCameraEnabled, setIsCameraEnabled] = useState(false)

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

  const handleTileClick = (x: number, y: number) => {
    const key = `${x},${y}`
    setWalls(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const wallArray = Array.from(walls).map(key => {
    const [x, y] = key.split(',').map(Number)
    return { x, y }
  })

  return (
    <Canvas 
      shadows 
      camera={{ 
        position: [10, 0, 5], 
        fov: 50,
        near: 0.1,
        far: 1000
      }} 
      className={cn('bg-[#303035]', className)}
      onCreated={({ camera }) => {
        camera.up.set(0, 0, 1)
        camera.lookAt(0, 0, 0)
      }}
    >
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
      
      <group position={[-(cols * tileSize) / 2, -(rows * tileSize) / 2, 0]}>
        <GridTiles 
          rows={rows} 
          cols={cols} 
          tileSize={tileSize}
          walls={walls}
          onTileClick={handleTileClick}
          opacity={gridOpacity}
        />
        <Walls walls={wallArray} tileSize={tileSize} wallHeight={wallHeight} />
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
      <Stats />
    </Canvas>
  )
}

type GridTilesProps = {
  rows: number
  cols: number
  tileSize: number
  walls: Set<string>
  onTileClick: (x: number, y: number) => void
  opacity: number
}

const GridTiles = memo(({ rows, cols, tileSize, walls, onTileClick, opacity }: GridTilesProps) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hoveredTile, setHoveredTile] = useState<{ x: number; y: number } | null>(null)

  const handlePointerMove = (e: any) => {
    e.stopPropagation()
    
    if (e.uv) {
      const x = Math.floor(e.uv.x * cols)
      const y = Math.floor(e.uv.y * rows)
      
      if (x >= 0 && x < cols && y >= 0 && y < rows) {
        setHoveredTile({ x, y })
      } else {
        setHoveredTile(null)
      }
    } else {
      setHoveredTile(null)
    }
  }

  const handleClick = (e: any) => {
    e.stopPropagation()
    
    if (e.uv) {
      const x = Math.floor(e.uv.x * cols)
      const y = Math.floor(e.uv.y * rows)
      
      if (x >= 0 && x < cols && y >= 0 && y < rows) {
        onTileClick(x, y)
      }
    }
  }

  return (
    <>
      <mesh
        ref={meshRef}
        position={[(cols * tileSize) / 2, (rows * tileSize) / 2, 0.001]}
        rotation={[0, 0, 0]}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredTile(null)}
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
  walls: WallTile[]
  tileSize: number
  wallHeight: number
}

const Walls = memo(({ walls, tileSize, wallHeight }: WallsProps) => {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const tempObject = useMemo(() => new THREE.Object3D(), [])
  const maxWalls = 10000

  useEffect(() => {
    if (!meshRef.current) return
    
    walls.forEach(({ x, y }, i) => {
      tempObject.position.set(
        x * tileSize + tileSize / 2,
        y * tileSize + tileSize / 2,
        wallHeight / 2
      )
      tempObject.updateMatrix()
      meshRef.current!.setMatrixAt(i, tempObject.matrix)
    })
    
    for (let i = walls.length; i < Math.min(maxWalls, meshRef.current.count); i++) {
      tempObject.position.set(0, 0, -1000)
      tempObject.updateMatrix()
      meshRef.current.setMatrixAt(i, tempObject.matrix)
    }
    
    meshRef.current.instanceMatrix.needsUpdate = true
    meshRef.current.count = walls.length
  }, [walls, tileSize, wallHeight, tempObject, maxWalls])

  return (
    <instancedMesh 
      ref={meshRef} 
      args={[undefined, undefined, maxWalls]} 
      castShadow 
      receiveShadow
      frustumCulled={false}
    >
      <boxGeometry args={[tileSize, tileSize, wallHeight]} />
      <meshStandardMaterial 
        color="#aaaabf"
        roughness={0.7}
        metalness={0.1}
      />
    </instancedMesh>
  )
})

