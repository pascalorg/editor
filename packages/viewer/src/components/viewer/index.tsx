'use client'

import { CeilingSystem, DoorSystem, ItemSystem, RoofSystem, SlabSystem, WallSystem, WindowSystem } from '@pascal-app/core'
import { Bvh } from '@react-three/drei'
import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { GuideSystem } from '../../systems/guide/guide-system'
import { LevelSystem } from '../../systems/level/level-system'
import { ScanSystem } from '../../systems/scan/scan-system'
import { WallCutout } from '../../systems/wall/wall-cutout'
import { ZoneSystem } from '../../systems/zone/zone-system'
import { SceneRenderer } from '../renderers/scene-renderer'
import { Lights } from './lights'
import PostProcessing from './post-processing'
import { SelectionManager } from './selection-manager'
import { ViewerCamera } from './viewer-camera'

import { GroundOccluder } from './ground-occluder'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import useViewer from '../../store/use-viewer'

function AnimatedBackground({ isDark }: { isDark: boolean }) {
  const targetColor = useMemo(() => new THREE.Color(), [])
  const initialized = useRef(false)

  useFrame(({ scene }, delta) => {
    const dt = Math.min(delta, 0.1) * 4
    const targetHex = isDark ? '#12151e' : '#fafafa'
    
    if (!scene.background || !(scene.background instanceof THREE.Color)) {
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
  isEditor?: boolean
}

const Viewer: React.FC<ViewerProps> = ({ children, selectionManager = 'default', isEditor = false }) => {
  const setIsEditor = useViewer((state) => state.setIsEditor)
  const theme = useViewer((state) => state.theme)

  const bgColor = theme === 'dark' ? '#12151e' : '#fafafa'

  useEffect(() => {
    setIsEditor(isEditor)
  }, [isEditor, setIsEditor])

  return (
    <Canvas
      dpr={[1, 1.5]}
      className={`transition-colors duration-700 ${theme === 'dark' ? 'bg-[#12151e]' : 'bg-[#fafafa]'}`}
      gl={(props) => {
        const renderer = new THREE.WebGPURenderer(props as any)
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 0.9
        return renderer
      }}
      shadows={{
        type: THREE.PCFShadowMap,
        enabled: true,
      }}
      camera={{ position: [50, 50, 50], fov: 50 }}
    >
      <AnimatedBackground isDark={theme === 'dark'} />
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
