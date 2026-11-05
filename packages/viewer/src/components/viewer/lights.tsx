import { sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useMemo, useRef } from 'react'
import type {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
} from 'three/webgpu'
import * as THREE from 'three/webgpu'
import { isDaylightAtmosphere } from '../../lib/daylight/look'
import { getKeyLightDirectionOverride } from '../../lib/key-light-override'
import { SHADOW_ONLY_LAYER } from '../../lib/layers'
import { registerSkyLights } from '../../lib/underground-ambiance'
import useViewer, { groundVeiled } from '../../store/use-viewer'
import { useSceneAtmosphere } from './scene-atmosphere'
import { UndergroundAmbiance } from './underground-ambiance'

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

/**
 * The live counterpart of the interior capture's lighting: a light that shines from the eye along
 * the view, casting no shadow. Over a veiled ground the floor below grade still lies in the
 * shadow of the storeys above and has no sky: this keeps it from reading as a cave. The
 * underground ambiance owns its intensity (the veil's 1 at rest, brought up as the sky's light
 * comes down when the eye dives, back to rest in a capture); the hemisphere's ground side is
 * lifted in `Lights`.
 */
function UndergroundFill({ lightRef }: { lightRef: RefObject<DirectionalLight | null> }) {
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    const fill = lightRef.current
    if (!fill) return
    camera.getWorldPosition(fill.position)
    fill.target.position.copy(fill.position).add(camera.getWorldDirection(look))
    fill.target.updateMatrixWorld()
  })
  return <directionalLight intensity={0} ref={lightRef} />
}

