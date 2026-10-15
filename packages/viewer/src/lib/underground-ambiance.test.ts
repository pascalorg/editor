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
  easeAmbiance,
  eyeUnderTheGround,
  groundHoleOpenNode,
  groundHoleOpenNow,
  registerSkyLights,
  restoreSkyLights,
  SKY_LIGHT_SCALE,
  setAmbianceFactor,
  setGroundHoleOpen,
  stepAmbianceProgress,
  temporarilyWithoutAmbiance,
  UNDERGROUND_RIM,
  UNDERGROUND_RING,
  UNDERGROUND_VIGNETTE,
  undergroundAmbianceNode,
  undergroundBackdrop,
  undergroundDissolve,
  undergroundFogAmount,
  undergroundVignette,
} from './underground-ambiance'

afterEach(() => {
  restoreSkyLights()
  setAmbianceFactor(0)
  setGroundHoleOpen(0)
})

test('the dark mode is wanted only while the eye is under the ground, and never on Solid', () => {
  expect(ambianceTarget({ eyeUnderGround: false, groundMode: 'auto' })).toBe(0)
  expect(ambianceTarget({ eyeUnderGround: true, groundMode: 'auto' })).toBe(1)
  // The person's own override turns it off, wherever the eye is.
  expect(ambianceTarget({ eyeUnderGround: true, groundMode: 'solid' })).toBe(0)
})

test('the hysteresis band is 0.10 m each side of the ground, 0.20 m in all', () => {
  expect(EYE_BAND).toBe(0.1)
})

test('the eye goes under the ground past a small band and comes back past it, no chatter', () => {
  const ground = -0.05
  expect(eyeUnderTheGround(false, ground - EYE_BAND / 2, ground)).toBe(false)
  expect(eyeUnderTheGround(false, ground - EYE_BAND * 2, ground)).toBe(true)
  // Under, it stays under until it is clear above.
  expect(eyeUnderTheGround(true, ground + EYE_BAND / 2, ground)).toBe(true)
  expect(eyeUnderTheGround(true, ground + EYE_BAND * 2, ground)).toBe(false)
})

test('the dark mode’s palette is one place, and every stop of it is a neutral grey', () => {
  // Beside the scene theme tokens, because neither dark theme is neutral (navy, purple).
  expect(UNDERGROUND_RIM).toBe(UNDERGROUND_PALETTE.rim)
  expect(UNDERGROUND_RING).toBe(UNDERGROUND_PALETTE.ring)
  expect(UNDERGROUND_VIGNETTE).toBe(UNDERGROUND_PALETTE.vignette)
  for (const [name, hex] of Object.entries(UNDERGROUND_PALETTE)) {
    const channels = new Color(hex).getRGB({ r: 0, g: 0, b: 0 } as never, 'srgb')
    const spread =
      Math.max(channels.r, channels.g, channels.b) - Math.min(channels.r, channels.g, channels.b)
    // No hue: red, green and blue within a third of a level of 255 of each other.
    expect({ name, spread: Math.round(spread * 255) }).toEqual({ name, spread: 0 })
  }
  // Darker toward the sky and the corners, lighter on the ring: it reads as anthracite and a rim.
  const luma = (hex: string) => new Color(hex).r
  expect(luma(UNDERGROUND_PALETTE.vignette)).toBeLessThan(luma(UNDERGROUND_PALETTE.sky))
  expect(luma(UNDERGROUND_PALETTE.sky)).toBeLessThan(luma(UNDERGROUND_PALETTE.background))
  expect(luma(UNDERGROUND_PALETTE.background)).toBeLessThan(luma(UNDERGROUND_PALETTE.ring))
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

test('the hole in the ground follows its own factor, and is closed in a capture', () => {
  setGroundHoleOpen(0.7)
  expect(groundHoleOpenNow()).toBe(0.7)
  expect(groundHoleOpenNode().value).toBe(0.7)
  const release = temporarilyWithoutAmbiance()
  expect(groundHoleOpenNow()).toBe(0)
  expect(groundHoleOpenNode().value).toBe(0)
  setGroundHoleOpen(1)
  expect(groundHoleOpenNode().value).toBe(0)
  release()
  expect(groundHoleOpenNow()).toBe(1)
  expect(groundHoleOpenNode().value).toBe(1)
})

test('the pipeline pieces build as TSL nodes', () => {
  expect(undergroundBackdrop(vec3(0, 1, 0).y)).toBeTruthy()
  expect(undergroundVignette()).toBeTruthy()
  expect(undergroundFogAmount(vec3(4, 1, -30))).toBeTruthy()
  expect(undergroundDissolve()).toBeTruthy()
})

function skyLights() {
  const ambient = new AmbientLight('#ffffff', 0.8)
  const hemisphere = new HemisphereLight('#bcd4ff', '#554433', 1.2)
  const sun = new DirectionalLight('#fff4e0', 3)
  const fill = new DirectionalLight('#ffffff', 0)
  return { ambient, hemisphere, sun, fill, fillRest: 0 }
}

test('the sky’s light comes down and goes toward neutral grey for the frame, and is given back as the theme set it', () => {
  const { ambient, hemisphere, sun, fill, fillRest } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere, fill, fillRest }))
  const sky = hemisphere.color.clone()
  const ground = hemisphere.groundColor.clone()
  const tint = ambient.color.clone()

  applyAmbianceToSkyLights(1)
  expect(ambient.intensity).toBeCloseTo(0.8 * SKY_LIGHT_SCALE, 10)
  expect(hemisphere.intensity).toBeCloseTo(1.2 * SKY_LIGHT_SCALE, 10)
  // Toward the palette's neutral light grey: the colour cast shrinks (blue against red).
  expect(hemisphere.color.b / hemisphere.color.r).toBeLessThan(sky.b / sky.r)
  expect(hemisphere.groundColor.equals(ground)).toBe(false)
  expect(ambient.color.equals(tint)).toBe(false)
  // The eye's fill is the ambiance's own: from its rest to full at full.
  expect(fill.intensity).toBe(EYE_FILL_INTENSITY)
  // The sun is not the sky's: it is untouched.
  expect(sun.intensity).toBe(3)
  expect(sun.color.getHexString()).toBe(new Color('#fff4e0').getHexString())

  restoreSkyLights()
  expect(fill.intensity).toBe(fillRest)
  expect(ambient.intensity).toBe(0.8)
  expect(hemisphere.intensity).toBe(1.2)
  expect(hemisphere.color.equals(sky)).toBe(true)
  expect(hemisphere.groundColor.equals(ground)).toBe(true)
  expect(ambient.color.equals(tint)).toBe(true)
  unregister()
})

