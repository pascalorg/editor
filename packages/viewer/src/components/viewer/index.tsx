'use client'

import { CeilingSystem, ItemSystem, SlabSystem, WallSystem } from '@pascal-app/core'
import { Bvh, Environment } from '@react-three/drei'
import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { LevelSystem } from '../../systems/level/level-system'
import { SceneRenderer } from '../renderers/scene-renderer'
import PostProcessing from './post-processing'

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any)

interface ViewerProps {
  children?: React.ReactNode
}

const Viewer: React.FC<ViewerProps> = ({ children }) => {
  return (
    <Canvas
      className={'bg-[#303035]'}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as any)
        await renderer.init()
        return renderer
      }}
      shadows
      camera={{ position: [50, 50, 50], fov: 50 }}
    >
      <color attach="background" args={['#ececec']} />

      <directionalLight position={[10, 10, 5]} intensity={0.5} castShadow />
      <Environment preset="sunset" environmentIntensity={0.3} />
      <Bvh>
        <SceneRenderer />
      </Bvh>

      {/* Default Systems */}
      <LevelSystem />
      <CeilingSystem />
      <ItemSystem />
      <SlabSystem />
      <WallSystem />
      <PostProcessing />

      {children}
    </Canvas>
  )
}

export default Viewer
