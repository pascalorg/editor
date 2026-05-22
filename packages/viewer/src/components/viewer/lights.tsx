import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
} from 'three/webgpu'
import * as THREE from 'three/webgpu'
import { getSceneTheme } from '../../lib/scene-themes'
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

// Shadow darkness for the bright key lights (themes drive most lights past
// intensity 1). The aesthetic prototype runs these near-black (≈1.0); this is a
// deliberate middle ground — present, but not the heavy contact shadow there.
const MAX_SHADOW_INTENSITY = 0.55

export function Lights() {
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const theme = getSceneTheme(sceneTheme)
  const shadows = useViewer((state) => state.shadows)

  const lightRefs = useRef<Array<DirectionalLight | null>>([])
  const shadowCamera = useRef<OrthographicCamera>(null)
  const shadowCameraSize = 50 // The "area" around the camera to shadow

  // Where the shadow frustum is centred each frame. The directional light's
  // ortho shadow camera only covers ±shadowCameraSize around the light target,
  // so it has to track the view or anything far from origin gets no shadows.
  const shadowFocus = useRef(new THREE.Vector3())

  const hemiRef = useRef<HemisphereLight>(null)
  const ambientRef = useRef<AmbientLight>(null)

  const initialized = useRef(false)
  const lightTargets = useRef<THREE.Color[]>([])

  const targets = useMemo(
    () => ({
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      ambColor: new THREE.Color(),
    }),
    [],
  )

  useFrame((state, delta) => {
    // clamp delta to avoid huge jumps on tab switch
    const dt = Math.min(delta, 0.1) * 4

    // Recentre each shadow-casting light's frustum on what the viewer is looking
    // at (orbit target if available, else the camera's ground projection), moving
    // the light and its target together so the light DIRECTION is preserved and
    // only the shadow camera slides. Without this the frustum stays at the origin
    // and zones far from it never receive shadows.
    if (shadows) {
      const focus = shadowFocus.current
      const controls = state.controls as { getTarget?: (out: THREE.Vector3) => void } | null
      if (controls?.getTarget) {
        controls.getTarget(focus)
      } else {
        focus.set(state.camera.position.x, 0, state.camera.position.z)
      }
      for (let index = 0; index < theme.lights.length; index++) {
        const config = theme.lights[index]
        const light = lightRefs.current[index]
        if (!(config?.castShadow && light)) continue
        const [ox, oy, oz] = config.position
        light.position.set(focus.x + ox, focus.y + oy, focus.z + oz)
        light.target.position.copy(focus)
        light.target.updateMatrixWorld()
      }
    }

    if (!initialized.current) {
      for (let index = 0; index < theme.lights.length; index++) {
        const config = theme.lights[index]
        const light = lightRefs.current[index]
        if (!(config && light)) continue
        light.intensity = config.intensity
        light.color.set(config.color)

        if (config.castShadow && light.shadow) {
          light.shadow.intensity = config.intensity <= 1 ? config.intensity : MAX_SHADOW_INTENSITY
        }
      }
      if (hemiRef.current && theme.hemi) {
        hemiRef.current.intensity = theme.hemi.intensity
        hemiRef.current.color.set(theme.hemi.sky)
        hemiRef.current.groundColor.set(theme.hemi.ground)
      }
      if (ambientRef.current) {
        ambientRef.current.intensity = theme.ambient.intensity
        ambientRef.current.color.set(theme.ambient.color)
      }
      initialized.current = true
      return
    }

    for (let index = 0; index < theme.lights.length; index++) {
      const config = theme.lights[index]
      const light = lightRefs.current[index]
      if (!(config && light)) continue

      light.intensity = THREE.MathUtils.lerp(light.intensity, config.intensity, dt)
      let target = lightTargets.current[index]
      if (!target) {
        target = new THREE.Color()
        lightTargets.current[index] = target
      }
      target.set(config.color)
      light.color.lerp(target, dt)

      if (config.castShadow && light.shadow) {
        if (light.shadow.intensity !== undefined) {
          light.shadow.intensity = THREE.MathUtils.lerp(
            light.shadow.intensity,
            config.intensity <= 1 ? config.intensity : MAX_SHADOW_INTENSITY,
            dt,
          )
        }
      }
    }

    if (hemiRef.current && theme.hemi) {
      hemiRef.current.intensity = THREE.MathUtils.lerp(
        hemiRef.current.intensity,
        theme.hemi.intensity,
        dt,
      )
      targets.hemiSky.set(theme.hemi.sky)
      hemiRef.current.color.lerp(targets.hemiSky, dt)
      targets.hemiGround.set(theme.hemi.ground)
      hemiRef.current.groundColor.lerp(targets.hemiGround, dt)
    }

    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(
        ambientRef.current.intensity,
        theme.ambient.intensity,
        dt,
      )
      targets.ambColor.set(theme.ambient.color)
      ambientRef.current.color.lerp(targets.ambColor, dt)
    }
  })

  return (
    <>
      {theme.lights.map((light, index) => (
        <directionalLight
          castShadow={Boolean(light.castShadow) && !SHADOWS_DISABLED && shadows}
          key={`${index}-${light.position.join(',')}`}
          position={light.position}
          ref={(ref) => {
            lightRefs.current[index] = ref
          }}
          shadow-bias={-0.002}
          shadow-mapSize={[1024, 1024]}
          shadow-normalBias={0.3}
          shadow-radius={1.5}
        >
          {light.castShadow && !SHADOWS_DISABLED && shadows ? (
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
          ) : null}
        </directionalLight>
      ))}

      {theme.hemi ? <hemisphereLight ref={hemiRef} /> : null}

      <ambientLight ref={ambientRef} />
    </>
  )
}
