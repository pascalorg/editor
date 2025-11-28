'use client'

import {
  Environment,
  GizmoHelper,
  GizmoViewport,
  Gltf,
  Line,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect } from 'react'
import '@/components/nodes'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'
import { useKeyboard } from '@/hooks/use-keyboard'
import { cn } from '@/lib/utils'
import { EnvironmentRenderer } from '../nodes/environment/environment-renderer'
import { NodeRenderer } from '../renderer/node-renderer'
import { SelectionControls } from '../renderer/selection-controls'
import { CustomControls } from './custom-controls'
import { InfiniteFloor } from './infinite-floor'
import { InfiniteLines } from './infinite-lines'
import SelectionManager from './selection-manager'

export const TILE_SIZE = 0.5 // 50cm grid spacing
export const WALL_HEIGHT = 2.5 // 2.5m standard wall height
export const GRID_SIZE = 30 // 30m x 30m
const SHOW_GRID = true // Show grid by default
const GRID_DIVISIONS = Math.floor(GRID_SIZE / TILE_SIZE) // 60 divisions
export const GRID_INTERSECTIONS = GRID_DIVISIONS + 1 // 61 intersections per axis

export const FLOOR_SPACING = 12 // 12m vertical spacing between floors

export default function Editor({ className }: { className?: string }) {
  const controlMode = useEditor((state) => state.controlMode)
  const cameraMode = useEditor((state) => state.cameraMode)
  const rootId = useEditor(
    (state) => state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')?.id,
  )

  const setPointerPosition = useEditor((state) => state.setPointerPosition)

  // Clear cursor position when switching floors to prevent grid artifacts
  useEffect(() => {
    setPointerPosition?.(null)
  }, [setPointerPosition])

  useKeyboard()

  return (
    <Canvas className={cn('bg-[#303035]', className)} shadows>
      {cameraMode === 'perspective' ? (
        <PerspectiveCamera far={1000} fov={50} makeDefault near={0.1} position={[10, 10, 10]} />
      ) : (
        <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
      )}
      <color args={['#212134']} attach="background" />

      {/* TMP FUNNY TO SEE TODO: Create a true node with it's "builder" to be able to move it and save it */}
      <Gltf position={[0, 0.02, 0]} scale={0.1} src="/models/Banana.glb" />
      <Gltf castShadow position={[0, 0, 0]} receiveShadow scale={0.09} src="/models/Human.glb" />
      {/* Lighting setup with shadows */}
      <ambientLight intensity={0.1} />
      <directionalLight
        castShadow
        intensity={2}
        position={[20, 30, 20]}
        shadow-bias={-0.0001}
        shadow-camera-bottom={-30}
        shadow-camera-far={100}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-mapSize={[2048, 2048]}
      />

      {SHOW_GRID && <InfiniteLines />}

      {/* Infinite floor - rendered outside export group */}
      <InfiniteFloor />

      {/* Loop through all floors and render grid + walls for each */}
      <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
        {rootId && <NodeRenderer nodeId={rootId} />}
      </group>

      {controlMode === 'select' && (
        <>
          <SelectionManager />
          <SelectionControls />
        </>
      )}
      <CustomControls />
      <EnvironmentRenderer />

      <Environment preset="city" />

      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  )
}
