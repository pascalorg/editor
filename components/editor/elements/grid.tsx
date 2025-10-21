'use client'

import { Line } from '@react-three/drei'
import { memo, useRef, useState } from 'react'
import * as THREE from 'three'
import { WallShadowPreview } from './wall'

const GRID_SIZE = 30 // 30m x 30m

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
  wallHeight: number
}

export const GridTiles = memo(({ 
  intersections, 
  tileSize, 
  walls, 
  onIntersectionClick, 
  onIntersectionHover, 
  wallStartPoint, 
  wallPreviewEnd, 
  opacity, 
  disableBuild = false, 
  wallHeight 
}: GridTilesProps) => {
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
    // Only handle left-click (button 0) for wall placement
    // Right-click (button 2) and middle-click (button 1) are for camera controls
    if (e.button !== 0) return
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
      
      {/* Down arrow at hovered intersection or snapped preview position */}
      {hoveredIntersection && !disableBuild && (
        <group position={[
          wallPreviewEnd ? wallPreviewEnd[0] * tileSize : hoveredIntersection.x * tileSize,
          wallPreviewEnd ? wallPreviewEnd[1] * tileSize : hoveredIntersection.y * tileSize,
          2
        ]}>
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
      
      {/* Wall shadow preview */}
      {wallStartPoint && wallPreviewEnd && (
        <WallShadowPreview 
          start={wallStartPoint}
          end={wallPreviewEnd}
          tileSize={tileSize}
          wallHeight={wallHeight}
        />
      )}
    </>
  )
})

GridTiles.displayName = 'GridTiles'

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
        <meshStandardMaterial color="white" transparent opacity={0.8} depthTest={false} />
      </mesh>
      {/* Cone tip - cone points up by default along Y, rotate to point down along -Z */}
      <mesh position={[0, 0, -(shaftHeight + coneHeight / 2)]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[coneRadius, coneHeight, 8]} />
        <meshStandardMaterial color="white" transparent opacity={0.8} depthTest={false} />
      </mesh>
    </group>
  )
}

