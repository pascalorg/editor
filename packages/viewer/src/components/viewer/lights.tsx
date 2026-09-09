import { sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
} from 'three/webgpu'
import * as THREE from 'three/webgpu'
import { SHADOW_ONLY_LAYER } from '../../lib/layers'
import { getSceneTheme } from '../../lib/scene-themes'
import useViewer from '../../store/use-viewer'
import { useSceneAtmosphere } from './scene-atmosphere'

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

// Diagnostic toggle: `?debug=shadowcamera` draws a CameraHelper for each
// shadow camera so the building-fit frustum (and thus shadow texel density)
// can be inspected while tuning margins/bias.
const SHADOW_CAMERA_DEBUG =
  typeof window !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search).get('debug') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('shadowcamera')

// Shadow darkness for the bright key lights (themes drive most lights past
// intensity 1). Runs high so shadowed areas actually lose the sun's
// contribution — the ambient/hemisphere/IBL stack provides the fill. The old
// 0.55 clamp leaked 45% of the key light into shadow and flattened interiors;
// 0.9 read too heavy in review.
const MAX_SHADOW_INTENSITY = 0.75

// `normalBias` is measured in world units. The previous 0.3 moved shadow
// lookups 30 cm off their surfaces, visibly detaching wall shadows at the
// floor; 0.07 and below still acnes on the building-fit 1024 map (large
// texels), so 0.08 is the smallest acne-free value at that resolution — even
// with the depth bias at -0.0005 (which is itself needed: 0.08 alone still
// showed faint acne at -0.0001).
const SHADOW_DEPTH_BIAS = -0.0005
const SHADOW_NORMAL_BIAS = 0.08

// Shadow frustum framing. The frustum is fit to the BUILDING geometry (not the
// camera): we union the bounds of all registered scene nodes, fit a sphere, and
// size the directional light's ortho shadow camera to that sphere plus a margin.
// This keeps shadows anchored to the building and a bit of surrounding ground no
// matter how the user zooms or pans — fixing the previous camera-following
// behaviour that fell apart when zoomed out (frustum too small) or zoomed into
// an empty corner (frustum centred on nothing).
//
// `site` nodes (the ground/site plane, which can be arbitrarily large) are
// excluded so they don't blow the frustum up to cover the whole lot.
const SHADOW_EXCLUDED_TYPES = ['site'] as const
// How often (seconds) to recompute building bounds. Bounds only change while
// editing, so we throttle the (subtree-walking) union instead of doing it every
// frame.
const BOUNDS_REFRESH_INTERVAL = 0.4
// Extra coverage around the building bounds — the "and a bit nearby" margin so
// shadows don't get clipped right at the walls. Scales with building size.
const SHADOW_MARGIN_SCALE = 1.15
const SHADOW_MARGIN = 3
// Gap between the building bounds sphere and the light / near plane.
const SHADOW_BACKOFF = 10
// Fallback radius when the scene has no building geometry yet (empty scene).
const SHADOW_FALLBACK_RADIUS = 30

