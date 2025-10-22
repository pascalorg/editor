'use client'

import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useMemo } from 'react'

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
  
  // Calculate aspect-ratio-preserving dimensions
  const [planeWidth, planeHeight] = useMemo(() => {
    if (!texture.image) return [GRID_SIZE, GRID_SIZE]
    
    const imageWidth = texture.image.width
    const imageHeight = texture.image.height
    const aspectRatio = imageWidth / imageHeight
    
    // Fit within GRID_SIZE while preserving aspect ratio
    if (aspectRatio > 1) {
      // Wider than tall - width constrained to GRID_SIZE
      return [GRID_SIZE, GRID_SIZE / aspectRatio]
    } else {
      // Taller than wide - height constrained to GRID_SIZE
      return [GRID_SIZE * aspectRatio, GRID_SIZE]
    }
  }, [texture])
  
  return (
    <mesh
      position={[position[0], 0.001, position[1]]}
      rotation={[-Math.PI / 2, rotation, 0]}
      scale={scale}
    >
      <planeGeometry args={[planeWidth, planeHeight]} />
      <meshStandardMaterial 
        map={texture}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={1}
      />
    </mesh>
  )
}

