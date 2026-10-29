'use client'

import type { LightSpot } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  float,
  instancedDynamicBufferAttribute,
  mrt,
  output,
  smoothstep,
  uv,
  vec4,
} from 'three/tsl'
import {
  AdditiveBlending,
  type Camera,
  Color,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  MathUtils,
  Matrix4,
  type Object3D,
  type PointLight,
  Sphere,
  type SpotLight,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from 'three/webgpu'
import { useSceneAtmosphere } from '../../components/viewer/scene-atmosphere'
import useViewer from '../../store/use-viewer'

/** A light an item holds, as the pools drive it. */
export type PooledLight = {
  key: string
  color: string
  distance: number
  spot?: LightSpot
  shadows?: boolean
  // A saved scene is not parsed on load, so a glow may come without its default strength.
  glow?: { size: number; strength?: number }
  /** Its fully-on intensity, so its glow dims with it. */
  peak?: number
  /** Where it shines from; false while its object is not mounted. */
  getWorldPosition: (out: Vector3) => boolean
  /** Its spot's aim in world space, turned with its item. */
  getWorldDirection?: (out: Vector3) => void
}

type Props<T extends PooledLight> = {
  getLights: () => Iterable<T>
  /**
   * 0 while it cannot be seen lit (off, hidden, on a hidden level); otherwise a factor on what it
   * adds to the view (a light on another storey than the one being edited counts for less).
   */
  weight: (light: T) => number
  /** What it shines at now: 0 while off or not drawn. */
  intensity: (light: T) => number
}

/**
 * Unshadowed pool lights only lengthen the shaders' light loop (no pass, and no recompile while
 * the count holds); a shadow slot adds a depth render each frame, so those stay few. Touch
 * devices get smaller pools.
 */
function poolSizes() {
  const touch =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  return touch ? { point: 6, spot: 6, shadow: 2 } : { point: 16, spot: 16, shadow: 2 }
}

// A point light's shadow is six renders and a spot's one, so spots win the shadow slots.
const POINT_SHADOW_FACTOR = 0.25
const GLOW_CAPACITY = 256
// How bright a glow stays in full daylight, against 1 at night.
const DAYLIGHT_GLOW = 0.08
// Strength 1 is a lamp's plain halo at night, read against tone-mapped light colours.
const GLOW_GAIN = 3
// Where a light with no distance of its own stops counting: intensity / d² under this.
const REACH_CUTOFF = 0.01
// Nearer than this (metres squared) a light counts as this near, so one at the eye cannot win alone.
const MIN_DISTANCE_SQ = 0.25

// How often (in seconds) to re-evaluate which lights hold slots (fallback timer)
const REASSIGN_INTERVAL = 0.2
// A held slot keeps its key unless a newcomer adds this much more (no flicker at the boundary).
const HYSTERESIS = 0.15
// Camera movement that triggers an early re-evaluation
const CAM_MOVE_DIST = 0.5
const CAM_ROT_DOT = 0.995

type Slot = { key: string | null; pendingKey: string | null; isFadingOut: boolean }
type Candidate = { key: string; priority: number }

const slotsOf = (size: number): Slot[] =>
  Array.from({ length: size }, () => ({ key: null, pendingKey: null, isFadingOut: false }))

const _sphere = new Sphere()
const _frustum = new Frustum()
const _viewProjection = new Matrix4()

/** The frustum `camera` sees, for a capture camera that never rendered as well as the live one. */
function frustumOf(camera: Camera): Frustum {
  camera.updateMatrixWorld()
  _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  return _frustum.setFromProjectionMatrix(
    _viewProjection,
    camera.coordinateSystem,
    camera.reversedDepth,
  )
}

/**
 * Roughly what a light adds to a view: its intensity over its squared distance from the eye, or 0
 * when its reach (its distance, else where it falls under REACH_CUTOFF) misses the view.
 */
export function lightContribution(
  position: Vector3,
  intensity: number,
  distance: number,
  eye: Vector3,
  frustum: Frustum,
): number {
  if (intensity <= 0) return 0
  const reach = distance > 0 ? distance : Math.sqrt(intensity / REACH_CUTOFF)
  if (!frustum.intersectsSphere(_sphere.set(position, reach))) return 0
  return intensity / Math.max(position.distanceToSquared(eye), MIN_DISTANCE_SQ)
}

/**
 * Gives the wanted keys (most first) the pool's slots: a key that holds a slot keeps it, and a
 * newcomer evicts a key no longer wanted only on a clear win. A slot changing hands fades out
 * first; an idle slot takes its key at once.
 */
export function assignSlots(
  slots: Slot[],
  wanted: Candidate[],
  priorityByKey: Map<string, number>,
) {
  const desired = wanted.map((candidate) => candidate.key)
  const held = new Map<string, number>()
  slots.forEach((slot, i) => {
    const key = slot.key ?? slot.pendingKey
    if (key) held.set(key, i)
  })
  const used = new Set<number>()
  const assigned = new Set<string>()
  for (const key of desired) {
    const index = held.get(key)
    if (index !== undefined && !used.has(index)) {
      used.add(index)
      assigned.add(key)
    }
  }
  let free = 0
  for (const key of desired) {
    if (assigned.has(key)) continue
    while (free < slots.length && used.has(free)) free++
    if (free >= slots.length) break
    const slot = slots[free]!
    const current = slot.key ?? slot.pendingKey
    if (current && !desired.includes(current)) {
      const currentPriority = priorityByKey.get(current) ?? 0
      if ((priorityByKey.get(key) ?? 0) < currentPriority * (1 + HYSTERESIS)) {
        free++
        continue
      }
    }
    used.add(free)
    assigned.add(key)
    if (slot.key !== key) {
      slot.pendingKey = key
      slot.isFadingOut = slot.key !== null
      if (!slot.isFadingOut) {
        slot.key = key
        slot.pendingKey = null
      }
    }
    free++
  }
  slots.forEach((slot, i) => {
    if (!used.has(i) && slot.key && !desired.includes(slot.key)) {
      slot.pendingKey = null
      slot.isFadingOut = true
    }
  })
}

/** A pool handed over at once, for a picture: no fades, each slot on the key it is going to. */
function settle(slots: Slot[]) {
  for (const slot of slots) {
    if (slot.isFadingOut) slot.key = slot.pendingKey
    slot.pendingKey = null
    slot.isFadingOut = false
  }
}

/** How much a glow shows: 1 at night, nearly nothing in daylight. */
export function glowDarkness(sunDirection: Vector3 | null, appearance: 'light' | 'dark'): number {
  if (!sunDirection) return appearance === 'dark' ? 1 : DAYLIGHT_GLOW
  const elevation = sunDirection.y / (sunDirection.length() || 1)
  return MathUtils.lerp(1, DAYLIGHT_GLOW, MathUtils.smoothstep(elevation, -0.05, 0.3))
}

const _pos = new Vector3()
const _dir = new Vector3()
const _camPos = new Vector3()
const _camFwd = new Vector3()
const _color = new Color()

function place(light: PointLight | SpotLight, source: PooledLight) {
  light.color.set(source.color)
  light.distance = source.distance
  if (source.getWorldPosition(_pos)) light.position.copy(_pos)
  const spot = light as SpotLight
  if (!spot.isSpotLight) return
  spot.angle = Math.min(Math.PI / 2, MathUtils.degToRad((source.spot?.angle ?? 60) / 2))
  spot.penumbra = source.spot?.softness ?? 0
  if (source.getWorldDirection) source.getWorldDirection(_dir)
  else _dir.set(0, -1, 0)
  spot.target.position.copy(spot.position).add(_dir)
  spot.target.updateMatrixWorld()
}

const fade = (light: PointLight | SpotLight, to: number, dt: number) => {
  light.intensity = MathUtils.lerp(light.intensity, to, Math.min(1, dt * 12))
  if (to <= 0 && light.intensity < 0.01) light.intensity = 0
}

/**
 * Drives a pool's slots for a frame. A slot's lights are its point light and, in the shadow
 * pool, a spot beside it: the one matching its source shines, the other rests dark with its
 * shadow map frozen.
 */
function drivePool<T extends PooledLight>(
  slots: Slot[],
  lights: Array<Array<PointLight | SpotLight | null>>,
  byKey: Map<string, T>,
  intensity: (light: T) => number,
  dt: number,
) {
  // dt Infinity: every light straight to its target, for a picture.
  slots.forEach((slot, i) => {
    const pair = lights[i]
    if (!pair?.every(Boolean)) return
    const members = pair as Array<PointLight | SpotLight>
    if (slot.isFadingOut) {
      for (const light of members) fade(light, 0, dt)
      if (members.every((light) => light.intensity === 0)) {
        slot.isFadingOut = false
        slot.key = slot.pendingKey
        slot.pendingKey = null
      }
      return
    }
    const source = slot.key ? byKey.get(slot.key) : undefined
    if (!source) slot.key = null
    const active = source
      ? (members.find((light) => Boolean((light as SpotLight).isSpotLight) === !!source.spot) ??
        members[0]!)
      : null
    for (const light of members) {
      if (light !== active || !source) {
        fade(light, 0, dt)
        if (light.castShadow) light.shadow.autoUpdate = light.intensity > 0
        continue
      }
      place(light, source)
      fade(light, intensity(source), dt)
      if (light.castShadow) light.shadow.autoUpdate = true
    }
  })
}

function createGlows() {
  const positions = new InstancedBufferAttribute(new Float32Array(GLOW_CAPACITY * 3), 3)
  const colors = new InstancedBufferAttribute(new Float32Array(GLOW_CAPACITY * 3), 3)
  const sizes = new InstancedBufferAttribute(new Float32Array(GLOW_CAPACITY), 1)
  for (const attribute of [positions, colors, sizes]) attribute.setUsage(DynamicDrawUsage)
  const material = new SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  material.positionNode = instancedDynamicBufferAttribute(positions)
  material.scaleNode = instancedDynamicBufferAttribute(sizes)
  material.colorNode = instancedDynamicBufferAttribute(colors, 'vec3')
  // A soft disc: full at the centre, smoothly nothing at the rim.
  const falloff = smoothstep(float(1), float(0), uv().sub(0.5).length().mul(2))
  material.opacityNode = falloff.mul(falloff)
  // Nothing into the scene pass's normals and diffuse colour (alpha 0 under material blending): the
  // ink reads the normals, and the whole quad, not just its disc, was an edge there. As the dust.
  material.mrtNode = mrt({ output, diffuseColor: vec4(0), normal: vec4(0) })
  material.fog = false
  const sprite = new Sprite(material)
  sprite.count = 0
  sprite.frustumCulled = false
  sprite.raycast = () => {}
  sprite.name = 'light-glows'
  return { sprite, positions, colors, sizes }
}

type CaptureHook = (camera: Camera) => () => void
const captureHooks = new WeakMap<Object3D, Set<CaptureHook>>()

/**
 * Sets the item lights of `scene` for a picture taken through `camera`: the pools re-ranked for
 * what that camera sees and every light straight at its strength, no fade. A capture camera is not
 * the live view's, and a theme switched for the picture leaves no time for lamps to fade in.
 * Returns what puts the live view's lights back.
 */
export function itemLightsForCapture(scene: Object3D, camera: Camera): () => void {
  const restores = [...(captureHooks.get(scene) ?? [])].map((hook) => hook(camera))
  return () => {
    for (const restore of restores) restore()
  }
}

/**
 * The lights items hold, through fixed pools of point lights, spots and two shadow-casting slots,
 * handed to the lights that add most to the view (intensity over squared distance, among those
 * whose reach meets the view frustum), with hysteresis, and faded across reassignment. Every pool
 * light stays mounted and visible and only its intensity moves: changing the light count
 * recompiles every material. The spot and shadow pools mount the first time a light needs them,
 * and stay. Glows are one instanced sprite for every glowing lamp, pooled or not.
 */
export function PooledLights<T extends PooledLight>(props: Props<T>) {
  const propsRef = useRef(props)
  propsRef.current = props
  const scene = useThree((state) => state.scene)
  const atmosphere = useSceneAtmosphere()
  const atmosphereRef = useRef(atmosphere)
  atmosphereRef.current = atmosphere
  const [sizes] = useState(poolSizes)
  const [needs, setNeeds] = useState({ spots: false, shadows: false, glows: false })
  const needsRef = useRef(needs)
  needsRef.current = needs
  const pools = useRef({
    point: slotsOf(sizes.point),
    spot: slotsOf(sizes.spot),
    shadow: slotsOf(sizes.shadow),
  })
  const pointRefs = useRef<Array<Array<PointLight | null>>>(
    Array.from({ length: sizes.point }, () => [null]),
  )
  const spotRefs = useRef<Array<Array<SpotLight | null>>>(
    Array.from({ length: sizes.spot }, () => [null]),
  )
  const shadowRefs = useRef<Array<Array<PointLight | SpotLight | null>>>(
    Array.from({ length: sizes.shadow }, () => [null, null]),
  )
  const glows = useMemo(createGlows, [])
  const reassignTimer = useRef(0)
  const prevCamPos = useRef(new Vector3())
  const prevCamFwd = useRef(new Vector3(0, 0, -1))

  const collect = () => {
    const byKey = new Map<string, T>()
    for (const light of propsRef.current.getLights()) byKey.set(light.key, light)
    return byKey
  }

  /** Hands the pools to the lights that add most to what `camera` sees. */
  const rank = (camera: Camera, byKey: Map<string, T>) => {
    const { weight, intensity } = propsRef.current
    const frustum = frustumOf(camera)
    camera.getWorldPosition(_camPos)
    const mounted = needsRef.current
    const wants = { ...mounted }
    const ranked: Array<Candidate & { light: T }> = []
    for (const light of byKey.values()) {
      wants.spots ||= Boolean(light.spot)
      wants.shadows ||= Boolean(light.shadows)
      wants.glows ||= Boolean(light.glow)
      const factor = weight(light)
      if (factor <= 0 || !light.getWorldPosition(_pos)) continue
      const priority =
        factor * lightContribution(_pos, intensity(light), light.distance, _camPos, frustum)
      if (priority > 0) ranked.push({ key: light.key, priority, light })
    }
    if (
      wants.spots !== mounted.spots ||
      wants.shadows !== mounted.shadows ||
      wants.glows !== mounted.glows
    )
      setNeeds(wants)
    ranked.sort((a, b) => b.priority - a.priority)
    const priorityByKey = new Map(ranked.map((candidate) => [candidate.key, candidate.priority]))

    const shadowed = mounted.shadows
      ? ranked
          .filter((candidate) => candidate.light.shadows)
          .map((candidate) => ({
            key: candidate.key,
            priority: candidate.priority * (candidate.light.spot ? 1 : POINT_SHADOW_FACTOR),
          }))
          .sort((a, b) => b.priority - a.priority)
          .slice(0, sizes.shadow)
      : []
    const inShadowPool = new Set(shadowed.map((candidate) => candidate.key))
    const rest = ranked.filter((candidate) => !inShadowPool.has(candidate.key))
    assignSlots(pools.current.shadow, shadowed, priorityByKey)
    assignSlots(
      pools.current.spot,
      mounted.spots ? rest.filter((candidate) => candidate.light.spot).slice(0, sizes.spot) : [],
      priorityByKey,
    )
    // Until the spot pool mounts, a spot shines as a point light.
    assignSlots(
      pools.current.point,
      rest.filter((candidate) => !(mounted.spots && candidate.light.spot)).slice(0, sizes.point),
      priorityByKey,
    )
  }

  const drive = (byKey: Map<string, T>, dt: number) => {
    const { intensity } = propsRef.current
    drivePool(pools.current.point, pointRefs.current, byKey, intensity, dt)
    drivePool(pools.current.spot, spotRefs.current, byKey, intensity, dt)
    drivePool(pools.current.shadow, shadowRefs.current, byKey, intensity, dt)
  }

  /** The glows, each drawn its radius nearer `eye` so the fixture around the bulb does not hide it. */
  const placeGlows = (byKey: Map<string, T>, eye: Vector3) => {
    if (!needsRef.current.glows) return
    const { intensity } = propsRef.current
    const darkness = glowDarkness(
      atmosphereRef.current?.sunDirection ?? null,
      useViewer.getState().sceneAppearance.appearance,
    )
    let count = 0
    for (const light of byKey.values()) {
      if (!light.glow || count >= GLOW_CAPACITY) continue
      const now = intensity(light)
      if (now <= 0 || !light.getWorldPosition(_pos)) continue
      _dir.subVectors(eye, _pos)
      _pos.addScaledVector(
        _dir,
        Math.min(light.glow.size / 2, _dir.length() / 2) / (_dir.length() || 1),
      )
      const level = light.peak ? Math.min(1, now / light.peak) : 1
      _color
        .set(light.color)
        .multiplyScalar(GLOW_GAIN * (light.glow.strength ?? 1) * level * darkness)
      glows.positions.setXYZ(count, _pos.x, _pos.y, _pos.z)
      glows.colors.setXYZ(count, _color.r, _color.g, _color.b)
      glows.sizes.setX(count, light.glow.size)
      count++
    }
    glows.sprite.count = count
    glows.sprite.visible = count > 0
    glows.positions.needsUpdate = true
    glows.colors.needsUpdate = true
    glows.sizes.needsUpdate = true
  }

  useEffect(() => {
    const hook: CaptureHook = (camera) => {
      const slots = Object.values(pools.current).map((pool) => pool.map((slot) => ({ ...slot })))
      const lights = [...pointRefs.current, ...spotRefs.current, ...shadowRefs.current]
        .flat()
        .filter((light): light is PointLight | SpotLight => Boolean(light))
      const intensities = lights.map((light) => light.intensity)
      const byKey = collect()
      rank(camera, byKey)
      for (const pool of Object.values(pools.current)) settle(pool)
      drive(byKey, Number.POSITIVE_INFINITY)
      camera.getWorldPosition(_camPos)
      placeGlows(byKey, _camPos)
      return () => {
        Object.values(pools.current).forEach((pool, i) => {
          pool.forEach((slot, j) => {
            Object.assign(slot, slots[i]![j])
          })
        })
        lights.forEach((light, i) => {
          light.intensity = intensities[i]!
        })
        reassignTimer.current = 0
      }
    }
    let hooks = captureHooks.get(scene)
    if (!hooks) {
      hooks = new Set()
      captureHooks.set(scene, hooks)
    }
    hooks.add(hook)
    return () => {
      hooks.delete(hook)
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: the hook reads the latest props and pools through refs
  }, [scene])

  useFrame(({ camera }, delta) => {
    const byKey = collect()
    camera.getWorldPosition(_camPos)
    camera.getWorldDirection(_camFwd)
    const camMoved =
      _camPos.distanceTo(prevCamPos.current) > CAM_MOVE_DIST ||
      _camFwd.dot(prevCamFwd.current) < CAM_ROT_DOT
    reassignTimer.current -= delta
    if (reassignTimer.current <= 0 || camMoved) {
      reassignTimer.current = REASSIGN_INTERVAL
      prevCamPos.current.copy(_camPos)
      prevCamFwd.current.copy(_camFwd)
      rank(camera, byKey)
    }
    drive(byKey, Math.min(delta, 0.1))
    camera.getWorldPosition(_camPos)
    placeGlows(byKey, _camPos)
  }, 6)

  return (
    <>
      {pointRefs.current.map((_, i) => (
        <pointLight
          castShadow={false}
          intensity={0}
          key={i}
          ref={(el) => {
            pointRefs.current[i]![0] = el
          }}
        />
      ))}
      {needs.spots &&
        spotRefs.current.map((_, i) => (
          <spotLight
            castShadow={false}
            intensity={0}
            key={i}
            ref={(el) => {
              spotRefs.current[i]![0] = el
            }}
          />
        ))}
      {needs.shadows &&
        shadowRefs.current.map((_, i) => (
          <group key={i}>
            <pointLight
              castShadow
              intensity={0}
              ref={(el) => {
                shadowRefs.current[i]![0] = el
              }}
              shadow-bias={-0.0005}
              shadow-camera-far={20}
              shadow-camera-near={0.05}
              shadow-mapSize={[512, 512]}
              shadow-normalBias={0.02}
            />
            <spotLight
              castShadow
              intensity={0}
              ref={(el) => {
                shadowRefs.current[i]![1] = el
              }}
              shadow-bias={-0.0005}
              shadow-camera-far={20}
              shadow-camera-near={0.05}
              shadow-mapSize={[1024, 1024]}
              shadow-normalBias={0.02}
            />
          </group>
        ))}
      {needs.glows && <primitive object={glows.sprite} />}
    </>
  )
}
