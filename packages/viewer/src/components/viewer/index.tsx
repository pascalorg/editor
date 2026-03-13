'use client'

import {
  CeilingSystem,
  DoorSystem,
  ItemSystem,
  RoofSystem,
  SlabSystem,
  WallSystem,
  WindowSystem,
} from '@pascal-app/core'
import { Bvh } from '@react-three/drei'
import { Canvas, extend, type ThreeToJSXElements, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three/webgpu'
import useViewer from '../../store/use-viewer'
import { GuideSystem } from '../../systems/guide/guide-system'
import { LevelSystem } from '../../systems/level/level-system'
import { ScanSystem } from '../../systems/scan/scan-system'
import { WallCutout } from '../../systems/wall/wall-cutout'
import { ZoneSystem } from '../../systems/zone/zone-system'
import { SceneRenderer } from '../renderers/scene-renderer'
import { GroundOccluder } from './ground-occluder'
import { Lights } from './lights'
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

interface ViewerProps {
  children?: React.ReactNode
  selectionManager?: 'default' | 'custom'
}

const Viewer: React.FC<ViewerProps> = ({ children, selectionManager = 'default' }) => {
  const theme = useViewer((state) => state.theme)

  return (
    <Canvas
      camera={{ position: [50, 50, 50], fov: 50 }}
      className={`transition-colors duration-700 ${theme === 'dark' ? 'bg-[#1f2433]' : 'bg-[#fafafa]'}`}
      dpr={[1, 1.5]}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as any)
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 0.9
        await renderer.init()
        return renderer
      }}
      shadows={{
        type: THREE.PCFShadowMap,
        enabled: true,
      }}
    >
      {/* <AnimatedBackground isDark={theme === 'dark'} /> */}
      <GroundOccluder />
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
      <WallSystem />
      <WindowSystem />
      <ZoneSystem />
      <PostProcessing />

      {selectionManager === 'default' && <SelectionManager />}
      {children}
    </Canvas>
  )
}

export default Viewer
