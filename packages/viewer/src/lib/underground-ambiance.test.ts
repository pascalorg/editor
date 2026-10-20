import { afterEach, expect, test } from 'bun:test'
import { AmbientLight, Color, DirectionalLight, HemisphereLight } from 'three'
import { vec3 } from 'three/tsl'
import { UNDERGROUND_PALETTE } from './scene-themes'
import {
  AMBIANCE_SECONDS,
  ambianceNow,
  ambianceTarget,
  applyAmbianceToSkyLights,
  EYE_BAND,
  EYE_FILL_INTENSITY,
  earthTarget,
  easeAmbiance,
  eyeUnderTheGround,
  groundHoleOpenNode,
  groundHoleOpenNow,
  registerSkyLights,
  restoreSkyLights,
  SKY_LIGHT_SCALE,
  setAmbianceFactor,
  setEarthFactor,
  setGroundHoleOpen,
  stepAmbianceProgress,
  temporarilyWithoutAmbiance,
  undergroundAmbianceNode,
  undergroundBackdrop,
  undergroundDissolve,
  undergroundEarthNode,
  undergroundFogAmount,
  undergroundVignette,
} from './underground-ambiance'

afterEach(() => {
  restoreSkyLights()
  setAmbianceFactor(0)
  setEarthFactor(0)
  setGroundHoleOpen(0)
})

test('the dark mode is wanted only while the eye is under the ground, never on Solid; in the walkthrough only the earth outside follows the eye', () => {
  expect(ambianceTarget({ eyeUnderGround: false, groundMode: 'auto' })).toBe(0)
  expect(ambianceTarget({ eyeUnderGround: true, groundMode: 'auto' })).toBe(1)
  // The person's own override turns it off, wherever the eye is.
  expect(ambianceTarget({ eyeUnderGround: true, groundMode: 'solid' })).toBe(0)
  const under = { eyeUnderGround: true, groundMode: 'auto', walkthroughMode: true } as const
  expect(ambianceTarget(under)).toBe(0)
  expect(earthTarget(under)).toBe(1)
  expect(earthTarget({ ...under, eyeUnderGround: false })).toBe(0)
  expect(earthTarget({ ...under, groundMode: 'solid' })).toBe(0)
  // Outside the walkthrough the two are the same edge.
  expect(ambianceTarget({ ...under, walkthroughMode: false })).toBe(1)
})

test('the eye goes under the ground past a small band and comes back past it, no chatter', () => {
  const ground = -0.05
  expect(eyeUnderTheGround(false, ground - EYE_BAND / 2, ground)).toBe(false)
  expect(eyeUnderTheGround(false, ground - EYE_BAND * 2, ground)).toBe(true)
  // Under, it stays under until it is clear above.
  expect(eyeUnderTheGround(true, ground + EYE_BAND / 2, ground)).toBe(true)
  expect(eyeUnderTheGround(true, ground + EYE_BAND * 2, ground)).toBe(false)
})

test('the crossing takes its seconds in a straight line and ends exactly at the target; turned round it goes back from where it is; no seconds is instant', () => {
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
  for (let at = 0; at < AMBIANCE_SECONDS + 0.2; at += dt)
    progress = stepAmbianceProgress(progress, 0, dt, AMBIANCE_SECONDS)
  expect(progress).toBe(0)
  // Turned round in the middle: back from where it is, no pop.
  for (let i = 0; i < 20; i += 1) progress = stepAmbianceProgress(progress, 1, dt, 0.7)
  const next = stepAmbianceProgress(progress, 0, dt, 0.7)
  expect(Math.abs(next - progress)).toBeLessThan(0.03)
  expect(next).toBeLessThan(progress)
  expect(stepAmbianceProgress(0, 1, dt, 0)).toBe(1)
  expect(stepAmbianceProgress(1, 0, dt, 0)).toBe(0)
  // The ease is slow in and slow out, with the same ends.
  expect([easeAmbiance(0), easeAmbiance(0.5), easeAmbiance(1)]).toEqual([0, 0.5, 1])
  expect(easeAmbiance(0.1)).toBeLessThan(0.1)
  expect(easeAmbiance(0.9)).toBeGreaterThan(0.9)
})

