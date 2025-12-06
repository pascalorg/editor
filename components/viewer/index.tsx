'use client'

import { animated, useSpring } from '@react-spring/three'
import { Environment, OrthographicCamera, PerspectiveCamera, SoftShadows } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import { InfiniteFloor, useGridFadeControls } from '@/components/editor/infinite-floor'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import SelectionManager from '../editor/selection-manager'
import { EnvironmentRenderer } from '../nodes/environment/environment-renderer'
import { NodeRenderer } from '../renderer/node-renderer'
import { SelectionControls } from '../renderer/selection-controls'
import { LevelHoverManager } from './level-hover-manager'
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
  const building = useEditor((state) =>
    state.scene.root.children?.[0]?.children.find((c) => c.type === 'building'),
  )

  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const viewMode = useEditor((state) => state.viewMode)
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)
  const viewerDisplayMode = useEditor((state) => state.viewerDisplayMode)
  const selectFloor = useEditor((state) => state.selectFloor)

  // Grid fade controls for infinite base floor
  const { fadeDistance, fadeStrength } = useGridFadeControls()

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
    // selectFloor(null)
  }, [selectFloor])

  return (
    <div className="relative h-full w-full">
      <Canvas className={cn('bg-[#303035]', className)} onContextMenu={onContextMenu} shadows>
        <SoftShadows focus={1} samples={16} size={25} />
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
        <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
          {building && <NodeRenderer nodeId={building.id} />}
        </group>

        {/* Removed SelectionManager to prevent conflict with LevelHoverManager */}
        <SelectionControls controls={false} />
        <LevelHoverManager />
        <ViewerCustomControls />
        <EnvironmentRenderer />
        {/* Infinite floor - rendered outside export group */}
        <InfiniteFloor />
      </Canvas>
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
