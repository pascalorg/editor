'use client'

// Lighting constants
const AMBIENT_INTENSITY = 0.5
const DIRECTIONAL_INTENSITY = 1
const DIRECTIONAL_POSITION: [number, number, number] = [10, 10, 5]

export function LightingControls() {
  return (
    <>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <directionalLight
        castShadow
        intensity={DIRECTIONAL_INTENSITY}
        position={DIRECTIONAL_POSITION}
        shadow-camera-bottom={-15}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-mapSize={[1024, 1024]}
      />
    </>
  )
}
