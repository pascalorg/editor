'use client'

import { Line } from '@react-three/drei'
import { memo, useRef, useState } from 'react'
import * as THREE from 'three'
import { WallShadowPreview } from './wall'
import { useEditor, useEditorContext } from '@/hooks/use-editor'
import { useShallow } from 'zustand/react/shallow'

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
  controlMode: 'select' | 'delete' | 'building' | 'guide'
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
  const { activeTool, selectedFloorId } = useEditorContext()
  const meshRef = useRef<THREE.Mesh>(null)
  const [hoveredIntersection, setHoveredIntersection] = useState<{ x: number; y: number } | null>(null)
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastClickTimeRef = useRef<number>(0)

  // Get all wall segments for the active floor (needed for mitered junction calculations in previews)
  const allWallSegments = useEditor(
    useShallow(state => {
      const wallComponent = state.components.find(c => c.type === 'wall' && c.group === selectedFloorId)
      return wallComponent?.data.segments || []
    })
  )

  const gridSize = (intersections - 1) * tileSize

  const handlePointerMove = (e: any) => {
    e.stopPropagation()

    // Don't show hover indicators in guide mode (reserved for image manipulation)
    if (controlMode === 'guide') {
      setHoveredIntersection(null)
      onIntersectionHover(0, null)
      return
    }

    if (e.point && !disableBuild) {
      // e.point is in world coordinates
      // The parent group is offset by [-GRID_SIZE/2, 0, -GRID_SIZE/2]
      // Convert world coords to local coords by adding the offset back
      const localX = e.point.x + (GRID_SIZE / 2)
      const localZ = e.point.z + (GRID_SIZE / 2)

      // Round to nearest intersection
      const x = Math.round(localX / tileSize)
      const y = Math.round(localZ / tileSize)  // y in grid space is z in 3D space

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
    
    // Special handling for guide mode - allow clicks for deselection
    if (controlMode === 'guide') {
      onIntersectionClick(0, 0) // Trigger deselection (coordinates don't matter)
      return
    }
    
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
        position={[gridSize / 2, 0.001, gridSize / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
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
          2,
          (activeTool === 'wall' && wallPreviewEnd) ? wallPreviewEnd[1] * tileSize :
          (activeTool === 'custom-room' && customRoomPreviewEnd) ? customRoomPreviewEnd[1] * tileSize :
          (controlMode === 'delete' && deletePreviewEnd) ? deletePreviewEnd[1] * tileSize :
          hoveredIntersection.y * tileSize
        ]}>
          <DownArrow />
        </group>
      )}

      {/* Start point indicator for wall mode */}
      {wallStartPoint && activeTool === 'wall' && (
        <mesh position={[wallStartPoint[0] * tileSize, 0.01, wallStartPoint[1] * tileSize]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color="#44ff44" emissive="#22aa22" depthTest={false} />
        </mesh>
      )}

      {/* Preview line when placing wall */}
      {wallStartPoint && wallPreviewEnd && activeTool === 'wall' && (
        <>
          {/* Occluded version - dimmer */}
          <Line
            points={[
              [wallStartPoint[0] * tileSize, 0.1, wallStartPoint[1] * tileSize],
              [wallPreviewEnd[0] * tileSize, 0.1, wallPreviewEnd[1] * tileSize]
            ]}
            color="#336633"
            lineWidth={2}
            dashed={false}
            depthTest={false}
            transparent
            opacity={0.3}
          />
          {/* Visible version - brighter */}
          <Line
            points={[
              [wallStartPoint[0] * tileSize, 0.1, wallStartPoint[1] * tileSize],
              [wallPreviewEnd[0] * tileSize, 0.1, wallPreviewEnd[1] * tileSize]
            ]}
            color="#44ff44"
            lineWidth={3}
            dashed={false}
            depthTest={true}
          />
        </>
      )}
      
      {/* Wall shadow preview */}
      {wallStartPoint && wallPreviewEnd && activeTool === 'wall' && (
        <WallShadowPreview
          start={wallStartPoint}
          end={wallPreviewEnd}
          tileSize={tileSize}
          wallHeight={wallHeight}
          allWallSegments={allWallSegments}
        />
      )}

      {/* Room mode preview - rectangle with 4 walls */}
      {roomStartPoint && roomPreviewEnd && activeTool === 'room' && (
        <>
          {/* Start point indicator */}
          <mesh position={[roomStartPoint[0] * tileSize, 0.01, roomStartPoint[1] * tileSize]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#44ff44" emissive="#22aa22" depthTest={false} />
          </mesh>

          {/* Preview lines for the 4 walls */}
          {/* Occluded version - dimmer */}
          <Line
            points={[
              [roomStartPoint[0] * tileSize, 0.1, roomStartPoint[1] * tileSize],
              [roomPreviewEnd[0] * tileSize, 0.1, roomStartPoint[1] * tileSize],
              [roomPreviewEnd[0] * tileSize, 0.1, roomPreviewEnd[1] * tileSize],
              [roomStartPoint[0] * tileSize, 0.1, roomPreviewEnd[1] * tileSize],
              [roomStartPoint[0] * tileSize, 0.1, roomStartPoint[1] * tileSize],
            ]}
            color="#336633"
            lineWidth={2}
            dashed={false}
            depthTest={false}
            transparent
            opacity={0.3}
          />
          {/* Visible version - brighter */}
          <Line
            points={[
              [roomStartPoint[0] * tileSize, 0.1, roomStartPoint[1] * tileSize],
              [roomPreviewEnd[0] * tileSize, 0.1, roomStartPoint[1] * tileSize],
              [roomPreviewEnd[0] * tileSize, 0.1, roomPreviewEnd[1] * tileSize],
              [roomStartPoint[0] * tileSize, 0.1, roomPreviewEnd[1] * tileSize],
              [roomStartPoint[0] * tileSize, 0.1, roomStartPoint[1] * tileSize],
            ]}
            color="#44ff44"
            lineWidth={3}
            dashed={false}
            depthTest={true}
          />

          {/* Wall shadow previews for all 4 walls */}
          <WallShadowPreview
            start={[roomStartPoint[0], roomStartPoint[1]]}
            end={[roomPreviewEnd[0], roomStartPoint[1]]}
            tileSize={tileSize}
            wallHeight={wallHeight}
            allWallSegments={allWallSegments}
          />
          <WallShadowPreview
            start={[roomPreviewEnd[0], roomStartPoint[1]]}
            end={[roomPreviewEnd[0], roomPreviewEnd[1]]}
            tileSize={tileSize}
            wallHeight={wallHeight}
            allWallSegments={allWallSegments}
          />
          <WallShadowPreview
            start={[roomPreviewEnd[0], roomPreviewEnd[1]]}
            end={[roomStartPoint[0], roomPreviewEnd[1]]}
            tileSize={tileSize}
            wallHeight={wallHeight}
            allWallSegments={allWallSegments}
          />
          <WallShadowPreview
            start={[roomStartPoint[0], roomPreviewEnd[1]]}
            end={[roomStartPoint[0], roomStartPoint[1]]}
            tileSize={tileSize}
            wallHeight={wallHeight}
            allWallSegments={allWallSegments}
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
              <mesh key={index} position={[point[0] * tileSize, 0.01, point[1] * tileSize]}>
                <sphereGeometry args={[isHoveringFirstPoint ? 0.15 : 0.1, 16, 16]} />
                <meshStandardMaterial
                  color={isHoveringFirstPoint ? "#ffff44" : "#44ff44"}
                  emissive={isHoveringFirstPoint ? "#aaaa22" : "#22aa22"}
                  depthTest={false}
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
                  <group key={`line-${index}`}>
                    {/* Occluded version - dimmer */}
                    <Line
                      points={[
                        [prevPoint[0] * tileSize, 0.1, prevPoint[1] * tileSize],
                        [point[0] * tileSize, 0.1, point[1] * tileSize]
                      ]}
                      color="#336633"
                      lineWidth={2}
                      dashed={false}
                      depthTest={false}
                      transparent
                      opacity={0.3}
                    />
                    {/* Visible version - brighter */}
                    <Line
                      points={[
                        [prevPoint[0] * tileSize, 0.1, prevPoint[1] * tileSize],
                        [point[0] * tileSize, 0.1, point[1] * tileSize]
                      ]}
                      color="#44ff44"
                      lineWidth={3}
                      dashed={false}
                      depthTest={true}
                    />
                  </group>
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
                    <>
                      {/* Occluded version - dimmer */}
                      <Line
                        points={[
                          [customRoomPoints[customRoomPoints.length - 1][0] * tileSize, 0.1, customRoomPoints[customRoomPoints.length - 1][1] * tileSize],
                          [customRoomPoints[0][0] * tileSize, 0.1, customRoomPoints[0][1] * tileSize]
                        ]}
                        color="#999922"
                        lineWidth={2}
                        dashed={false}
                        depthTest={false}
                        transparent
                        opacity={0.3}
                      />
                      {/* Visible version - brighter */}
                      <Line
                        points={[
                          [customRoomPoints[customRoomPoints.length - 1][0] * tileSize, 0.1, customRoomPoints[customRoomPoints.length - 1][1] * tileSize],
                          [customRoomPoints[0][0] * tileSize, 0.1, customRoomPoints[0][1] * tileSize]
                        ]}
                        color="#ffff44"
                        lineWidth={3}
                        dashed={false}
                        depthTest={true}
                      />
                    </>
                  )
                } else {
                  // Normal preview line to cursor (no auto-closing line)
                  return (
                    <>
                      {/* Occluded version - dimmer */}
                      <Line
                        points={[
                          [customRoomPoints[customRoomPoints.length - 1][0] * tileSize, 0.1, customRoomPoints[customRoomPoints.length - 1][1] * tileSize],
                          [customRoomPreviewEnd[0] * tileSize, 0.1, customRoomPreviewEnd[1] * tileSize]
                        ]}
                        color="#336633"
                        lineWidth={2}
                        dashed={false}
                        depthTest={false}
                        transparent
                        opacity={0.3}
                      />
                      {/* Visible version - brighter */}
                      <Line
                        points={[
                          [customRoomPoints[customRoomPoints.length - 1][0] * tileSize, 0.1, customRoomPoints[customRoomPoints.length - 1][1] * tileSize],
                          [customRoomPreviewEnd[0] * tileSize, 0.1, customRoomPreviewEnd[1] * tileSize]
                        ]}
                        color="#44ff44"
                        lineWidth={3}
                        dashed={false}
                        depthTest={true}
                      />
                    </>
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
                allWallSegments={allWallSegments}
              />
            )
          })}
        </>
      )}

      {/* Delete mode preview - red line and plane */}
      {controlMode === 'delete' && deleteStartPoint && (
        <>
          {/* Start point indicator for delete mode */}
          <mesh position={[deleteStartPoint[0] * tileSize, 0.01, deleteStartPoint[1] * tileSize]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#ff4444" emissive="#aa2222" depthTest={false} />
          </mesh>

          {/* Preview line and transparent red plane when selecting deletion area */}
          {deletePreviewEnd && (
            <>
              <Line
                points={[
                  [deleteStartPoint[0] * tileSize, 0.1, deleteStartPoint[1] * tileSize],
                  [deletePreviewEnd[0] * tileSize, 0.1, deletePreviewEnd[1] * tileSize]
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

// Down arrow component (2m height, pointing down along -Y axis)
const DownArrow = () => {
  const shaftHeight = 1.7
  const coneHeight = 0.3
  const shaftRadius = 0.03
  const coneRadius = 0.1

  return (
    <group>
      {/* Shaft - cylinder is created along Y-axis, no rotation needed */}
      <mesh position={[0, -shaftHeight / 2, 0]}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftHeight, 8]} />
        <meshStandardMaterial color="white" transparent opacity={0.8} depthTest={false} />
      </mesh>
      {/* Cone tip - cone points up by default along Y, rotate 180° to point down */}
      <mesh position={[0, -(shaftHeight + coneHeight / 2), 0]} rotation={[0, 0, Math.PI]}>
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
  const dz = y2 - y1  // y coordinates from grid are z in 3D space
  const baseLength = Math.sqrt(dx * dx + dz * dz) * tileSize
  const thickness = 0.2 // Same as WALL_THICKNESS
  // Extend by half thickness on each end
  const length = baseLength + thickness
  const height = wallHeight

  // Calculate center position (x-z plane is ground, y is up)
  const centerX = (x1 + x2) / 2 * tileSize
  const centerZ = (y1 + y2) / 2 * tileSize

  // Calculate rotation around Y axis (vertical)
  // Note: negative dz because Three.js Y-axis rotation transforms local X as (cos(θ), 0, -sin(θ))
  const angle = Math.atan2(-dz, dx)

  return (
    <group position={[centerX, height / 2, centerZ]} rotation={[0, angle, 0]}>
      <mesh>
        <boxGeometry args={[length, height, thickness]} />
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

