'use client'

import {
  Environment,
  GizmoHelper,
  GizmoViewport,
  Gltf,
  OrthographicCamera,
  PerspectiveCamera,
  SoftShadows,
} from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect } from 'react'
import '@/components/nodes'
import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, type WebGLShadowMap } from 'three'
import { useEditor } from '@/hooks/use-editor'
import { useKeyboard } from '@/hooks/use-keyboard'
import { cn } from '@/lib/utils'
import { EnvironmentRenderer } from '../nodes/environment/environment-renderer'
import { PaintingTool } from '../nodes/painting/painting-tool'
import { SledgehammerTool } from '../nodes/sledgehammer/sledgehammer-tool'
import { ZoneBoundaryEditor } from '../nodes/zone/zone-boundary-editor'
import { ZoneRenderer } from '../nodes/zone/zone-renderer'
import { NodeRenderer } from '../renderer/node-renderer'
import { SelectionControls } from '../renderer/selection-controls'
import { CustomControls } from './custom-controls'
import { GridTiles } from './grid-tiles'
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
  const cameraMode = useEditor((state) => state.cameraMode)
  const rootId = useEditor((state) => state.scene.root.children?.[0]?.id)

  const setPointerPosition = useEditor((state) => state.setPointerPosition)

  // Clear cursor position when switching floors to prevent grid artifacts
  useEffect(() => {
    setPointerPosition?.(null)
  }, [setPointerPosition])

  useKeyboard()

  return (
    <Canvas
      className={cn('bg-[#303035]', className)}
      gl={{
        toneMapping: ACESFilmicToneMapping,
        outputColorSpace: SRGBColorSpace,
        toneMappingExposure: 1,
        localClippingEnabled: true,
        shadowMap: {
          type: PCFSoftShadowMap,
          enabled: true,
        } as WebGLShadowMap,
      }}
      shadows
    >
      {/* <SoftShadows focus={1} samples={16} size={25} /> */}
      {cameraMode === 'perspective' ? (
        <PerspectiveCamera far={1000} fov={50} makeDefault near={0.1} position={[10, 10, 10]} />
      ) : (
        <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
      )}
      <color args={['#212134']} attach="background" />

      {/* TMP FUNNY TO SEE TODO: Create a true node with it's "builder" to be able to move it and save it */}
      <Gltf position={[0, 0.02, 0]} scale={0.1} src="/models/Banana.glb" />
      <Gltf castShadow position={[0, 0, 0]} receiveShadow scale={0.09} src="/models/Human.glb" />

      {SHOW_GRID && <InfiniteLines />}

      {/* Infinite floor - rendered outside export group */}
      <InfiniteFloor />

      {/* Loop through all floors and render grid + walls for each */}
      <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
        {rootId && <NodeRenderer nodeId={rootId} />}
      </group>

      {/* Zone polygons and boundary editor */}
      <group position={[-GRID_SIZE / 2, 0, -GRID_SIZE / 2]}>
        <ZoneRenderer />
        <ZoneBoundaryEditor />
      </group>

      <ControlModeComponents />

      <CustomControls />
      <EnvironmentRenderer />

      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  )
}

const ControlModeComponents = () => {
  const controlMode = useEditor((state) => state.controlMode)

  return (
    <>
      {controlMode === 'select' && (
        <>
          <SelectionManager />
          <SelectionControls />
        </>
      )}

      {/* Sledgehammer tool for deleting walls and items */}
      {controlMode === 'delete' && <SledgehammerTool />}

      {/* Painting tool for applying materials to walls */}
      {controlMode === 'painting' && <PaintingTool />}
    </>
  )
}
