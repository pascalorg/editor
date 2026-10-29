'use client'

import type { LightGlow, LightSpot } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { float, instancedDynamicBufferAttribute, smoothstep, uv } from 'three/tsl'
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  MathUtils,
  type PointLight,
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
  glow?: LightGlow
  /** Its fully-on intensity, so its glow dims with it. */
  peak?: number
  /** Where it shines from; false while its object is not mounted. */
  getWorldPosition: (out: Vector3) => boolean
  /** Its spot's aim in world space, turned with its item. */
  getWorldDirection?: (out: Vector3) => void
}

type Props<T extends PooledLight> = {
  getLights: () => Iterable<T>
  /** Lower is more wanted; infinite when it cannot be seen lit (off, hidden). */
  score: (light: T, camPos: Vector3, camFwd: Vector3) => number
  /** What it shines at now: 0 while off or not drawn. */
  intensity: (light: T) => number
}

const POINT_POOL = 12
const SPOT_POOL = 6
const SHADOW_POOL = 2
// A point light's shadow is six renders and a spot's one, so spots win the shadow slots.
const POINT_SHADOW_PENALTY = 0.5
const GLOW_CAPACITY = 256
// How bright a glow stays in full daylight, against 1 at night.
const DAYLIGHT_GLOW = 0.08
// Strength 1 is a lamp's plain halo at night, read against tone-mapped light colours.
const GLOW_GAIN = 3

// How often (in seconds) to re-evaluate which lights hold slots (fallback timer)
const REASSIGN_INTERVAL = 0.2
// A held slot keeps its key unless a candidate beats it by at least this much (no flicker).
const HYSTERESIS = 0.15
// Camera movement that triggers an early re-evaluation
const CAM_MOVE_DIST = 0.5
const CAM_ROT_DOT = 0.995

type Slot = { key: string | null; pendingKey: string | null; isFadingOut: boolean }
type Candidate = { key: string; score: number }

const slotsOf = (size: number): Slot[] =>
  Array.from({ length: size }, () => ({ key: null, pendingKey: null, isFadingOut: false }))

/**
 * Gives the wanted keys (best first) the pool's slots: a key that holds a slot keeps it, and a
 * newcomer evicts a key no longer wanted only on a clear win. A slot changing hands fades out
 * first; an idle slot takes its key at once.
 */
export function assignSlots(slots: Slot[], wanted: Candidate[], scoreByKey: Map<string, number>) {
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
      const currentScore = scoreByKey.get(current) ?? Number.POSITIVE_INFINITY
      if (currentScore - (scoreByKey.get(key) ?? 0) < HYSTERESIS) {
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
  light.intensity = MathUtils.lerp(light.intensity, to, dt * 12)
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
  material.fog = false
  const sprite = new Sprite(material)
  sprite.count = 0
  sprite.frustumCulled = false
  sprite.raycast = () => {}
  sprite.name = 'light-glows'
  return { sprite, positions, colors, sizes }
}

/**
 * The lights items hold, through fixed pools: twelve point lights, six spots and two
 * shadow-casting slots, each handed each tick to the most-wanted lights (camera-proximity
 * scored, with hysteresis) and faded across reassignment. Every pool light stays mounted and
 * visible and only its intensity moves: changing the light count recompiles every material.
 * The spot and shadow pools mount the first time a light needs them, and stay. Glows are one
 * instanced sprite for every glowing lamp, pooled or not.
 */
export function PooledLights<T extends PooledLight>({ getLights, score, intensity }: Props<T>) {
  const atmosphere = useSceneAtmosphere()
  const [needs, setNeeds] = useState({ spots: false, shadows: false, glows: false })
  const needsRef = useRef(needs)
  needsRef.current = needs
  const pools = useRef({
    point: slotsOf(POINT_POOL),
    spot: slotsOf(SPOT_POOL),
    shadow: slotsOf(SHADOW_POOL),
  })
  const pointRefs = useRef<Array<Array<PointLight | null>>>(
    Array.from({ length: POINT_POOL }, () => [null]),
  )
  const spotRefs = useRef<Array<Array<SpotLight | null>>>(
    Array.from({ length: SPOT_POOL }, () => [null]),
  )
  const shadowRefs = useRef<Array<Array<PointLight | SpotLight | null>>>(
    Array.from({ length: SHADOW_POOL }, () => [null, null]),
  )
  const glows = useMemo(createGlows, [])
  const reassignTimer = useRef(0)
  const prevCamPos = useRef(new Vector3())
  const prevCamFwd = useRef(new Vector3(0, 0, -1))

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1)
    const byKey = new Map<string, T>()
    for (const light of getLights()) byKey.set(light.key, light)

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

      const mounted = needsRef.current
      const wants = { ...mounted }
      const scored: Array<Candidate & { light: T }> = []
      for (const light of byKey.values()) {
        wants.spots ||= Boolean(light.spot)
        wants.shadows ||= Boolean(light.shadows)
        wants.glows ||= Boolean(light.glow)
        const value = score(light, _camPos, _camFwd)
        if (Number.isFinite(value)) scored.push({ key: light.key, score: value, light })
      }
      if (
        wants.spots !== mounted.spots ||
        wants.shadows !== mounted.shadows ||
        wants.glows !== mounted.glows
      )
        setNeeds(wants)
      scored.sort((a, b) => a.score - b.score)
      const scoreByKey = new Map(scored.map((candidate) => [candidate.key, candidate.score]))

      const shadowed = mounted.shadows
        ? scored
            .filter((candidate) => candidate.light.shadows)
            .map((candidate) => ({
              key: candidate.key,
              score: candidate.score + (candidate.light.spot ? 0 : POINT_SHADOW_PENALTY),
            }))
            .sort((a, b) => a.score - b.score)
            .slice(0, SHADOW_POOL)
        : []
      const inShadowPool = new Set(shadowed.map((candidate) => candidate.key))
      const rest = scored.filter((candidate) => !inShadowPool.has(candidate.key))
      assignSlots(pools.current.shadow, shadowed, scoreByKey)
      assignSlots(
        pools.current.spot,
        mounted.spots ? rest.filter((candidate) => candidate.light.spot).slice(0, SPOT_POOL) : [],
        scoreByKey,
      )
      // Until the spot pool mounts, a spot shines as a point light.
      assignSlots(
        pools.current.point,
        rest.filter((candidate) => !(mounted.spots && candidate.light.spot)).slice(0, POINT_POOL),
        scoreByKey,
      )
    }

    drivePool(pools.current.point, pointRefs.current, byKey, intensity, dt)
    drivePool(pools.current.spot, spotRefs.current, byKey, intensity, dt)
    drivePool(pools.current.shadow, shadowRefs.current, byKey, intensity, dt)

    if (!needsRef.current.glows) return
    const darkness = glowDarkness(
      atmosphere?.sunDirection ?? null,
      useViewer.getState().sceneAppearance.appearance,
    )
    let count = 0
    for (const light of byKey.values()) {
      if (!light.glow || count >= GLOW_CAPACITY) continue
      const now = intensity(light)
      if (now <= 0 || !light.getWorldPosition(_pos)) continue
      // Drawn its radius nearer the eye, so the fixture around the bulb does not swallow it.
      _dir.subVectors(_camPos, _pos)
      _pos.addScaledVector(
        _dir,
        Math.min(light.glow.size / 2, _dir.length() / 2) / (_dir.length() || 1),
      )
      const level = light.peak ? Math.min(1, now / light.peak) : 1
      _color.set(light.color).multiplyScalar(GLOW_GAIN * light.glow.strength * level * darkness)
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
