'use client'

import { useState, memo, useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
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
  z: number
}

export default function Editor({ className }: { className?: string }) {
  const [walls, setWalls] = useState<Set<string>>(new Set())
  
  const { wallHeight, tileSize, showGrid, gridOpacity } = useControls({
    wallHeight: { value: WALL_HEIGHT, min: 1, max: 5, step: 0.1, label: 'Wall Height (m)' },
    tileSize: { value: TILE_SIZE, min: 0.1, max: 0.5, step: 0.01, label: 'Tile Size (m)' },
    showGrid: { value: true, label: 'Show Grid' },
    gridOpacity: { value: 0.3, min: 0, max: 1, step: 0.1, label: 'Grid Opacity' },
  })

  const rows = Math.floor(GRID_SIZE / tileSize)
  const cols = Math.floor(GRID_SIZE / tileSize)

  const handleTileClick = (x: number, z: number) => {
    const key = `${x},${z}`
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
    const [x, z] = key.split(',').map(Number)
    return { x, z }
  })

  return (
    <Canvas 
      shadows 
      camera={{ 
        position: [15, 15, 15], 
        fov: 50,
        near: 0.1,
        far: 1000
      }} 
      className={cn('bg-[#303035]', className)}
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
        />
      )}
      
      <group position={[-(cols * tileSize) / 2, 0, -(rows * tileSize) / 2]}>
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
        maxPolarAngle={Math.PI / 2.2}
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
  onTileClick: (x: number, z: number) => void
  opacity: number
}

const GridTiles = memo(({ rows, cols, tileSize, walls, onTileClick, opacity }: GridTilesProps) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hoveredTile, setHoveredTile] = useState<{ x: number; z: number } | null>(null)

  const handlePointerMove = (e: any) => {
    e.stopPropagation()
    
    // Use UV coordinates (0-1) to calculate tile position
    if (e.uv) {
      const x = Math.floor(e.uv.x * cols)
      const z = Math.floor((1 - e.uv.y) * rows)
      
      if (x >= 0 && x < cols && z >= 0 && z < rows) {
        setHoveredTile({ x, z })
      } else {
        setHoveredTile(null)
      }
    } else {
      setHoveredTile(null)
    }
  }

  const handleClick = (e: any) => {
    e.stopPropagation()
    
    // Use UV coordinates (0-1) to calculate tile position
    if (e.uv) {
      const x = Math.floor(e.uv.x * cols)
      const z = Math.floor((1 - e.uv.y) * rows)
      
      if (x >= 0 && x < cols && z >= 0 && z < rows) {
        onTileClick(x, z)
      }

    }
  }

  return (
    <>
      {/* Single plane for interaction - positioned to cover all tiles from (0,0) to (cols, rows) */}
      <mesh
        ref={meshRef}
        position={[(cols * tileSize) / 2, 0.001, (rows * tileSize) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
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
      
      {/* Hover indicator */}
      {hoveredTile && !walls.has(`${hoveredTile.x},${hoveredTile.z}`) && (
        <mesh
          position={[
            hoveredTile.x * tileSize + tileSize / 2,
            0.002,
            hoveredTile.z * tileSize + tileSize / 2
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[tileSize * 0.95, tileSize * 0.95]} />
          <meshStandardMaterial 
            color="#5a5a5f"
            transparent
            opacity={0.6}
          />
        </mesh>
      )}
      
      {/* Wall tile indicators */}
      {Array.from(walls).map(key => {
        const [x, z] = key.split(',').map(Number)
        return (
          <mesh
            key={key}
            position={[
              x * tileSize + tileSize / 2,
              0.002,
              z * tileSize + tileSize / 2
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
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
  const maxWalls = 10000 // Maximum number of walls we can have

  useEffect(() => {
    if (!meshRef.current) return
    
    // Update positions for all walls
    walls.forEach(({ x, z }, i) => {
      tempObject.position.set(
        x * tileSize + tileSize / 2,
        wallHeight / 2,
        z * tileSize + tileSize / 2
      )
      tempObject.updateMatrix()
      meshRef.current!.setMatrixAt(i, tempObject.matrix)
    })
    
    // Hide unused instances by setting them far away
    for (let i = walls.length; i < Math.min(maxWalls, meshRef.current.count); i++) {
      tempObject.position.set(0, -1000, 0)
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
    >
      <boxGeometry args={[tileSize, wallHeight, tileSize]} />
      <meshStandardMaterial 
        color="#aaaabf"
        roughness={0.7}
        metalness={0.1}
      />
    </instancedMesh>
  )
})