export function Lights() {
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const theme = getSceneTheme(sceneTheme)
  const shadows = useViewer((state) => state.shadows)
  const atmosphere = useSceneAtmosphere()
  const lightSlots = useMemo(
    () => Array.from({ length: atmosphere ? 2 : theme.lights.length }, (_, index) => index),
    [atmosphere, theme.lights.length],
  )

  const lightRefs = useRef<Array<DirectionalLight | null>>([])
  const shadowCamera = useRef<OrthographicCamera>(null)
  // Initial ortho half-size; overridden each refresh to fit the building.
  const shadowCameraSize = 50

  // Building bounds the shadow frustum is fit to, recomputed on an interval.
  const shadowFocus = useRef(new THREE.Vector3()) // sphere centre
  const shadowRadius = useRef(SHADOW_FALLBACK_RADIUS) // sphere radius
  const shadowDir = useRef(new THREE.Vector3()) // scratch: key-light direction
  const boundsBox = useRef(new THREE.Box3()) // scratch: union AABB
  const boundsSphere = useRef(new THREE.Sphere()) // scratch: fitted sphere
  const lastBoundsTime = useRef(-1) // last refresh timestamp (-1 = never)
  const shadowHelpers = useRef<Array<THREE.CameraHelper | null>>([])

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
    // Clamp delta to avoid huge jumps on tab switch.
    const dt = Math.min(delta, 0.1) * 4

    // Atmosphere directions are stable mutable vectors. Keep both light
    // resources mounted and move them imperatively so time/angle changes never
    // rebuild materials or shadow resources.
    if (atmosphere) {
      for (let index = 0; index < 2; index++) {
        const light = lightRefs.current[index]
        if (!light) continue
        const direction = index === 0 ? atmosphere.sunDirection : atmosphere.moonDirection
        light.position.copy(direction).multiplyScalar(100)
        light.target.position.set(0, 0, 0)
        light.target.updateMatrixWorld()
      }
    }

    // Fit the single key-light shadow frustum to the BUILDING geometry rather
    // than the camera. The source controls its direction; only its distance and
    // frustum extents are derived here.
    if (shadows) {
      const now = state.clock.elapsedTime
      if (now - lastBoundsTime.current >= BOUNDS_REFRESH_INTERVAL) {
        lastBoundsTime.current = now
        const box = boundsBox.current.makeEmpty()
        for (const [id, obj] of sceneRegistry.nodes) {
          if (SHADOW_EXCLUDED_TYPES.some((type) => sceneRegistry.byType[type]!.has(id))) continue
          box.expandByObject(obj)
        }
        box.getBoundingSphere(boundsSphere.current)
        const center = boundsSphere.current.center
        const radius = boundsSphere.current.radius
        const finiteBounds =
          !box.isEmpty() &&
          Number.isFinite(center.x) &&
          Number.isFinite(center.y) &&
          Number.isFinite(center.z) &&
          Number.isFinite(radius)
        if (finiteBounds) {
          shadowFocus.current.copy(center)
          shadowRadius.current = radius
        } else {
          shadowFocus.current.set(0, 0, 0)
          shadowRadius.current = SHADOW_FALLBACK_RADIUS
        }
      }

      const light = lightRefs.current[0]
      const themeKey = theme.lights[0]
      const castsShadow = atmosphere ? true : Boolean(themeKey?.castShadow)
      if (light && castsShadow) {
        const focus = shadowFocus.current
        const size = shadowRadius.current * SHADOW_MARGIN_SCALE + SHADOW_MARGIN
        const distance = size + SHADOW_BACKOFF
        const near = SHADOW_BACKOFF
        const far = distance + size
        if (atmosphere) {
          shadowDir.current.copy(atmosphere.sunDirection)
        } else if (themeKey) {
          shadowDir.current.set(...themeKey.position)
        } else {
          shadowDir.current.set(0, 1, 0)
        }
        if (shadowDir.current.lengthSq() === 0) shadowDir.current.set(0, 1, 0)
        shadowDir.current.normalize().multiplyScalar(distance)
        light.position.copy(focus).add(shadowDir.current)
        light.target.position.copy(focus)
        light.target.updateMatrixWorld()

        const cam = light.shadow?.camera as THREE.OrthographicCamera | undefined
        if (cam) {
          cam.layers.enable(SHADOW_ONLY_LAYER)
          cam.left = -size
          cam.right = size
          cam.top = size
          cam.bottom = -size
          cam.near = near
          cam.far = far
          cam.updateProjectionMatrix()
          if (SHADOW_CAMERA_DEBUG) {
            let helper = shadowHelpers.current[0]
            if (!helper) {
              helper = new THREE.CameraHelper(cam)
              shadowHelpers.current[0] = helper
              state.scene.add(helper)
            }
            helper.update()
          }
        }
      }
    }

    for (const index of lightSlots) {
      const light = lightRefs.current[index]
      if (!light) continue
      const config = theme.lights[index]
      const intensity = atmosphere
        ? index === 0
          ? atmosphere.sunIntensity
          : atmosphere.moonIntensity
        : (config?.intensity ?? 0)
      const color = atmosphere
        ? index === 0
          ? atmosphere.sunColor
          : atmosphere.moonColor
        : config?.color

      if (atmosphere || !initialized.current) {
        light.intensity = intensity
        if (color) light.color.set(color)
      } else {
        light.intensity = THREE.MathUtils.lerp(light.intensity, intensity, dt)
        let target = lightTargets.current[index]
        if (!target) {
          target = new THREE.Color()
          lightTargets.current[index] = target
        }
        if (color) target.set(color)
        light.color.lerp(target, dt)
      }

      if (index === 0 && light.shadow?.intensity !== undefined) {
        const shadowIntensity = intensity <= 1 ? intensity : MAX_SHADOW_INTENSITY
        light.shadow.intensity =
          atmosphere || !initialized.current
            ? shadowIntensity
            : THREE.MathUtils.lerp(light.shadow.intensity, shadowIntensity, dt)
      }
    }

    const hemiIntensity = atmosphere ? atmosphere.hemisphereIntensity : theme.hemi?.intensity
    const hemiSky = atmosphere ? atmosphere.skyColor : theme.hemi?.sky
    const hemiGround = atmosphere ? atmosphere.groundColor : theme.hemi?.ground
    if (hemiRef.current && hemiIntensity !== undefined && hemiSky && hemiGround) {
      if (atmosphere || !initialized.current) {
        hemiRef.current.intensity = hemiIntensity
        hemiRef.current.color.set(hemiSky)
        hemiRef.current.groundColor.set(hemiGround)
      } else {
        hemiRef.current.intensity = THREE.MathUtils.lerp(
          hemiRef.current.intensity,
          hemiIntensity,
          dt,
        )
        targets.hemiSky.set(hemiSky)
        hemiRef.current.color.lerp(targets.hemiSky, dt)
        targets.hemiGround.set(hemiGround)
        hemiRef.current.groundColor.lerp(targets.hemiGround, dt)
      }
    }

    if (ambientRef.current) {
      const ambientIntensity = atmosphere ? atmosphere.ambientIntensity : theme.ambient.intensity
      const ambientColor = atmosphere ? '#ffffff' : theme.ambient.color
      if (atmosphere || !initialized.current) {
        ambientRef.current.intensity = ambientIntensity
        ambientRef.current.color.set(ambientColor)
      } else {
        ambientRef.current.intensity = THREE.MathUtils.lerp(
          ambientRef.current.intensity,
          ambientIntensity,
          dt,
        )
        targets.ambColor.set(ambientColor)
        ambientRef.current.color.lerp(targets.ambColor, dt)
      }
    }

    initialized.current = true
  }, -1)

  const keyCastsShadow =
    !SHADOWS_DISABLED && (atmosphere ? true : Boolean(theme.lights[0]?.castShadow))

  return (
    <>
      {lightSlots.map((index) => {
        const themeLight = theme.lights[index]
        const direction =
          atmosphere && index === 0
            ? atmosphere.sunDirection
            : atmosphere && index === 1
              ? atmosphere.moonDirection
              : null
        return (
          <directionalLight
            castShadow={index === 0 && keyCastsShadow}
            key={index}
            position={
              direction
                ? [direction.x * 100, direction.y * 100, direction.z * 100]
                : (themeLight?.position ?? [0, 1, 0])
            }
            ref={(light) => {
              lightRefs.current[index] = light
            }}
            shadow-bias={SHADOW_DEPTH_BIAS}
            shadow-mapSize={[1024, 1024]}
            shadow-normalBias={SHADOW_NORMAL_BIAS}
            shadow-radius={2}
          >
            {index === 0 && keyCastsShadow ? (
              <orthographicCamera
                attach="shadow-camera"
                bottom={-shadowCameraSize}
                far={400}
                left={-shadowCameraSize}
                near={1}
                ref={shadowCamera}
                right={shadowCameraSize}
                top={shadowCameraSize}
              />
            ) : null}
          </directionalLight>
        )
      })}

      {atmosphere || theme.hemi ? <hemisphereLight ref={hemiRef} /> : null}
      <ambientLight ref={ambientRef} />
    </>
  )
}
