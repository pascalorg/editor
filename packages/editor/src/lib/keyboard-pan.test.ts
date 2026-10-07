import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  acceptsKeyboardPan,
  advanceKeyboardPanMotion,
  clearKeyboardPanKeys,
  createKeyboardPanMotion,
  hasKeyboardPanInput,
  isKeyboardPanKey,
  KEYBOARD_PAN_RAMP_SECONDS,
  KEYBOARD_PAN_START_FRACTION,
  KEYBOARD_PAN_STOP_SECONDS,
  type KeyboardPanState,
  keyboardPanSpeed,
  setKeyboardPanKey,
  syncKeyboardPanMotion,
} from './keyboard-pan'

const idle = (): KeyboardPanState => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
})

/**
 * Frames every `1000 / hz` ms from `phaseMs`; `codes` go down at `pressMs` and
 * up `holdMs` later, synced at the edges like the views do. Returns the total
 * travel in cruise-seconds and how long the glide lasted.
 */
function simulate({
  codes = ['KeyD'],
  holdMs,
  hz = 60,
  phaseMs = 0,
  pressMs = 1000,
}: {
  codes?: string[]
  holdMs: number
  hz?: number
  phaseMs?: number
  pressMs?: number
}) {
  const motion = createKeyboardPanMotion()
  const keys = idle()
  const releaseMs = pressMs + holdMs
  let x = 0
  let y = 0
  let pressed = false
  let released = false
  let restMs = releaseMs
  for (let now = phaseMs; now < releaseMs + 2000; now += 1000 / hz) {
    if (!pressed && now >= pressMs) {
      syncKeyboardPanMotion(motion, keys, pressMs)
      for (const code of codes) setKeyboardPanKey(keys, code, true)
      pressed = true
    }
    if (!released && now >= releaseMs) {
      syncKeyboardPanMotion(motion, keys, releaseMs)
      clearKeyboardPanKeys(keys)
      released = true
    }
    if (advanceKeyboardPanMotion(motion, keys, now)) restMs = now
    x += motion.stepX
    y += motion.stepY
  }
  return { x, y, glideMs: restMs - releaseMs, motion }
}

const key = (init: Partial<KeyboardEvent>) => ({ target: null, ...init }) as KeyboardEvent

// No DOM in this runner: stand in for the element classes the editable check reads.
const DOM_CLASSES = ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']
const stubbed: string[] = []
beforeAll(() => {
  const scope = globalThis as Record<string, unknown>
  for (const name of DOM_CLASSES) {
    if (scope[name]) continue
    scope[name] = class {}
    stubbed.push(name)
  }
})
afterAll(() => {
  for (const name of stubbed) delete (globalThis as Record<string, unknown>)[name]
})

test('physical WASD keys drive a screen-space direction; letters on other layouts do not', () => {
  const state = idle()
  expect(isKeyboardPanKey('KeyZ')).toBe(false)
  expect(setKeyboardPanKey(state, 'KeyW', true)).toBe(true)
  expect(setKeyboardPanKey(state, 'KeyW', true)).toBe(false)
  setKeyboardPanKey(state, 'KeyD', true)
  const motion = createKeyboardPanMotion()
  syncKeyboardPanMotion(motion, state, 0)
  advanceKeyboardPanMotion(motion, state, 100)
  expect(motion.stepX).toBeGreaterThan(0)
  expect(motion.stepY).toBeCloseTo(motion.stepX)
  setKeyboardPanKey(state, 'KeyA', true)
  advanceKeyboardPanMotion(motion, state, 200)
  expect(motion.stepX).toBe(0)
  expect(motion.stepY).toBeGreaterThan(0)
  clearKeyboardPanKeys(state)
  expect(hasKeyboardPanInput(state)).toBe(false)
})

test('modifier chords stay shortcuts, and typing in a field never pans', () => {
  expect(acceptsKeyboardPan(key({}))).toBe(true)
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const)
    expect(acceptsKeyboardPan(key({ [modifier]: true }))).toBe(false)
  const Input = (globalThis as unknown as { HTMLInputElement: new () => EventTarget })
    .HTMLInputElement
  expect(acceptsKeyboardPan(key({ target: new Input() }))).toBe(false)
})

