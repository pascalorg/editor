'use client'

import { CeilingSystem, ItemSystem, RoofSystem, SlabSystem, WallSystem } from '@pascal-app/core'
import { Bvh } from '@react-three/drei'
import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { GuideSystem } from '../../systems/guide/guide-system'
import { LevelSystem } from '../../systems/level/level-system'
import { ScanSystem } from '../../systems/scan/scan-system'
import { WallCutout } from '../../systems/wall/wall-cutout'
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
      className={'bg-[#303035]'}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as any)
        await renderer.init()
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.2
        return renderer
      }}
      shadows={{
        type: THREE.PCFShadowMap,
        enabled: true,
      }}
      camera={{ position: [50, 50, 50], fov: 50 }}
    >
      <color attach="background" args={['#ececec']} />
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
      <ItemSystem />
      <RoofSystem />
      <SlabSystem />
      <WallSystem />
      <PostProcessing />

      {selectionManager === 'default' && <SelectionManager />}
      {children}
    </Canvas>
  )
}

export default Viewer
