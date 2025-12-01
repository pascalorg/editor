'use client'

// Floor material constants
const FLOOR_COLOR = '#141421'
const FLOOR_METALNESS = 0.05
const FLOOR_ROUGHNESS = 0.95
const FLOOR_SIZE = 2000

// Grid fade constants
const FADE_DISTANCE = 40
const FADE_STRENGTH = 5

export function InfiniteFloor() {
  return (
    <mesh
      position={[0, -0.01, 0]}
      raycast={() => null}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      <shadowMaterial color={FLOOR_COLOR} opacity={0.2} transparent />
    </mesh>
  )
}

export function useGridFadeControls() {
  return {
    fadeDistance: FADE_DISTANCE,
    fadeStrength: FADE_STRENGTH,
  }
}
