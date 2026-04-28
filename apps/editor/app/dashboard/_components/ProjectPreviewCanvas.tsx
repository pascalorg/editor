'use client'

import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import type { Group } from 'three'

function Building() {
  const groupRef = useRef<Group>(null!)

  useFrame((_, delta) => {
    groupRef.current.rotation.y += delta * 0.4
  })

  return (
    <group ref={groupRef}>
      {/* Base slab */}
      <mesh position={[0, -0.6, 0]} castShadow>
        <boxGeometry args={[2.2, 0.12, 2.2]} />
        <meshStandardMaterial color="#3730a3" roughness={0.8} metalness={0.2} />
      </mesh>
      {/* Main tower */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[1, 1.6, 1]} />
        <meshStandardMaterial color="#4338ca" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Wing left */}
      <mesh position={[-0.7, -0.2, 0]} castShadow>
        <boxGeometry args={[0.5, 0.8, 0.8]} />
        <meshStandardMaterial color="#3730a3" roughness={0.7} metalness={0.25} />
      </mesh>
      {/* Wing right */}
      <mesh position={[0.7, -0.1, 0]} castShadow>
        <boxGeometry args={[0.5, 1, 0.7]} />
        <meshStandardMaterial color="#4f46e5" roughness={0.65} metalness={0.3} />
      </mesh>
      {/* Rooftop accent */}
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.3]} />
        <meshStandardMaterial color="#818cf8" roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  )
}

export default function ProjectPreviewCanvas() {
  return (
    <Canvas
      camera={{ position: [3, 2, 3], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'transparent', width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} />
      <directionalLight position={[-3, 2, -4]} intensity={0.3} color="#818cf8" />
      <Building />
    </Canvas>
  )
}
