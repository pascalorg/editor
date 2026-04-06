'use client'

// Must run before @react-three/fiber's Canvas instantiates new THREE.Clock().
// See lib/suppress-three-clock-warning.ts for rationale and removal condition.
import '../../lib/suppress-three-clock-warning'

import {
  CeilingSystem,
  DoorSystem,
  ItemSystem,
  RoofSystem,
  SlabSystem,
  StairSystem,
  WallSystem,
  WindowSystem,
} from '@pascal-app/core'
import { Bvh } from '@react-three/drei'
import { Canvas, extend, type ThreeToJSXElements, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three/webgpu'
import useViewer from '../../store/use-viewer'
import { ExportSystem } from '../../systems/export/export-system'
import { GuideSystem } from '../../systems/guide/guide-system'
import { ItemLightSystem } from '../../systems/item-light/item-light-system'
import { LevelSystem } from '../../systems/level/level-system'
import { ScanSystem } from '../../systems/scan/scan-system'
import { WallCutout } from '../../systems/wall/wall-cutout'
import { ZoneSystem } from '../../systems/zone/zone-system'
import { SceneRenderer } from '../renderers/scene-renderer'
import { Lights } from './lights'
import { PerfMonitor } from './perf-monitor'
import PostProcessing from './post-processing'
import { SelectionManager } from './selection-manager'
import { ViewerCamera } from './viewer-camera'

function AnimatedBackground({ isDark }: { isDark: boolean }) {
  const targetColor = useMemo(() => new THREE.Color(), [])
  const initialized = useRef(false)

  useFrame(({ scene }, delta) => {
    const dt = Math.min(delta, 0.1) * 4
    const targetHex = isDark ? '#1f2433' : '#ffffff'

    if (!(scene.background && scene.background instanceof THREE.Color)) {
      scene.background = new THREE.Color(targetHex)
      initialized.current = true
      return
    }

    if (!initialized.current) {
      scene.background.set(targetHex)
      initialized.current = true
      return
    }

    targetColor.set(targetHex)
    scene.background.lerp(targetColor, dt)
  })

  return null
}

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any)

/**
 * Monitors the WebGPU device for loss events and logs them.
 * WebGPU device loss can happen when:
 *  - Tab is backgrounded and OS reclaims GPU
 *  - Driver crash or GPU reset
 *  - Browser security policy kills the context
 */
function GPUDeviceWatcher() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const backend = (gl as any).backend
    const device: GPUDevice | undefined = backend?.device

    if (!device) return

    device.lost.then((info) => {
      console.error(
        `[viewer] WebGPU device lost: reason="${info.reason}", message="${info.message}". ` +
          'The page must be reloaded to recover the GPU context.',
      )
    })
  }, [gl])

  return null
}

interface ViewerProps {
  children?: React.ReactNode
  selectionManager?: 'default' | 'custom'
  perf?: boolean
}

const Viewer: React.FC<ViewerProps> = ({
  children,
  selectionManager = 'default',
  perf = false,
}) => {
  const theme = useViewer((state) => state.theme)

  return (
    <Canvas
      camera={{ position: [50, 50, 50], fov: 50 }}
      className={`transition-colors duration-700 ${theme === 'dark' ? 'bg-[#1f2433]' : 'bg-[#fafafa]'}`}
      dpr={[1, 1.5]}
      gl={(props) => {
        const renderer = new THREE.WebGPURenderer(props as any)
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 0.9
        // renderer.init() // Only use when using <DebugRenderer />
        return renderer
      }}
      resize={{
        debounce: 100,
      }}
      shadows={{
        type: THREE.PCFShadowMap,
        enabled: true,
      }}
    >
      {/* <AnimatedBackground isDark={theme === 'dark'} /> */}
      <ViewerCamera />

      {/* <directionalLight position={[10, 10, 5]} intensity={0.5} castShadow
        /> */}
      <Lights />
      <Bvh>
        <SceneRenderer />
      </Bvh>

      {/* Default Systems */}
      <LevelSystem />
      <GuideSystem />
      <ScanSystem />
      <WallCutout />
      {/* Core systems */}
      <CeilingSystem />
      <DoorSystem />
      <ItemSystem />
      <RoofSystem />
      <SlabSystem />
      <StairSystem />
      <WallSystem />
      <WindowSystem />
      <ZoneSystem />
      <ExportSystem />
      <PostProcessing />
      {/* <DebugRenderer /> */}
      <GPUDeviceWatcher />

      <ItemLightSystem />
      {selectionManager === 'default' && <SelectionManager />}
      {perf && <PerfMonitor />}
      {children}
    </Canvas>
  )
}

const DebugRenderer = () => {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera)
  })
  return null
}

export default Viewer
