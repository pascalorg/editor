'use client'

import { useControls } from 'leva'

export function InfiniteFloor() {
  const { floorColor, metalness, roughness, size } = useControls('Floor Material', {
    floorColor: { value: '#141421', label: 'Floor Color' },
    metalness: { value: 0.05, min: 0, max: 1, step: 0.01, label: 'Metalness' },
    roughness: { value: 0.95, min: 0, max: 1, step: 0.01, label: 'Roughness' },
    size: { value: 2000, min: 100, max: 2000, step: 100, label: 'Size (m)' },
  })

  return (
    <mesh
      position={[0, -0.01, 0]}
      raycast={() => null}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={floorColor} metalness={metalness} roughness={roughness} />
    </mesh>
  )
}

export function useGridFadeControls() {
  return useControls('Grid Fade', {
    fadeDistance: { value: 40, min: 10, max: 100, step: 5, label: 'Fade Distance (m)' },
    fadeStrength: { value: 5, min: 0.5, max: 5, step: 0.1, label: 'Fade Strength' },
  })
}
