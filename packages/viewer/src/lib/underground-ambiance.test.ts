import { afterEach, expect, test } from 'bun:test'
import { AmbientLight, Color, DirectionalLight, HemisphereLight } from 'three'
import { vec3 } from 'three/tsl'
import {
  AMBIANCE_SECONDS,
  ambianceNow,
  ambianceTarget,
  applyAmbianceToSkyLights,
  EYE_BAND,
  easeAmbiance,
  eyeUnderTheGround,
  registerSkyLights,
  restoreSkyLights,
  SKY_LIGHT_SCALE,
  setAmbianceFactor,
  stepAmbianceProgress,
  temporarilyWithoutAmbiance,
  undergroundAmbianceNode,
  undergroundBackdrop,
  undergroundFogAmount,
  undergroundVignette,
} from './underground-ambiance'

afterEach(() => {
  restoreSkyLights()
  setAmbianceFactor(0)
})

test('the ambiance is wanted while the ground is veiled or the eye is under it, never on Solid', () => {
  const at = { groundVeiled: false, eyeUnderGround: false, groundMode: 'auto' } as const
  expect(ambianceTarget(at)).toBe(0)
  expect(ambianceTarget({ ...at, groundVeiled: true })).toBe(1)
  expect(ambianceTarget({ ...at, eyeUnderGround: true })).toBe(1)
  // The person's own override turns it off with the veil, wherever the eye is.
  expect(ambianceTarget({ groundVeiled: true, eyeUnderGround: true, groundMode: 'solid' })).toBe(0)
})

test('the eye goes under the ground past a small band and comes back past it, no chatter', () => {
  const ground = -0.05
  expect(eyeUnderTheGround(false, ground - EYE_BAND / 2, ground)).toBe(false)
  expect(eyeUnderTheGround(false, ground - EYE_BAND * 2, ground)).toBe(true)
  // Under, it stays under until it is clear above.
  expect(eyeUnderTheGround(true, ground + EYE_BAND / 2, ground)).toBe(true)
  expect(eyeUnderTheGround(true, ground + EYE_BAND * 2, ground)).toBe(false)
})

test('the crossing takes its seconds, in a straight line, and ends exactly at the target', () => {
  let progress = 0
  const frames: number[] = []
  const dt = 1 / 60
  for (let at = 0; at < AMBIANCE_SECONDS + 0.2; at += dt) {
    progress = stepAmbianceProgress(progress, 1, dt, AMBIANCE_SECONDS)
    frames.push(progress)
  }
  expect(progress).toBe(1)
  expect(frames.every((value, index) => index === 0 || value >= frames[index - 1]!)).toBe(true)
  // About 0.7 s of 60 fps frames: it has not arrived half-way through.
  expect(frames[Math.floor(frames.length / 2) - 2]).toBeLessThan(1)
  // And back, the same way.
  for (let at = 0; at < AMBIANCE_SECONDS + 0.2; at += dt)
    progress = stepAmbianceProgress(progress, 0, dt, AMBIANCE_SECONDS)
  expect(progress).toBe(0)
})

test('a crossing turned round in the middle goes back from where it is, no pop', () => {
  let progress = 0
  for (let i = 0; i < 20; i += 1) progress = stepAmbianceProgress(progress, 1, 1 / 60, 0.7)
  const turned = progress
  expect(turned).toBeGreaterThan(0.2)
  expect(turned).toBeLessThan(0.8)
  const next = stepAmbianceProgress(turned, 0, 1 / 60, 0.7)
  expect(Math.abs(next - turned)).toBeLessThan(0.03)
  expect(next).toBeLessThan(turned)
})

test('no seconds is instant', () => {
  expect(stepAmbianceProgress(0, 1, 1 / 60, 0)).toBe(1)
  expect(stepAmbianceProgress(1, 0, 1 / 60, 0)).toBe(0)
})

test('the ease is slow in and slow out, with the same ends', () => {
  expect(easeAmbiance(0)).toBe(0)
  expect(easeAmbiance(1)).toBe(1)
  expect(easeAmbiance(0.5)).toBeCloseTo(0.5, 10)
  expect(easeAmbiance(0.1)).toBeLessThan(0.1)
  expect(easeAmbiance(0.9)).toBeGreaterThan(0.9)
})

