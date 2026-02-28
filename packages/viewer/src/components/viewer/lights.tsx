import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { DirectionalLight, OrthographicCamera, AmbientLight } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

export function Lights() {
  const theme = useViewer((state) => state.theme)
  const isDark = theme === 'dark'

  const light1Ref = useRef<DirectionalLight>(null)
  const shadowCamera = useRef<OrthographicCamera>(null)
  const shadowCameraSize = 50 // The "area" around the camera to shadow

  const light2Ref = useRef<DirectionalLight>(null)
  const light3Ref = useRef<DirectionalLight>(null)
  const ambientRef = useRef<AmbientLight>(null)

  const initialized = useRef(false)
  
  const targets = useMemo(() => ({
    l1Color: new THREE.Color(),
    l2Color: new THREE.Color(),
    l3Color: new THREE.Color(),
    ambColor: new THREE.Color(),
  }), [])

  useFrame((_, delta) => {
    // clamp delta to avoid huge jumps on tab switch
    const dt = Math.min(delta, 0.1) * 4

    if (!initialized.current) {
      if (light1Ref.current) {
        light1Ref.current.intensity = isDark ? 0.8 : 4
        light1Ref.current.color.set(isDark ? '#e0e5ff' : '#ffffff')
        // @ts-ignore
        if (light1Ref.current.shadow) light1Ref.current.shadow.intensity = isDark ? 0.8 : 0.4
      }
      if (light2Ref.current) {
        light2Ref.current.intensity = isDark ? 0.2 : 0.75
        light2Ref.current.color.set(isDark ? '#8090ff' : '#ffffff')
      }
      if (light3Ref.current) {
        light3Ref.current.intensity = isDark ? 0.3 : 1
        light3Ref.current.color.set(isDark ? '#a0b0ff' : '#ffffff')
      }
      if (ambientRef.current) {
        ambientRef.current.intensity = isDark ? 0.15 : 0.5
        ambientRef.current.color.set(isDark ? '#a0b0ff' : '#ffffff')
      }
      initialized.current = true
      return
    }

    if (light1Ref.current) {
      light1Ref.current.intensity = THREE.MathUtils.lerp(light1Ref.current.intensity, isDark ? 0.8 : 4, dt)
      targets.l1Color.set(isDark ? '#e0e5ff' : '#ffffff')
      light1Ref.current.color.lerp(targets.l1Color, dt)
      
      if (light1Ref.current.shadow) {
        // @ts-ignore
        if (light1Ref.current.shadow.intensity !== undefined) {
          // @ts-ignore
          light1Ref.current.shadow.intensity = THREE.MathUtils.lerp(light1Ref.current.shadow.intensity, isDark ? 0.8 : 0.4, dt)
        }
      }
    }

    if (light2Ref.current) {
      light2Ref.current.intensity = THREE.MathUtils.lerp(light2Ref.current.intensity, isDark ? 0.2 : 0.75, dt)
      targets.l2Color.set(isDark ? '#8090ff' : '#ffffff')
      light2Ref.current.color.lerp(targets.l2Color, dt)
    }

    if (light3Ref.current) {
      light3Ref.current.intensity = THREE.MathUtils.lerp(light3Ref.current.intensity, isDark ? 0.3 : 1, dt)
      targets.l3Color.set(isDark ? '#a0b0ff' : '#ffffff')
      light3Ref.current.color.lerp(targets.l3Color, dt)
    }

    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(ambientRef.current.intensity, isDark ? 0.15 : 0.5, dt)
      targets.ambColor.set(isDark ? '#a0b0ff' : '#ffffff')
      ambientRef.current.color.lerp(targets.ambColor, dt)
    }
  })

  return (
    <>
      <directionalLight
        ref={light1Ref}
        position={[10, 10, 10]}
        castShadow
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

      <directionalLight
        ref={light2Ref}
        position={[-10, 10, -10]}
      />

      <directionalLight
        ref={light3Ref}
        position={[-10, 10, 10]}
      />

      <ambientLight ref={ambientRef} />
    </>
  )
}
