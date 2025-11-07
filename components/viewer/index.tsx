'use client'

import { animated, useSpring } from '@react-spring/three'
import { Environment, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type * as THREE from 'three'
import { ScanBuilder } from '@/components/editor/elements/scan-builder'
import { InfiniteFloor, useGridFadeControls } from '@/components/editor/infinite-floor'
import { InfiniteGrid } from '@/components/editor/infinite-grid'
import { ProximityGrid } from '@/components/editor/proximity-grid'
import { useEditor } from '@/hooks/use-editor'
import { nodeTreeToComponentsWithLevels } from '@/lib/migration/nodes-to-legacy'
import { calculateLevelBoundsById } from '@/lib/nodes/bounds'
import { cn } from '@/lib/utils'
import { NodeRenderer } from '../renderer/node-renderer'
import { ViewerControls } from './viewer-controls'
import { ViewerCustomControls } from './viewer-custom-controls'

const TILE_SIZE = 0.5 // 50cm grid spacing
export const WALL_HEIGHT = 2.5 // 2.5m standard wall height
export const GRID_SIZE = 30 // 30m x 30m
const SHOW_GRID = true // Show grid by default

export const FLOOR_SPACING = 12 // 12m vertical spacing between floors

// Viewer zoom configuration - adjust these to control default zoom level
export const VIEWER_DEFAULT_ZOOM = 80 // Orthographic camera zoom level (higher = more zoomed in)
export const VIEWER_INITIAL_CAMERA_DISTANCE = 8 // Initial camera distance from origin
export const VIEWER_DESELECTED_CAMERA_DISTANCE = 12 // Camera distance when no floor is selected

export default function Viewer({ className }: { className?: string }) {
  // Use individual selectors for better performance
  const levels = useEditor((state) => state.levels)
  const updateLevels = useEditor((state) => state.updateLevels)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const viewMode = useEditor((state) => state.viewMode)
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const setWallsGroupRef = useEditor((state) => state.setWallsGroupRef)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)
  const viewerDisplayMode = useEditor((state) => state.viewerDisplayMode)
  const selectFloor = useEditor((state) => state.selectFloor)

  // Convert node tree to legacy component format for proximity grid
  const { components } = useMemo(() => nodeTreeToComponentsWithLevels(levels), [levels])

  // Grid fade controls for infinite base floor
  const { fadeDistance, fadeStrength } = useGridFadeControls()

  // Use a callback ref to ensure the store is updated when the group is attached
  const allFloorsGroupCallback = useCallback(
    (node: THREE.Group | null) => {
      if (node) {
        setWallsGroupRef(node)
      }
    },
    [setWallsGroupRef],
  )

  // State for hover effects (floor hover only in viewer)
  const [hoveredFloorId, setHoveredFloorId] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
      } else if (e.key === 'l' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        toggleLevelMode()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        selectFloor(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cameraMode, setCameraMode, toggleLevelMode, selectFloor])

  const tileSize = TILE_SIZE
  const showGrid = SHOW_GRID

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Prevent browser context menu
    e.preventDefault()
  }, [])

  const disabledRaycast = useCallback(() => null, [])

  const onCanvasClick = useCallback(() => {
    // Clicking on the canvas background deselects all floors
    selectFloor(null)
  }, [selectFloor])

  return (
    <div className="relative h-full w-full">
      <Canvas className={cn('bg-[#303035]', className)} onContextMenu={onContextMenu} shadows>
        {cameraMode === 'perspective' ? (
          <PerspectiveCamera far={1000} fov={50} makeDefault near={0.1} position={[10, 10, 10]} />
        ) : (
          <OrthographicCamera
            far={1000}
            makeDefault
            near={-1000}
            position={[10, 10, 10]}
            zoom={VIEWER_DEFAULT_ZOOM}
          />
        )}
        <color args={['#212134']} attach="background" />

        {/* Large background plane to capture clicks outside of floor hit targets */}
        <mesh onClick={onCanvasClick} position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial opacity={0} transparent />
        </mesh>

        {/* Loop through all floors and render grid + walls for each */}
        <group ref={allFloorsGroupCallback}>
          {levels
            .filter((level) => level.type === 'level' && level.visible !== false)
            .map((floor, index, visibleFloors) => {
              const floorLevel = floor.level || 0
              const yPosition =
                (levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT) * floorLevel
              const isActiveFloor = selectedFloorId === floor.id

              // Calculate hit box height (distance to next floor level)
              const heightPerLevel = levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT
              // Find if there's a floor above this one
              const nextFloor = visibleFloors.find((f) => (f.level || 0) === floorLevel + 1)
              const hitBoxHeight = nextFloor ? heightPerLevel : heightPerLevel

              // Calculate bounds for this floor (in grid units) using node tree
              const bounds = calculateLevelBoundsById(levels, floor.id, 6)

              // Debug logging
              if (bounds) {
                console.log(`Floor ${floor.id} (level ${floor.level}) bounds:`, bounds)
                console.log(
                  `  Grid: minX=${bounds.minX}, maxX=${bounds.maxX}, minZ=${bounds.minZ}, maxZ=${bounds.maxZ}`,
                )
              }

              // Convert bounds to world units and add padding
              const PADDING = 1.5 // padding in grid units
              const hitBoxWidth = bounds
                ? (bounds.maxX - bounds.minX + PADDING * 2) * tileSize
                : GRID_SIZE
              const hitBoxDepth = bounds
                ? (bounds.maxZ - bounds.minZ + PADDING * 2) * tileSize
                : GRID_SIZE
              const hitBoxCenterX = bounds ? ((bounds.minX + bounds.maxX) / 2) * tileSize : 0
              const hitBoxCenterZ = bounds ? ((bounds.minZ + bounds.maxZ) / 2) * tileSize : 0

              // Debug logging continued
              if (bounds && floor.level === 2) {
                console.log(`  Hit box: width=${hitBoxWidth}, depth=${hitBoxDepth}`)
                console.log(`  Center (before offset): x=${hitBoxCenterX}, z=${hitBoxCenterZ}`)
                console.log(
                  `  Final position: x=${hitBoxCenterX - GRID_SIZE / 2}, z=${hitBoxCenterZ - GRID_SIZE / 2}`,
                )
              }

              // Find the level directly below (for reference grid)
              const levelBelow = floorLevel > 0 ? floorLevel - 1 : null
              const floorBelow =
                levelBelow !== null
                  ? levels.find((level) => level.type === 'level' && level.level === levelBelow)
                  : null

              return (
                <AnimatedLevel key={floor.id} positionY={yPosition}>
                  {/* Clickable hit target box for floor selection */}
                  <mesh
                    onClick={(e) => {
                      e.stopPropagation()
                      selectFloor(floor.id)
                    }}
                    onPointerEnter={(e) => {
                      e.stopPropagation()
                      setHoveredFloorId(floor.id)
                      document.body.style.cursor = 'pointer'
                    }}
                    onPointerLeave={(e) => {
                      e.stopPropagation()
                      setHoveredFloorId(null)
                      document.body.style.cursor = 'default'
                    }}
                    position={[
                      hitBoxCenterX - GRID_SIZE / 2,
                      hitBoxHeight / 2,
                      hitBoxCenterZ - GRID_SIZE / 2,
                    ]}
                  >
                    <boxGeometry args={[hitBoxWidth, hitBoxHeight, hitBoxDepth]} />
                    <meshBasicMaterial
                      color="#ffffff"
                      opacity={hoveredFloorId === floor.id ? 0.15 : 0}
                      transparent
                    />
                  </mesh>

                  {/* Solid dark purple floor for lowest level only - infinite appearance */}
                  {floorLevel === 0 && <InfiniteFloor />}

                  {/* Grid for visual reference only - not interactive */}
                  {showGrid && (
                    <group raycast={() => null}>
                      {floorLevel === 0 ? (
                        // Base level: show infinite grid
                        isActiveFloor ? (
                          <InfiniteGrid
                            fadeDistance={fadeDistance}
                            fadeStrength={fadeStrength}
                            gridSize={tileSize}
                            lineColor="#ffffff"
                            lineWidth={1.0}
                          />
                        ) : (
                          levelMode === 'exploded' && (
                            <InfiniteGrid
                              fadeDistance={fadeDistance}
                              fadeStrength={fadeStrength}
                              gridSize={tileSize}
                              lineColor="#ffffff"
                              lineWidth={1.0}
                            />
                          )
                        )
                      ) : (
                        // Non-base level: show proximity-based grid around elements
                        <>
                          {isActiveFloor && (
                            <ProximityGrid
                              components={components}
                              fadeWidth={0.5}
                              floorId={floor.id}
                              gridSize={tileSize}
                              lineColor="#ffffff"
                              lineWidth={1.0}
                              maxSize={GRID_SIZE}
                              offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                              opacity={0.3}
                              padding={1.5}
                              previewCustomRoom={null}
                              previewRoof={null}
                              previewRoom={null}
                              previewWall={null}
                            />
                          )}
                          {!isActiveFloor && levelMode === 'exploded' && (
                            <ProximityGrid
                              components={components}
                              fadeWidth={0.5}
                              floorId={floor.id}
                              gridSize={tileSize}
                              lineColor="#ffffff"
                              lineWidth={1.0}
                              maxSize={GRID_SIZE}
                              offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                              opacity={0.15}
                              padding={1.5}
                              previewCustomRoom={null}
                              previewRoof={null}
                              previewRoom={null}
                              previewWall={null}
                            />
                          )}
                        </>
                      )}
                    </group>
                  )}

                  {/* Show grid from level below as reference for non-base levels (only in exploded mode) */}
                  {showGrid &&
                    floorLevel > 0 &&
                    isActiveFloor &&
                    floorBelow &&
                    levelMode === 'exploded' && (
                      <group
                        position={[0, -(levelMode === 'exploded' ? FLOOR_SPACING : WALL_HEIGHT), 0]}
                        raycast={() => null}
                      >
                        <ProximityGrid
                          components={components}
                          fadeWidth={0.5}
                          floorId={floorBelow.id}
                          gridSize={tileSize}
                          lineColor="#ffffff"
                          lineWidth={1.0}
                          maxSize={GRID_SIZE}
                          offset={[-GRID_SIZE / 2, -GRID_SIZE / 2]}
                          opacity={0.08}
                          padding={1.5}
                          previewCustomRoom={null}
                          previewRoof={null}
                          previewRoom={null}
                          previewWall={null}
                        />
                      </group>
                    )}

                  {/* Render node tree - filtered by viewerDisplayMode */}
                  <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
                    {/* Scan builder for handling scan manipulation */}
                    <ScanBuilder />
                    <NodeRenderer isViewer node={floor} />
                  </group>
                </AnimatedLevel>
              )
            })}
        </group>

        <ViewerCustomControls />
        <Environment preset="city" />
      </Canvas>

      {/* Viewer Controls */}
      <ViewerControls />
    </div>
  )
}

interface AnimatedLevelProps {
  children: React.ReactNode
  positionY?: number
}

const AnimatedLevel: React.FC<AnimatedLevelProps> = ({ positionY, children }) => {
  const animatedProps = useSpring({
    positionY,
    config: { mass: 1, tension: 170, friction: 26 },
  })

  return <animated.group position-y={animatedProps.positionY}>{children}</animated.group>
}