test('what shaders read is the live factor, and zero while a capture holds the world, for the dark mode, the hole and the earth', () => {
  const reads = [
    { set: setAmbianceFactor, now: ambianceNow, node: () => undergroundAmbianceNode().value },
    { set: setGroundHoleOpen, now: groundHoleOpenNow, node: () => groundHoleOpenNode().value },
    {
      set: setEarthFactor,
      now: () => undergroundEarthNode().value,
      node: () => undergroundEarthNode().value,
    },
  ]
  for (const { set, now, node } of reads) {
    set(0.6)
    expect(now()).toBe(0.6)
    expect(node()).toBe(0.6)
  }
  const release = temporarilyWithoutAmbiance()
  for (const { set, now, node } of reads) {
    // The system goes on easing meanwhile; the capture still sees none of it.
    set(1)
    expect(now()).toBe(0)
    expect(node()).toBe(0)
  }
  release()
  for (const { now, node } of reads) {
    expect(now()).toBe(1)
    expect(node()).toBe(1)
  }
})

test('every stop of the dark mode’s palette is a neutral grey: neither dark theme is, navy and purple', () => {
  for (const [name, hex] of Object.entries(UNDERGROUND_PALETTE)) {
    const channels = new Color(hex).getRGB({ r: 0, g: 0, b: 0 } as never, 'srgb')
    const spread =
      Math.max(channels.r, channels.g, channels.b) - Math.min(channels.r, channels.g, channels.b)
    expect({ name, spread: Math.round(spread * 255) }).toEqual({ name, spread: 0 })
  }
})

function skyLights() {
  const ambient = new AmbientLight('#ffffff', 0.8)
  const hemisphere = new HemisphereLight('#bcd4ff', '#554433', 1.2)
  const sun = new DirectionalLight('#fff4e0', 3)
  const fill = new DirectionalLight('#ffffff', 0)
  return { ambient, hemisphere, sun, fill }
}

test('the sky’s light comes down toward grey for the frame in proportion, never compounds, and is given back as the theme set it; the sun is untouched', () => {
  const { ambient, hemisphere, sun, fill } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere, fill, fillRest: 0 }))
  const sky = hemisphere.color.clone()
  const tint = ambient.color.clone()

  applyAmbianceToSkyLights(1)
  applyAmbianceToSkyLights(1)
  expect(ambient.intensity).toBeCloseTo(0.8 * SKY_LIGHT_SCALE, 10)
  expect(hemisphere.intensity).toBeCloseTo(1.2 * SKY_LIGHT_SCALE, 10)
  // Toward neutral light grey: the colour cast shrinks (blue against red).
  expect(hemisphere.color.b / hemisphere.color.r).toBeLessThan(sky.b / sky.r)
  expect(ambient.color.equals(tint)).toBe(false)
  // The eye's fill is the ambiance's own: from nothing to full at full. The sun is not the sky's.
  expect(fill.intensity).toBe(EYE_FILL_INTENSITY)
  expect(sun.intensity).toBe(3)

  applyAmbianceToSkyLights(0.5)
  expect(ambient.intensity).toBeCloseTo(0.8 * (1 + (SKY_LIGHT_SCALE - 1) * 0.5), 10)
  expect(fill.intensity).toBeCloseTo(EYE_FILL_INTENSITY * 0.5, 10)

  restoreSkyLights()
  expect(fill.intensity).toBe(0)
  expect(ambient.intensity).toBe(0.8)
  expect(hemisphere.intensity).toBe(1.2)
  expect(hemisphere.color.equals(sky)).toBe(true)
  expect(ambient.color.equals(tint)).toBe(true)
  unregister()
})

test('over a veiled ground the fill rests at the veil’s own 1 and rides up from there; a capture takes the lights back at once', () => {
  const { ambient, hemisphere, fill } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere, fill, fillRest: 1 }))
  applyAmbianceToSkyLights(0)
  expect(fill.intensity).toBe(1)
  applyAmbianceToSkyLights(0.5)
  expect(fill.intensity).toBeCloseTo(1 + (EYE_FILL_INTENSITY - 1) * 0.5, 10)
  setAmbianceFactor(1)
  applyAmbianceToSkyLights(1)
  expect(fill.intensity).toBe(EYE_FILL_INTENSITY)
  expect(ambient.intensity).toBeLessThan(0.8)
  const release = temporarilyWithoutAmbiance()
  // What it was before the dive existed: the veil's own fill, the sky's light as the theme set it.
  expect(ambient.intensity).toBe(0.8)
  expect(hemisphere.intensity).toBe(1.2)
  expect(fill.intensity).toBe(1)
  release()
  unregister()
})

test('the pipeline pieces build as TSL nodes', () => {
  expect(undergroundBackdrop(vec3(0, 1, 0).y)).toBeTruthy()
  expect(undergroundVignette()).toBeTruthy()
  expect(undergroundFogAmount(vec3(4, 1, -30))).toBeTruthy()
  expect(undergroundDissolve()).toBeTruthy()
})