test('cruise speed scales with the visible width within fixed bounds', () => {
  expect(keyboardPanSpeed(0)).toBe(0.5)
  expect(keyboardPanSpeed(20)).toBeCloseTo(6)
  expect(keyboardPanSpeed(1000)).toBe(30)
})

test('a press starts just under cruise and reaches it within the ramp', () => {
  const at = (holdSeconds: number) => {
    const motion = createKeyboardPanMotion()
    syncKeyboardPanMotion(motion, idle(), 0)
    advanceKeyboardPanMotion(motion, { ...idle(), right: true }, holdSeconds * 1000)
    return motion.velocityX
  }
  expect(at(0.001)).toBeCloseTo(KEYBOARD_PAN_START_FRACTION, 2)
  expect(at(KEYBOARD_PAN_RAMP_SECONDS / 2)).toBeGreaterThan(KEYBOARD_PAN_START_FRACTION)
  expect(at(KEYBOARD_PAN_RAMP_SECONDS / 2)).toBeLessThan(1)
  expect(at(KEYBOARD_PAN_RAMP_SECONDS)).toBe(1)
})

test('a tap moves a small, predictable amount and a hold travels at cruise', () => {
  // 100 ms ramping up from the start fraction, plus a short glide.
  const tap = simulate({ holdMs: 100 }).x
  expect(tap).toBeGreaterThan(0.1 * KEYBOARD_PAN_START_FRACTION)
  expect(tap).toBeLessThan(0.1)
  const hold = simulate({ holdMs: 2000 }).x
  expect(hold).toBeGreaterThan(1.98)
  expect(hold).toBeLessThan(2.02)
})

test('a tap counts from the key events, not from the frames around them', () => {
  const taps = [0, 5, 11, 16].map((phaseMs) => simulate({ holdMs: 100, phaseMs }).x)
  const slowFrames = [0, 40, 80].map((phaseMs) => simulate({ holdMs: 100, hz: 10, phaseMs }).x)
  for (const tap of [...taps, ...slowFrames]) expect(tap).toBeCloseTo(taps[0] ?? 0, 2)
  // Shorter than a frame still moves, by its own length.
  expect(simulate({ holdMs: 8, phaseMs: 1 }).x).toBeGreaterThan(0.006)
})

test('release comes to rest within the stop time, with a barely visible glide', () => {
  const hold = simulate({ codes: ['KeyW'], holdMs: 1000 })
  expect(hold.glideMs).toBeLessThanOrEqual(KEYBOARD_PAN_STOP_SECONDS * 1000 + 1000 / 60)
  // Glide under 3% of a cruise-second: about 1% of the view width.
  const held1s = 1 - ((1 - KEYBOARD_PAN_START_FRACTION) * KEYBOARD_PAN_RAMP_SECONDS) / 3
  expect(hold.y - held1s).toBeGreaterThan(0)
  expect(hold.y - held1s).toBeLessThan(0.03)
  expect(hold.motion.velocityY).toBe(0)
})

test('travel does not depend on the frame rate', () => {
  const at60 = simulate({ holdMs: 1000 }).x
  expect(simulate({ holdMs: 1000, hz: 144 }).x).toBeCloseTo(at60, 3)
  expect(simulate({ holdMs: 1000, hz: 20 }).x).toBeCloseTo(at60, 2)
})

test('diagonals move no faster than a straight press', () => {
  const straight = simulate({ holdMs: 1000 })
  const diagonal = simulate({ codes: ['KeyD', 'KeyW'], holdMs: 1000 })
  expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(straight.x)
  expect(diagonal.x).toBeCloseTo(diagonal.y)
})

test('a press during the glide resumes from the current speed', () => {
  const motion = createKeyboardPanMotion()
  const right = { ...idle(), right: true }
  syncKeyboardPanMotion(motion, idle(), 0)
  syncKeyboardPanMotion(motion, right, 1000)
  syncKeyboardPanMotion(motion, idle(), 1002)
  const glidingSpeed = motion.velocityX
  expect(glidingSpeed).toBeGreaterThan(KEYBOARD_PAN_START_FRACTION)
  advanceKeyboardPanMotion(motion, right, 1003)
  expect(motion.velocityX).toBeGreaterThanOrEqual(glidingSpeed)
})