export function Lights() {
  const theme = useViewer((state) => state.sceneAppearance)
  const shadows = useViewer((state) => state.shadows)
  const veiled = useViewer(groundVeiled)
  // The eye's fill is mounted once, and stays: adding or taking away a light changes every lit
  // material's shader (a runtime compile that lagged the switch to a basement), so it is there
  // from the moment the scene has a level below grade or the eye may dive (or a view first needs
  // it) and only its intensity, the ambiance's, moves.
  const wantsFill = useViewer(
    (state) =>
      state.hasLevelBelowGrade ||
      state.diveAvailable ||
      groundVeiled(state) ||
      state.ambianceActive,
  )
  const fillMounted = useRef(false)
  if (wantsFill) fillMounted.current = true
  const filled = fillMounted.current
  const atmosphere = useSceneAtmosphere()
  // The daylight look lights with one key (sun, or moon at night) and the sky environment only:
  // no moon slot, hemisphere or ambient light (each light costs every material's shader).
  const daylight = isDaylightAtmosphere(atmosphere)
  const lightSlots = useMemo(
    () =>
      Array.from(
        { length: daylight ? 1 : atmosphere ? 2 : theme.lights.length },
        (_, index) => index,
      ),
    [atmosphere, daylight, theme.lights.length],
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
  const fillRef = useRef<DirectionalLight>(null)
  // What the eye's fill shines at with no ambiance: the veil's own 1 over a veiled ground.
  const fillRest = useRef(0)
  fillRest.current = veiled ? 1 : 0

  // The underground ambiance moves the sky's own light and the eye's fill for the frame it draws.
  useEffect(
    () =>
      registerSkyLights(() => ({
        ambient: ambientRef.current,
        hemisphere: hemiRef.current,
        fill: fillRef.current,
        fillRest: fillRest.current,
      })),
    [],
  )

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
    const sourceShadow = atmosphere ? undefined : theme.lights[0]?.shadow
    const sourceCamera = sourceShadow?.camera
    // The daylight look: one key (sun or moon) with its own shadow settings, frustum fitted
    // tightly around the building in light space.
    const daylightShadow = isDaylightAtmosphere(atmosphere) ? atmosphere.shadow : undefined

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
    } else {
      for (const index of lightSlots) {
        const light = lightRefs.current[index]
        const config = theme.lights[index]
        if (!light || !config || (index === 0 && shadows && !sourceCamera)) continue
        light.position.set(...config.position)
        light.target.position.set(...(config.target ?? [0, 0, 0]))
        light.target.updateMatrixWorld()
      }
    }

    // Fit the single key-light shadow frustum to the BUILDING geometry rather
    // than the camera. The source controls its direction; only its distance and
    // frustum extents are derived here.
    if (shadows) {
      const now = state.clock.elapsedTime
      if (!sourceCamera && now - lastBoundsTime.current >= BOUNDS_REFRESH_INTERVAL) {
        lastBoundsTime.current = now
        const box = boundsBox.current.makeEmpty()
        for (const [id, obj] of sceneRegistry.nodes) {
          if (SHADOW_EXCLUDED_TYPES.some((type) => sceneRegistry.byType[type]!.has(id))) continue
          box.expandByObject(obj)
        }
        // Baked artifacts stay out of the registry: frame their shadow casters instead.
        if (box.isEmpty() && daylightShadow) expandByShadowCasters(state.scene, box)
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
        const size =
          shadowRadius.current * SHADOW_MARGIN_SCALE +
          Math.min(SHADOW_MARGIN, shadowRadius.current * 0.25)
        const distance = size + SHADOW_BACKOFF
        const near = SHADOW_BACKOFF
        // Receivers can lie beyond the caster's bounds, especially under a low sun.
        const far = distance + shadowRadius.current * SHADOW_MARGIN_SCALE + SHADOW_MARGIN
        const directionOverride = getKeyLightDirectionOverride()
        if (directionOverride) {
          shadowDir.current.set(...directionOverride)
        } else if (atmosphere) {
          shadowDir.current.copy(atmosphere.sunDirection)
        } else if (themeKey) {
          shadowDir.current.set(...themeKey.position)
          if (themeKey.target) {
            const [x, y, z] = themeKey.target
            shadowDir.current.x -= x
            shadowDir.current.y -= y
            shadowDir.current.z -= z
          }
        } else {
          shadowDir.current.set(0, 1, 0)
        }
        if (shadowDir.current.lengthSq() === 0) shadowDir.current.set(0, 1, 0)
        shadowDir.current.normalize().multiplyScalar(distance)
        if (!sourceCamera) {
          light.position.copy(focus).add(shadowDir.current)
          light.target.position.copy(focus)
          light.target.updateMatrixWorld()
        } else if (directionOverride && themeKey) {
          const [x, y, z] = themeKey.position
          const [tx, ty, tz] = themeKey.target ?? [0, 0, 0]
          shadowDir.current.normalize().multiplyScalar(Math.hypot(x - tx, y - ty, z - tz) || 1)
          light.position.set(tx, ty, tz).add(shadowDir.current)
        }

        const cam = light.shadow?.camera as THREE.OrthographicCamera | undefined
        if (cam && daylightShadow && !sourceCamera) {
          light.shadow.mapSize.setScalar(daylightShadow.mapSize)
          light.shadow.bias = daylightShadow.bias
          light.shadow.normalBias = daylightShadow.normalBias
          light.shadow.radius = daylightShadow.radius
          cam.layers.enable(SHADOW_ONLY_LAYER)
          fitShadowToBounds(light, boundsBox.current, shadowDir.current)
        } else if (cam) {
          // The calibrated building bias detaches furniture-scale contact shadows.
          // Small scenes need finer shadow edges too; retain the building map budget.
          const smallScene = !sourceCamera && shadowRadius.current < 1.5
          light.shadow.mapSize.setScalar(sourceShadow?.mapSize ?? (smallScene ? 2048 : 1024))
          light.shadow.bias = sourceShadow?.bias ?? SHADOW_DEPTH_BIAS
          light.shadow.radius = sourceShadow?.radius ?? 2
          light.shadow.normalBias =
            sourceShadow?.normalBias ??
            (smallScene
              ? Math.min(SHADOW_NORMAL_BIAS, (4 * size) / light.shadow.mapSize.x)
              : SHADOW_NORMAL_BIAS)
          cam.layers.enable(SHADOW_ONLY_LAYER)
          // A retained source frustum keeps distant context from diluting the building's shadows.
          cam.left = sourceCamera?.left ?? -size
          cam.right = sourceCamera?.right ?? size
          cam.top = sourceCamera?.top ?? size
          cam.bottom = sourceCamera?.bottom ?? -size
          cam.near = sourceCamera?.near ?? near
          cam.far = sourceCamera?.far ?? far
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
        const shadowIntensity = daylightShadow
          ? 1
          : (sourceShadow?.intensity ?? (intensity <= 1 ? intensity : MAX_SHADOW_INTENSITY))
        light.shadow.intensity =
          atmosphere || !initialized.current
            ? shadowIntensity
            : THREE.MathUtils.lerp(light.shadow.intensity, shadowIntensity, dt)
      }
    }

    const hemiIntensity = atmosphere ? atmosphere.hemisphereIntensity : theme.hemi?.intensity
    const hemiSky = atmosphere ? atmosphere.skyColor : theme.hemi?.sky
    // Over a veiled ground the floor is lit from below as from above, as in an interior capture.
    const hemiGround = veiled ? hemiSky : atmosphere ? atmosphere.groundColor : theme.hemi?.ground
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

      {!daylight && (atmosphere || theme.hemi) ? <hemisphereLight ref={hemiRef} /> : null}
      {daylight ? null : <ambientLight ref={ambientRef} />}
      {filled && <UndergroundFill lightRef={fillRef} />}
      <UndergroundAmbiance />
    </>
  )
}

