'use client'

import { Line } from '@react-three/drei'
import { memo, useRef, useState } from 'react'
import * as THREE from 'three'
import { WallShadowPreview } from './wall'
import { useEditorContext } from '@/hooks/use-editor'

const GRID_SIZE = 30 // 30m x 30m

type GridTilesProps = {
  intersections: number
  tileSize: number
  walls: Set<string>
  onIntersectionClick: (x: number, y: number) => void
  onIntersectionDoubleClick: () => void
  onIntersectionHover: (x: number, y: number | null) => void
  wallStartPoint: [number, number] | null
  wallPreviewEnd: [number, number] | null
  roomStartPoint: [number, number] | null
  roomPreviewEnd: [number, number] | null
  customRoomPoints: Array<[number, number]>
  customRoomPreviewEnd: [number, number] | null
  deleteStartPoint: [number, number] | null
  deletePreviewEnd: [number, number] | null
  opacity: number
  disableBuild?: boolean
  wallHeight: number
  controlMode: 'select' | 'delete' | 'building'
}

export const GridTiles = memo(({
  intersections,
  tileSize,
  walls,
  onIntersectionClick,
  onIntersectionDoubleClick,
  onIntersectionHover,
  wallStartPoint,
  wallPreviewEnd,
  roomStartPoint,
  roomPreviewEnd,
  customRoomPoints,
  customRoomPreviewEnd,
  deleteStartPoint,
  deletePreviewEnd,
  opacity,
  disableBuild = false,
  wallHeight,
  controlMode
}: GridTilesProps) => {
  const { activeTool } = useEditorContext()
  const meshRef = useRef<THREE.Mesh>(null)
  const [hoveredIntersection, setHoveredIntersection] = useState<{ x: number; y: number } | null>(null)
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastClickTimeRef = useRef<number>(0)

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

    const now = Date.now()
    const timeSinceLastClick = now - lastClickTimeRef.current

    // Detect double-click within 300ms
    if (activeTool === 'custom-room' && timeSinceLastClick < 300) {
      // This is a double-click
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
        clickTimeoutRef.current = null
      }
      onIntersectionDoubleClick()
      lastClickTimeRef.current = 0 // Reset to prevent triple-click issues
    } else {
      // Single click
      if (activeTool === 'custom-room') {
        // For custom-room mode, delay the click to check if it's part of a double-click
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current)
        }
        clickTimeoutRef.current = setTimeout(() => {
          onIntersectionClick(hoveredIntersection.x, hoveredIntersection.y)
          clickTimeoutRef.current = null
        }, 300)
      } else {
        // For other modes, handle click immediately
        onIntersectionClick(hoveredIntersection.x, hoveredIntersection.y)
      }
      lastClickTimeRef.current = now
    }
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
          // For wall mode, use wallPreviewEnd for snapped position
          // For custom-room mode, use customRoomPreviewEnd for snapped position
          // For delete mode, use deletePreviewEnd for snapped position
          // For other modes, use the raw hovered intersection
          (activeTool === 'wall' && wallPreviewEnd) ? wallPreviewEnd[0] * tileSize :
          (activeTool === 'custom-room' && customRoomPreviewEnd) ? customRoomPreviewEnd[0] * tileSize :
          (controlMode === 'delete' && deletePreviewEnd) ? deletePreviewEnd[0] * tileSize :
          hoveredIntersection.x * tileSize,
          (activeTool === 'wall' && wallPreviewEnd) ? wallPreviewEnd[1] * tileSize :
          (activeTool === 'custom-room' && customRoomPreviewEnd) ? customRoomPreviewEnd[1] * tileSize :
          (controlMode === 'delete' && deletePreviewEnd) ? deletePreviewEnd[1] * tileSize :
          hoveredIntersection.y * tileSize,
          2
        ]}>
          <DownArrow />
        </group>
      )}
      
      {/* Start point indicator for wall mode */}
      {wallStartPoint && activeTool === 'wall' && (
        <mesh position={[wallStartPoint[0] * tileSize, wallStartPoint[1] * tileSize, 0.01]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color="#44ff44" emissive="#22aa22" />
        </mesh>
      )}

      {/* Preview line when placing wall */}
      {wallStartPoint && wallPreviewEnd && activeTool === 'wall' && (
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
      {wallStartPoint && wallPreviewEnd && activeTool === 'wall' && (
        <WallShadowPreview
          start={wallStartPoint}
          end={wallPreviewEnd}
          tileSize={tileSize}
          wallHeight={wallHeight}
        />
      )}

      {/* Room mode preview - rectangle with 4 walls */}
      {roomStartPoint && roomPreviewEnd && activeTool === 'room' && (
        <>
          {/* Start point indicator */}
          <mesh position={[roomStartPoint[0] * tileSize, roomStartPoint[1] * tileSize, 0.01]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#44ff44" emissive="#22aa22" />
          </mesh>

          {/* Preview lines for the 4 walls */}
          <Line
            points={[
              [roomStartPoint[0] * tileSize, roomStartPoint[1] * tileSize, 0.1],
              [roomPreviewEnd[0] * tileSize, roomStartPoint[1] * tileSize, 0.1],
              [roomPreviewEnd[0] * tileSize, roomPreviewEnd[1] * tileSize, 0.1],
              [roomStartPoint[0] * tileSize, roomPreviewEnd[1] * tileSize, 0.1],
              [roomStartPoint[0] * tileSize, roomStartPoint[1] * tileSize, 0.1],
            ]}
            color="#44ff44"
            lineWidth={3}
            dashed={false}
          />

          {/* Wall shadow previews for all 4 walls */}
          <WallShadowPreview
            start={[roomStartPoint[0], roomStartPoint[1]]}
            end={[roomPreviewEnd[0], roomStartPoint[1]]}
            tileSize={tileSize}
            wallHeight={wallHeight}
          />
          <WallShadowPreview
            start={[roomPreviewEnd[0], roomStartPoint[1]]}
            end={[roomPreviewEnd[0], roomPreviewEnd[1]]}
            tileSize={tileSize}
            wallHeight={wallHeight}
          />
          <WallShadowPreview
            start={[roomPreviewEnd[0], roomPreviewEnd[1]]}
            end={[roomStartPoint[0], roomPreviewEnd[1]]}
            tileSize={tileSize}
            wallHeight={wallHeight}
          />
          <WallShadowPreview
            start={[roomStartPoint[0], roomPreviewEnd[1]]}
            end={[roomStartPoint[0], roomStartPoint[1]]}
            tileSize={tileSize}
            wallHeight={wallHeight}
          />
        </>
      )}

      {/* Custom-room mode preview - polygon */}
      {activeTool === 'custom-room' && customRoomPoints.length > 0 && (
        <>
          {/* Point indicators for all placed points */}
          {customRoomPoints.map((point, index) => {
            // Check if hovering over the first point (to close the shape)
            const isHoveringFirstPoint = index === 0 &&
              customRoomPoints.length >= 3 &&
              customRoomPreviewEnd &&
              customRoomPreviewEnd[0] === point[0] &&
              customRoomPreviewEnd[1] === point[1]

            return (
              <mesh key={index} position={[point[0] * tileSize, point[1] * tileSize, 0.01]}>
                <sphereGeometry args={[isHoveringFirstPoint ? 0.15 : 0.1, 16, 16]} />
                <meshStandardMaterial
                  color={isHoveringFirstPoint ? "#ffff44" : "#44ff44"}
                  emissive={isHoveringFirstPoint ? "#aaaa22" : "#22aa22"}
                />
              </mesh>
            )
          })}

          {/* Lines between consecutive points */}
          {customRoomPoints.length > 1 && (
            <>
              {customRoomPoints.map((point, index) => {
                if (index === 0) return null
                const prevPoint = customRoomPoints[index - 1]
                return (
                  <Line
                    key={`line-${index}`}
                    points={[
                      [prevPoint[0] * tileSize, prevPoint[1] * tileSize, 0.1],
                      [point[0] * tileSize, point[1] * tileSize, 0.1]
                    ]}
                    color="#44ff44"
                    lineWidth={3}
                    dashed={false}
                  />
                )
              })}
            </>
          )}

          {/* Preview line from last point to current hover position */}
          {customRoomPreviewEnd && (
            <>
              {/* Check if hovering over first point */}
              {(() => {
                const isHoveringFirstPoint = customRoomPoints.length >= 3 &&
                  customRoomPreviewEnd[0] === customRoomPoints[0][0] &&
                  customRoomPreviewEnd[1] === customRoomPoints[0][1]

                if (isHoveringFirstPoint) {
                  // Show closing line when hovering over first point
                  return (
                    <Line
                      points={[
                        [customRoomPoints[customRoomPoints.length - 1][0] * tileSize, customRoomPoints[customRoomPoints.length - 1][1] * tileSize, 0.1],
                        [customRoomPoints[0][0] * tileSize, customRoomPoints[0][1] * tileSize, 0.1]
                      ]}
                      color="#ffff44"
                      lineWidth={3}
                      dashed={false}
                    />
                  )
                } else {
                  // Normal preview line to cursor (no auto-closing line)
                  return (
                    <Line
                      points={[
                        [customRoomPoints[customRoomPoints.length - 1][0] * tileSize, customRoomPoints[customRoomPoints.length - 1][1] * tileSize, 0.1],
                        [customRoomPreviewEnd[0] * tileSize, customRoomPreviewEnd[1] * tileSize, 0.1]
                      ]}
                      color="#44ff44"
                      lineWidth={3}
                      dashed={false}
                    />
                  )
                }
              })()}
            </>
          )}

          {/* Wall shadow previews for placed segments */}
          {customRoomPoints.length > 1 && customRoomPoints.map((point, index) => {
            if (index === 0) return null
            const prevPoint = customRoomPoints[index - 1]
            return (
              <WallShadowPreview
                key={`shadow-${index}`}
                start={prevPoint}
                end={point}
                tileSize={tileSize}
                wallHeight={wallHeight}
              />
            )
          })}
        </>
      )}

      {/* Delete mode preview - red line and plane */}
      {controlMode === 'delete' && deleteStartPoint && (
        <>
          {/* Start point indicator for delete mode */}
          <mesh position={[deleteStartPoint[0] * tileSize, deleteStartPoint[1] * tileSize, 0.01]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#ff4444" emissive="#aa2222" depthTest={false} />
          </mesh>

          {/* Preview line and transparent red plane when selecting deletion area */}
          {deletePreviewEnd && (
            <>
              <Line
                points={[
                  [deleteStartPoint[0] * tileSize, deleteStartPoint[1] * tileSize, 0.1],
                  [deletePreviewEnd[0] * tileSize, deletePreviewEnd[1] * tileSize, 0.1]
                ]}
                color="#ff4444"
                lineWidth={3}
                dashed={false}
                depthTest={false}
              />

              {/* Transparent red plane showing what will be deleted */}
              <DeletePlanePreview
                start={deleteStartPoint}
                end={deletePreviewEnd}
                tileSize={tileSize}
                wallHeight={wallHeight}
              />
            </>
          )}
        </>
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

// Delete plane preview component - shows transparent red plane for deletion area
type DeletePlanePreviewProps = {
  start: [number, number]
  end: [number, number]
  tileSize: number
  wallHeight: number
}

const DeletePlanePreview = memo(({ start, end, tileSize, wallHeight }: DeletePlanePreviewProps) => {
  const [x1, y1] = start
  const [x2, y2] = end

  // Calculate dimensions
  const dx = x2 - x1
  const dy = y2 - y1
  const baseLength = Math.sqrt(dx * dx + dy * dy) * tileSize
  const thickness = 0.2 // Same as WALL_THICKNESS
  // Extend by half thickness on each end
  const length = baseLength + thickness
  const height = wallHeight

  // Calculate center position
  const centerX = (x1 + x2) / 2 * tileSize
  const centerY = (y1 + y2) / 2 * tileSize

  // Calculate rotation
  const angle = Math.atan2(dy, dx)

  return (
    <group position={[centerX, centerY, height / 2]} rotation={[0, 0, angle]}>
      <mesh>
        <boxGeometry args={[length, thickness, height]} />
        <meshStandardMaterial
          color="#ff4444"
          transparent
          opacity={0.5}
          emissive="#aa2222"
          emissiveIntensity={0.5}
          depthTest={false}
        />
      </mesh>
    </group>
  )
})

DeletePlanePreview.displayName = 'DeletePlanePreview'

