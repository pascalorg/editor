'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Color } from 'three'
import type { Group } from 'three'

function CityMass() {
  const groupRef = useRef<Group>(null!)

  const buildings = useMemo(() => {
    const rng = (seed: number) => {
      let x = Math.sin(seed) * 10000
      return x - Math.floor(x)
    }
    return Array.from({ length: 28 }, (_, i) => ({
      x: (rng(i * 3.1) - 0.5) * 12,
      z: (rng(i * 5.7) - 0.5) * 12,
      height: 0.4 + rng(i * 2.3) * 3.2,
      width: 0.3 + rng(i * 7.1) * 0.8,
      depth: 0.3 + rng(i * 4.3) * 0.7,
      color: new Color().setHSL(0.67 + rng(i) * 0.08, 0.5 + rng(i * 9) * 0.3, 0.25 + rng(i * 11) * 0.25),
    }))
  }, [])

  useFrame((_, delta) => {
    groupRef.current.rotation.y += delta * 0.12
  })

  return (
    <group ref={groupRef}>
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial color="#0d0d1a" roughness={1} />
      </mesh>
      {/* Grid lines */}
      <gridHelper args={[18, 18, '#1a1a3a', '#111128']} position={[0, -0.04, 0]} />

      {buildings.map((b, i) => (
        <mesh key={i} position={[b.x, b.height / 2 - 0.05, b.z]} castShadow>
          <boxGeometry args={[b.width, b.height, b.depth]} />
          <meshStandardMaterial color={b.color} roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

export default function HeroCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 8, 12], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      dpr={[1, 1.5]}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.3} />
      <directionalLight position={[8, 12, 4]} intensity={1.4} color="#ffffff" />
      <directionalLight position={[-6, 4, -8]} intensity={0.6} color="#4338ca" />
      <pointLight position={[0, 6, 0]} intensity={0.8} color="#818cf8" distance={20} />
      <CityMass />
      <fog attach="fog" args={['#050510', 14, 28]} />
    </Canvas>
  )
}
