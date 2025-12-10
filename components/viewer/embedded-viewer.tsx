'use client'

import { OrthographicCamera, PerspectiveCamera, SoftShadows } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import { InfiniteFloor } from '@/components/editor/infinite-floor'
import { EnvironmentRenderer } from '@/components/nodes/environment/environment-renderer'
import { NodeRenderer } from '@/components/renderer/node-renderer'
import { SelectionControls } from '@/components/renderer/selection-controls'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import { LevelHoverManager } from './level-hover-manager'
import { ViewerCustomControls } from './viewer-custom-controls'

export const GRID_SIZE = 30 // 30m x 30m
export const VIEWER_DEFAULT_ZOOM = 80

export default function EmbeddedViewer({ className }: { className?: string }) {
  const building = useEditor((state) =>
    state.scene.root.children?.[0]?.children.find((c) => c.type === 'building'),
  )

  const cameraMode = useEditor((state) => state.cameraMode)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)
  const selectFloor = useEditor((state) => state.selectFloor)
  const selectCollection = useEditor((state) => state.selectCollection)

  // Notify parent window about selection changes
  useEffect(() => {
    const message = {
      type: 'selection',
      nodeIds: selectedNodeIds,
    }
    window.parent.postMessage(message, '*')
  }, [selectedNodeIds])

  // Handle keyboard events for progressive unselection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        // Progressive unselection: node selection → collection → level → building
        if (selectedNodeIds.length > 0) {
          // Clear node selection, but keep collection selected if there is one
          useEditor.setState({ selectedNodeIds: [] })
        } else if (selectedCollectionId) {
          // Unselect collection, go back to level focus
          selectCollection(null)
        } else if (selectedFloorId) {
          // Unselect level, go back to building focus
          selectFloor(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeIds, selectedCollectionId, selectedFloorId, selectCollection, selectFloor])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  // Handle background click for progressive deselection
  const onBackgroundClick = useCallback(() => {
    const state = useEditor.getState()
    // Progressive unselection: node selection → collection → level → building
    if (state.selectedNodeIds.length > 0) {
      // Clear node selection, but keep collection selected if there is one
      useEditor.setState({ selectedNodeIds: [] })
    } else if (state.selectedCollectionId) {
      // Unselect collection, go back to level focus
      state.selectCollection(null)
    } else if (state.selectedFloorId) {
      // Unselect level, go back to building focus
      state.selectFloor(null)
    }
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
            zoom={VIEWER_DEFAULT_ZOOM}
          />
        )}
        <color args={['#212134']} attach="background" />

        {/* Large background plane to capture clicks outside of floor hit targets */}
        <mesh onClick={onBackgroundClick} position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial opacity={0} transparent />
        </mesh>

        {/* Render the building nodes */}
        <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
          {building && <NodeRenderer nodeId={building.id} />}
        </group>

        {/* Selection feedback */}
        <SelectionControls controls={false} />
        <LevelHoverManager />
        <ViewerCustomControls />
        <EnvironmentRenderer />
        <InfiniteFloor />
      </Canvas>
    </div>
  )
}