const _fitCenter = new THREE.Vector3()
const _fitSize = new THREE.Vector3()
const _fitCorner = new THREE.Vector3()
const _fitBox = new THREE.Box3()
const _fitBounds = new THREE.Box3()
const _fitView = new THREE.Matrix4()
const _fitUp = new THREE.Vector3(0, 1, 0)
const _fitMargin = new THREE.Vector3(2, 0, 2)

/**
 * Daylight key: place the light on its direction around the building and fit the ortho shadow
 * camera to the building box (+2 m of ground) projected into light space — the tightest frustum,
 * so the map's texels all land on the building. Its depth reaches on to where the casters' shadows
 * meet the ground: a receiver beyond the far plane reads as fully lit, which cut long shadows off
 * square. A shadow keeps its caster's light-space x/y, so only the depth grows, not the texels.
 */
function fitShadowToBounds(
  light: THREE.DirectionalLight,
  bounds: THREE.Box3,
  direction: THREE.Vector3,
) {
  if (bounds.isEmpty()) return
  const center = bounds.getCenter(_fitCenter)
  const radius = bounds.getSize(_fitSize).length() / 2 + 2
  const toLight = _fitSize.copy(direction).normalize()
  light.position.copy(center).addScaledVector(toLight, radius * 2)
  light.target.position.copy(center)
  light.target.updateMatrixWorld()
  light.updateMatrixWorld()
  _fitView.lookAt(light.position, center, _fitUp).invert()
  _fitView.setPosition(0, 0, 0)
  const b = _fitBounds.copy(bounds).expandByVector(_fitMargin)
  const box = _fitBox.makeEmpty()
  // The ground under the casters (the site ground sits just below 0).
  const groundY = Math.min(bounds.min.y, -0.07)
  for (let i = 0; i < 8; i++) {
    const y = i & 2 ? b.max.y : b.min.y
    _fitCorner
      .set(i & 1 ? b.max.x : b.min.x, y, i & 4 ? b.max.z : b.min.z)
      .sub(light.position)
      .applyMatrix4(_fitView)
    box.expandByPoint(_fitCorner)
    // Down the light ray to the ground: same x/y in light space, only deeper.
    if (toLight.y > 0) box.min.z = Math.min(box.min.z, _fitCorner.z - (y - groundY) / toLight.y)
  }
  const cam = light.shadow.camera as THREE.OrthographicCamera
  cam.left = box.min.x - 0.5
  cam.right = box.max.x + 0.5
  cam.bottom = box.min.y - 0.5
  cam.top = box.max.y + 0.5
  cam.near = Math.max(0.1, -box.max.z - 1)
  cam.far = -box.min.z + 1
  cam.updateProjectionMatrix()
}

/** Shadow-casting meshes of a scene (skipping the effectively infinite grounds). */
function expandByShadowCasters(scene: THREE.Object3D, box: THREE.Box3) {
  const mesh = new THREE.Box3()
  scene.traverseVisible((object) => {
    const candidate = object as THREE.Mesh
    if (!candidate.isMesh || !candidate.castShadow) return
    mesh.setFromObject(candidate)
    if (mesh.isEmpty() || mesh.max.x - mesh.min.x > 500 || mesh.max.z - mesh.min.z > 500) return
    box.union(mesh)
  })
}
