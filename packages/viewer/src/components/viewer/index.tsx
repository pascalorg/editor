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

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any)

interface ViewerProps {
  children?: React.ReactNode
  selectionManager?: 'default' | 'custom'
}

const Viewer: React.FC<ViewerProps> = ({ children, selectionManager = 'default' }) => {
  return (
    <Canvas
      dpr={[1, 1.5]}
      className={'bg-[#fafafa]'}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as any)
        await renderer.init()
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
      <color attach="background" args={['#fafafa']} />
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
