'use client'

import { useTexture } from '@react-three/drei'
import * as THREE from 'three'

const GRID_SIZE = 30 // 30m x 30m

type ReferenceImageProps = {
  url: string
  opacity: number
  scale: number
  position: [number, number]
  rotation: number
}

export const ReferenceImage = ({ url, opacity, scale, position, rotation }: ReferenceImageProps) => {
  const texture = useTexture(url)
  
  return (
    <mesh
      position={[position[0], position[1], 0.001]}
      rotation={[0, 0, rotation]}
      scale={scale}
    >
      <planeGeometry args={[GRID_SIZE, GRID_SIZE]} />
      <meshStandardMaterial 
        map={texture}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

