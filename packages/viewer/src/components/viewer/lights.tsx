import { useRef } from 'react'
import type { DirectionalLight, OrthographicCamera } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

export function Lights() {
  const theme = useViewer((state) => state.theme)
  const isDark = theme === 'dark'

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
        intensity={isDark ? 0.8 : 4}
        color={isDark ? '#e0e5ff' : 'white'}
        shadow-bias={-0.002}
        shadow-normalBias={0.3}
        shadow-mapSize={[1024, 1024]}
        shadow-radius={3}
        shadow-intensity={isDark ? 0.8 : 0.4}
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
        intensity={isDark ? 0.2 : 0.75}
        color={isDark ? '#8090ff' : 'white'}
      />

      <directionalLight
        position={[-10, 10, 10]}
        intensity={isDark ? 0.3 : 1}
        color={isDark ? '#a0b0ff' : 'white'}
      />

      <ambientLight 
        intensity={isDark ? 0.15 : 0.5} 
        color={isDark ? '#a0b0ff' : 'white'} 
      />
      {/* <Environment preset="sunset" environmentIntensity={0.4} /> */}
    </>
  )
}