test('half the ambiance brings the light half-way, and none leaves it alone', () => {
  const { ambient, hemisphere, fill, fillRest } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere, fill, fillRest }))
  applyAmbianceToSkyLights(0.5)
  expect(ambient.intensity).toBeCloseTo(0.8 * (1 + (SKY_LIGHT_SCALE - 1) * 0.5), 10)
  // The fill rides the factor from nothing, so it never steps on or off.
  expect(fill.intensity).toBeCloseTo(EYE_FILL_INTENSITY * 0.5, 10)
  applyAmbianceToSkyLights(0)
  expect(ambient.intensity).toBe(0.8)
  expect(fill.intensity).toBe(0)
  unregister()
})

test('over a veiled ground the fill rests at the veil’s own 1 and rides up from there', () => {
  const { ambient, hemisphere, fill } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere, fill, fillRest: 1 }))
  applyAmbianceToSkyLights(0)
  expect(fill.intensity).toBe(1)
  applyAmbianceToSkyLights(0.5)
  expect(fill.intensity).toBeCloseTo(1 + (EYE_FILL_INTENSITY - 1) * 0.5, 10)
  applyAmbianceToSkyLights(1)
  expect(fill.intensity).toBe(EYE_FILL_INTENSITY)
  restoreSkyLights()
  expect(fill.intensity).toBe(1)
  unregister()
})

test('a capture takes the lights back at once, even while they are brought down', () => {
  const { ambient, hemisphere, fill, fillRest } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere, fill, fillRest }))
  setAmbianceFactor(1)
  applyAmbianceToSkyLights(1)
  expect(ambient.intensity).toBeLessThan(0.8)
  expect(fill.intensity).toBe(EYE_FILL_INTENSITY)
  const release = temporarilyWithoutAmbiance()
  expect(ambient.intensity).toBe(0.8)
  expect(hemisphere.intensity).toBe(1.2)
  // The fill goes back to what it was before the dive existed (the veil's own, or none).
  expect(fill.intensity).toBe(fillRest)
  release()
  unregister()
})

test('applying twice in a row never compounds', () => {
  const { ambient, hemisphere, fill, fillRest } = skyLights()
  const unregister = registerSkyLights(() => ({ ambient, hemisphere, fill, fillRest }))
  applyAmbianceToSkyLights(1)
  applyAmbianceToSkyLights(1)
  expect(ambient.intensity).toBeCloseTo(0.8 * SKY_LIGHT_SCALE, 10)
  unregister()
})
