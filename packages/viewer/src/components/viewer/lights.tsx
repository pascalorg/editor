import { useRef } from 'react'
import type { DirectionalLight, OrthographicCamera } from 'three/webgpu'

export function Lights() {
  const lightRef = useRef<DirectionalLight>(null)
  const shadowCamera = useRef<OrthographicCamera>(null)
  const shadowCameraSize = 50 // The "area" around the camera to shadow

  // useHelper(lightRef, DirectionalLightHelper, 1, 'red')
  // useHelper(shadowCamera, CameraHelper)

  return (
    <>
      <directionalLight
        ref={lightRef}
        position={[10, 10, 10]}
        castShadow
        intensity={4}
        shadow-bias={-0.002}
        shadow-normalBias={0.3}
        shadow-mapSize={[1024, 1024]}
        shadow-radius={3}
        shadow-intensity={0.4}
      >
        <orthographicCamera
          ref={shadowCamera}
          attach="shadow-camera"
          near={1}
          far={100}
          left={-shadowCameraSize}
          right={shadowCameraSize}
          top={shadowCameraSize}
          bottom={-shadowCameraSize}
        />
      </directionalLight>

      <directionalLight
        position={[-10, 10, -10]}
        intensity={0.75}
      />

      <directionalLight
        position={[-10, 10, 10]}
        intensity={1}
      />

      <ambientLight intensity={0.5} 
        color='white' />
      {/* <Environment preset="sunset" environmentIntensity={0.4} /> */}
    </>
  )
}
