'use client'

import { useControls } from 'leva'

export function LightingControls() {
  const { ambientIntensity, directionalIntensity, directionalX, directionalY, directionalZ } =
    useControls('Lighting', {
      ambientIntensity: {
        value: 0.5,
        min: 0,
        max: 2,
        step: 0.1,
        label: 'Ambient Intensity',
      },
      directionalIntensity: {
        value: 1,
        min: 0,
        max: 3,
        step: 0.1,
        label: 'Directional Intensity',
      },
      directionalX: { value: 10, min: -20, max: 20, step: 1, label: 'Light X' },
      directionalY: { value: 10, min: 0, max: 30, step: 1, label: 'Light Y' },
      directionalZ: { value: 5, min: -20, max: 20, step: 1, label: 'Light Z' },
    })

  return (
    <>
      <ambientLight intensity={ambientIntensity} />
      <directionalLight
        castShadow
        intensity={directionalIntensity}
        position={[directionalX, directionalY, directionalZ]}
        shadow-camera-bottom={-15}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-mapSize={[1024, 1024]}
      />
    </>
  )
}
