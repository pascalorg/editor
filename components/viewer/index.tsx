'use client'

import { animated, useSpring } from '@react-spring/three'
import { OrthographicCamera, PerspectiveCamera, SoftShadows } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import { NodesDebugger } from '@/components/debug/nodes-debugger'
import { InfiniteFloor, useGridFadeControls } from '@/components/editor/infinite-floor'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import { EnvironmentRenderer } from '../nodes/environment/environment-renderer'
import { NodeRenderer } from '../renderer/node-renderer'
import { SelectionControls } from '../renderer/selection-controls'
import { DebugBoundingBoxes } from './debug-bounding-boxes'
import { LevelHoverManager } from './level-hover-manager'
import { ViewerCustomControls } from './viewer-custom-controls'

const TILE_SIZE = 0.5 // 50cm grid spacing
export const WALL_HEIGHT = 2.5 // 2.5m standard wall height
export const GRID_SIZE = 30 // 30m x 30m
const SHOW_GRID = true // Show grid by default

export const FLOOR_SPACING = 12 // 12m vertical spacing between floors

// Viewer zoom configuration - adjust these to control default zoom level
export const VIEWER_DEFAULT_ZOOM = 80 // Orthographic camera zoom level (higher = more zoomed in)
export const VIEWER_INITIAL_CAMERA_DISTANCE = 30 // Initial camera distance from origin (matches editor)
export const VIEWER_DESELECTED_CAMERA_DISTANCE = 6 // Camera distance when no floor is selected

interface ViewerProps {
  className?: string
  /** Initial zoom level for orthographic camera (default: 80) */
  defaultZoom?: number
  /** When true, posts selection changes to parent window for iframe embedding */
  isEmbedded?: boolean
}

export default function Viewer({
  className,
  defaultZoom = VIEWER_DEFAULT_ZOOM,
  isEmbedded = false,
}: ViewerProps) {
  // Use individual selectors for better performance
  const building = useEditor((state) =>
    state.scene.root.children?.[0]?.children.find((c) => c.type === 'building'),
  )
  const site = useEditor((state) => state.scene.root.children?.[0])

  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)
  const viewMode = useEditor((state) => state.viewMode)
  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const levelMode = useEditor((state) => state.levelMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)
  const viewerDisplayMode = useEditor((state) => state.viewerDisplayMode)
  const selectFloor = useEditor((state) => state.selectFloor)
  const selectCollection = useEditor((state) => state.selectCollection)

  // Grid fade controls for infinite base floor
  const { fadeDistance, fadeStrength } = useGridFadeControls()

  // Reset state on mount to ensure clean start (stacked, no selection)
  useEffect(() => {
    useEditor.setState({
      selectedNodeIds: [],
      selectedFloorId: null,
      selectedCollectionId: null,
      levelMode: 'stacked',
      viewMode: 'full',
    })
  }, [])

  // Notify parent window about selection changes (for embedded mode)
  useEffect(() => {
    if (!isEmbedded) return
    const message = {
      type: 'selection',
      nodeIds: selectedNodeIds,
    }
    window.parent.postMessage(message, '*')
  }, [isEmbedded, selectedNodeIds])

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
        e.stopPropagation()
        const state = useEditor.getState()

        // Progressive unselection:
        // 1. If nodes selected (including Building) -> Deselect all, go to Stacked
        if (state.selectedNodeIds.length > 0) {
          // If Building is selected, go to Site
          if (
            building &&
            state.selectedNodeIds.length === 1 &&
            state.selectedNodeIds[0] === building.id
          ) {
            if (site) {
              useEditor.setState({
                selectedNodeIds: [site.id],
                selectedFloorId: null,
                viewMode: 'full',
              })
              return
            }
          }

          // If Site is ALREADY selected, prevent deselection (keep as root default)
          if (site && state.selectedNodeIds.length === 1 && state.selectedNodeIds[0] === site.id) {
            return
          }

          useEditor.setState({
            selectedNodeIds: [],
          })
          return
        }

        // 2. If Collection selected -> Back to Floor
        if (state.selectedCollectionId) {
          selectCollection(null)
          return
        }

        // 3. If Floor selected -> Back to Building (Exploded)
        if (state.selectedFloorId) {
          if (building) {
            useEditor.setState({
              selectedFloorId: null,
              selectedNodeIds: [building.id],
              viewMode: 'full',
              // Keep levelMode as is (likely exploded)
            })
          } else {
            selectFloor(null)
          }
          return
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    cameraMode,
    setCameraMode,
    toggleLevelMode,
    selectFloor,
    selectCollection,
    selectedNodeIds,
    selectedCollectionId,
    selectedFloorId,
    building,
    site,
  ])

  const tileSize = TILE_SIZE
  const showGrid = SHOW_GRID

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Prevent browser context menu
    e.preventDefault()
  }, [])

  const disabledRaycast = useCallback(() => null, [])

  // Handle background click for progressive deselection
  const onBackgroundClick = useCallback(() => {
    // Full reset on background click
    useEditor.setState({
      selectedNodeIds: [],
      selectedCollectionId: null,
      selectedFloorId: null,
      levelMode: 'stacked',
      viewMode: 'full',
    })
  }, [])

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
            zoom={defaultZoom}
          />
        )}
        <color args={['#212134']} attach="background" />

        {/* Large background plane to capture clicks outside of floor hit targets */}
        {/* Note: LevelHoverManager handles all click logic via native DOM events, so we disable */}
        {/* R3F raycasting here to prevent onBackgroundClick from interfering with level selection */}
        <mesh
          onClick={onBackgroundClick}
          position={[0, -0.1, 0]}
          raycast={disabledRaycast}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial opacity={0} transparent />
        </mesh>

        {/* Loop through all floors and render grid + walls for each */}
        <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
          {building && <NodeRenderer isViewer nodeId={building.id} />}
        </group>

        {/* Removed SelectionManager to prevent conflict with LevelHoverManager */}
        <SelectionControls controls={false} />
        <LevelHoverManager />
        <ViewerCustomControls />
        <EnvironmentRenderer />
        {/* Infinite floor - rendered outside export group */}
        <InfiniteFloor />
        {/* Debug bounding boxes for selected nodes */}
        <DebugBoundingBoxes />
      </Canvas>

      {/* Debug panel - only in development */}
      {process.env.NODE_ENV === 'development' && <NodesDebugger />}
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
