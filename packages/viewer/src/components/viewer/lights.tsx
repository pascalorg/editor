import { Environment } from '@react-three/drei'
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
      intensity={1}
      shadow-bias={-0.002}
      shadow-normalBias={0.3}
      shadow-mapSize={[1024, 1024]}
      shadow-radius={3}
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

          <ambientLight intensity={0.2} />
          <Environment preset="sunset" environmentIntensity={0.4} />
    </>
  )
}
