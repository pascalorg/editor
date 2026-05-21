import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
} from 'three/webgpu'
import * as THREE from 'three/webgpu'
import useViewer from '../../store/use-viewer'

// Diagnostic toggle: `?disable=shadows` skips the shadow-map render pass
// (which doubles draw calls for every shadow-casting mesh) so you can
// isolate how much of the baseline GPU cost is shadows vs. raw geometry.
const SHADOWS_DISABLED =
  typeof window !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search).get('disable') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('shadows')

// Rig: one shadow-casting key + one cool fill + a hemisphere sky/ground fill
// + a low ambient floor. The hemisphere replaces the second fill directional
// the rig used to carry, so volumes still read on the shadow side at one fewer
// per-fragment directional light term.
export function Lights() {
  const theme = useViewer((state) => state.theme)
  const isDark = theme === 'dark'

  const light1Ref = useRef<DirectionalLight>(null)
  const shadowCamera = useRef<OrthographicCamera>(null)
  const shadowCameraSize = 50 // The "area" around the camera to shadow

  const light2Ref = useRef<DirectionalLight>(null)
  const hemiRef = useRef<HemisphereLight>(null)
  const ambientRef = useRef<AmbientLight>(null)

  const initialized = useRef(false)

  const targets = useMemo(
    () => ({
      l1Color: new THREE.Color(),
      l2Color: new THREE.Color(),
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      ambColor: new THREE.Color(),
    }),
    [],
  )

  useFrame((_, delta) => {
    // clamp delta to avoid huge jumps on tab switch
    const dt = Math.min(delta, 0.1) * 4

    if (!initialized.current) {
      if (light1Ref.current) {
        light1Ref.current.intensity = isDark ? 0.8 : 4
        light1Ref.current.color.set(isDark ? '#e0e5ff' : '#ffffff')

        if (light1Ref.current.shadow) light1Ref.current.shadow.intensity = isDark ? 0.8 : 0.4
      }
      if (light2Ref.current) {
        light2Ref.current.intensity = isDark ? 0.2 : 0.75
        light2Ref.current.color.set(isDark ? '#8090ff' : '#ffffff')
      }
      if (hemiRef.current) {
        hemiRef.current.intensity = isDark ? 0.35 : 0.5
        hemiRef.current.color.set(isDark ? '#3a4666' : '#ffffff')
        hemiRef.current.groundColor.set(isDark ? '#0e111c' : '#d8d6cf')
      }
      if (ambientRef.current) {
        ambientRef.current.intensity = isDark ? 0.1 : 0.25
        ambientRef.current.color.set(isDark ? '#a0b0ff' : '#ffffff')
      }
      initialized.current = true
      return
    }

    if (light1Ref.current) {
      light1Ref.current.intensity = THREE.MathUtils.lerp(
        light1Ref.current.intensity,
        isDark ? 0.8 : 4,
        dt,
      )
      targets.l1Color.set(isDark ? '#e0e5ff' : '#ffffff')
      light1Ref.current.color.lerp(targets.l1Color, dt)

      if (light1Ref.current.shadow) {
        if (light1Ref.current.shadow.intensity !== undefined) {
          light1Ref.current.shadow.intensity = THREE.MathUtils.lerp(
            light1Ref.current.shadow.intensity,
            isDark ? 0.8 : 0.4,
            dt,
          )
        }
      }
    }

    if (light2Ref.current) {
      light2Ref.current.intensity = THREE.MathUtils.lerp(
        light2Ref.current.intensity,
        isDark ? 0.2 : 0.75,
        dt,
      )
      targets.l2Color.set(isDark ? '#8090ff' : '#ffffff')
      light2Ref.current.color.lerp(targets.l2Color, dt)
    }

    if (hemiRef.current) {
      hemiRef.current.intensity = THREE.MathUtils.lerp(
        hemiRef.current.intensity,
        isDark ? 0.35 : 0.5,
        dt,
      )
      targets.hemiSky.set(isDark ? '#3a4666' : '#ffffff')
      hemiRef.current.color.lerp(targets.hemiSky, dt)
      targets.hemiGround.set(isDark ? '#0e111c' : '#d8d6cf')
      hemiRef.current.groundColor.lerp(targets.hemiGround, dt)
    }

    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(
        ambientRef.current.intensity,
        isDark ? 0.1 : 0.25,
        dt,
      )
      targets.ambColor.set(isDark ? '#a0b0ff' : '#ffffff')
      ambientRef.current.color.lerp(targets.ambColor, dt)
    }
  })

  return (
    <>
      <directionalLight
        castShadow={!SHADOWS_DISABLED}
        position={[10, 10, 10]}
        ref={light1Ref}
        shadow-bias={-0.002}
        shadow-mapSize={[1024, 1024]}
        shadow-normalBias={0.3}
        shadow-radius={2}
      >
        {SHADOWS_DISABLED ? null : (
          <orthographicCamera
            attach="shadow-camera"
            bottom={-shadowCameraSize}
            far={100}
            left={-shadowCameraSize}
            near={1}
            ref={shadowCamera}
            right={shadowCameraSize}
            top={shadowCameraSize}
          />
        )}
      </directionalLight>

      <directionalLight position={[-10, 10, -10]} ref={light2Ref} />

      <hemisphereLight ref={hemiRef} />

      <ambientLight ref={ambientRef} />
    </>
  )
}