test('the factor shaders read is the live one, and zero while a capture holds the world', () => {
  setAmbianceFactor(0.6)
  expect(ambianceNow()).toBe(0.6)
  expect(undergroundAmbianceNode().value).toBe(0.6)
  const release = temporarilyWithoutAmbiance()
  expect(ambianceNow()).toBe(0)
  expect(undergroundAmbianceNode().value).toBe(0)
  // The system goes on easing meanwhile; the capture still sees none of it.
  setAmbianceFactor(1)
  expect(undergroundAmbianceNode().value).toBe(0)
  release()
  expect(ambianceNow()).toBe(1)
  expect(undergroundAmbianceNode().value).toBe(1)
})

test('the pipeline pieces build as TSL nodes', () => {
  expect(undergroundBackdrop(vec3(0, 1, 0).y)).toBeTruthy()
  expect(undergroundVignette()).toBeTruthy()
  expect(undergroundFogAmount(vec3(4, 1, -30))).toBeTruthy()
})

function skyLights() {
  const ambient = new AmbientLight('#ffffff', 0.8)
  const hemisphere = new HemisphereLight('#bcd4ff', '#554433', 1.2)
  const sun = new DirectionalLight('#fff4e0', 3)
  return { ambient, hemisphere, sun }
}

test('the sky’s light comes down and warms for the frame, and is given back as the theme set it', () => {
  const { ambient, hemisphere, sun } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere }))
  const sky = hemisphere.color.clone()
  const ground = hemisphere.groundColor.clone()
  const tint = ambient.color.clone()

  applyAmbianceToSkyLights(1)
  expect(ambient.intensity).toBeCloseTo(0.8 * SKY_LIGHT_SCALE, 10)
  expect(hemisphere.intensity).toBeCloseTo(1.2 * SKY_LIGHT_SCALE, 10)
  // Warmer: the red share of the sky colour grows against its blue.
  expect(hemisphere.color.r / hemisphere.color.b).toBeGreaterThan(sky.r / sky.b)
  expect(hemisphere.groundColor.equals(ground)).toBe(false)
  expect(ambient.color.equals(tint)).toBe(false)
  // The sun is not the sky's: it is untouched.
  expect(sun.intensity).toBe(3)
  expect(sun.color.getHexString()).toBe(new Color('#fff4e0').getHexString())

  restoreSkyLights()
  expect(ambient.intensity).toBe(0.8)
  expect(hemisphere.intensity).toBe(1.2)
  expect(hemisphere.color.equals(sky)).toBe(true)
  expect(hemisphere.groundColor.equals(ground)).toBe(true)
  expect(ambient.color.equals(tint)).toBe(true)
  unregister()
})

test('half the ambiance brings the light half-way, and none leaves it alone', () => {
  const { ambient, hemisphere } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere }))
  applyAmbianceToSkyLights(0.5)
  expect(ambient.intensity).toBeCloseTo(0.8 * (1 + (SKY_LIGHT_SCALE - 1) * 0.5), 10)
  applyAmbianceToSkyLights(0)
  expect(ambient.intensity).toBe(0.8)
  unregister()
})

test('a capture takes the lights back at once, even while they are brought down', () => {
  const { ambient, hemisphere } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere }))
  setAmbianceFactor(1)
  applyAmbianceToSkyLights(1)
  expect(ambient.intensity).toBeLessThan(0.8)
  const release = temporarilyWithoutAmbiance()
  expect(ambient.intensity).toBe(0.8)
  expect(hemisphere.intensity).toBe(1.2)
  release()
  unregister()
})

test('applying twice in a row never compounds', () => {
  const { ambient, hemisphere } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere }))
  applyAmbianceToSkyLights(1)
  applyAmbianceToSkyLights(1)
  expect(ambient.intensity).toBeCloseTo(0.8 * SKY_LIGHT_SCALE, 10)
  unregister()
})
