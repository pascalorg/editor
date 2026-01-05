'use client'

import { EnvironmentRenderer, ZoneRenderer } from '@pascal/core/components/nodes'
import { NodeRenderer } from '@pascal/core/components/renderer'
import { InfiniteFloor } from '@pascal/core/components/viewer'
import { GRID_SIZE } from '@pascal/core/constants'
import { emitter, type InteractionClickEvent } from '@pascal/core/events'
import { useEditor, type WallMode } from '@pascal/core/hooks'
import { animated, useSpring } from '@react-spring/three'
import { Bvh, OrthographicCamera, PerspectiveCamera, SoftShadows } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import { cn } from '../utils'
import { LevelHoverManager } from './level-hover-manager'
import { SelectionControls } from './selection-controls'
import { VIEWER_DEFAULT_ZOOM, ViewerCustomControls } from './viewer-custom-controls'

/**
 * Lightweight subcomponent that handles selection state and iframe messaging.
 * Isolates re-renders caused by selection changes from the main Viewer tree.
 */
function SelectionMessageBridge({ isEmbedded }: { isEmbedded: boolean }) {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const selectedZoneId = useEditor((state) => state.selectedZoneId)

  // Notify parent window about selection changes (for embedded mode)
  useEffect(() => {
    if (!isEmbedded) return

    const state = useEditor.getState()
    const graph = state.graph

    // Enrich selected nodes with data
    const selectedNodes = selectedNodeIds.map((id) => {
      const node = graph.getNodeById(id as any)?.data()
      return node ? { id: node.id, type: node.type, name: node.name, data: node } : { id }
    })

    const message = {
      type: 'selection',
      selectedNodeIds,
      selectedNodes,
      selectedFloorId,
      selectedZoneId,
    }
    window.parent.postMessage(message, '*')
  }, [isEmbedded, selectedNodeIds, selectedFloorId, selectedZoneId])

  // Notify parent window about interaction clicks
  useEffect(() => {
    if (!isEmbedded) return

    const handleClick = (event: InteractionClickEvent) => {
      window.parent.postMessage(
        {
          type: 'click',
          interactionType: event.type,
          id: event.id,
          data: event.data,
        },
        '*',
      )
    }

    emitter.on('interaction:click', handleClick)
    return () => {
      emitter.off('interaction:click', handleClick)
    }
  }, [isEmbedded])

  // This component renders nothing - it only handles side effects
  return null
}

export interface ViewerProps {
  /** Initial zoom level for orthographic camera (default: 80) */
  defaultZoom?: number
  /** When true, posts selection changes to parent window for iframe embedding */
  isEmbedded?: boolean
  /** Initial wall mode for viewer */
  defaultWallMode?: WallMode
}

export default function Viewer({
  defaultZoom = VIEWER_DEFAULT_ZOOM,
  isEmbedded = false,
  defaultWallMode = 'cutaway',
}: ViewerProps) {
  // Use individual selectors for better performance
  const building = useEditor((state) =>
    state.scene.root.children?.[0]?.children.find((c) => c.type === 'building'),
  )
  const site = useEditor((state) => state.scene.root.children?.[0])

  const cameraMode = useEditor((state) => state.cameraMode)
  const setCameraMode = useEditor((state) => state.setCameraMode)
  const toggleLevelMode = useEditor((state) => state.toggleLevelMode)
  const selectFloor = useEditor((state) => state.selectFloor)
  const selectZone = useEditor((state) => state.selectZone)

  // Reset state on mount to ensure clean start (stacked, no selection)
  useEffect(() => {
    useEditor.setState({
      selectedNodeIds: [],
      selectedFloorId: null,
      selectedZoneId: null,
      levelMode: 'stacked',
      viewMode: 'full',
      wallMode: defaultWallMode,
    })
  }, [])

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
            site &&
            state.selectedNodeIds.length === 1 &&
            state.selectedNodeIds[0] === building.id
          ) {
            useEditor.setState({
              selectedNodeIds: [site.id],
              selectedFloorId: null,
              viewMode: 'full',
            })
            return
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

        // 2. If Zone selected -> Back to Floor
        if (state.selectedZoneId) {
          selectZone(null)
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
  }, [cameraMode, setCameraMode, toggleLevelMode, selectFloor, selectZone, building, site])

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
      selectedZoneId: null,
      selectedFloorId: null,
      levelMode: 'stacked',
      viewMode: 'full',
    })
  }, [])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
      }}
    >
      {/* Lightweight bridge for selection state -> iframe messaging */}
      <SelectionMessageBridge isEmbedded={isEmbedded} />

      <Canvas onContextMenu={onContextMenu} shadows style={{ backgroundColor: '#303035' }}>
        {/* <SoftShadows focus={1} samples={16} size={25} /> */}
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

        <Bvh>
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

          {/* Zone polygons */}
          <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
            <ZoneRenderer isViewer />
          </group>

          {/* Selection controls without manipulation UI */}
          <SelectionControls />
          <LevelHoverManager />
          <ViewerCustomControls />
          <EnvironmentRenderer />
          {/* Infinite floor - rendered outside export group */}
          <InfiniteFloor />
        </Bvh>
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
