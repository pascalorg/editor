import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  acceptsKeyboardPan,
  clearKeyboardPanKeys,
  hasKeyboardPanInput,
  isKeyboardPanKey,
  type KeyboardPanState,
  keyboardPanDirection,
  keyboardPanSpeed,
  setKeyboardPanKey,
} from './keyboard-pan'

const idle = (): KeyboardPanState => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
})
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
  expect(keyboardPanDirection(state)).toEqual({ horizontal: 1, vertical: 1 })
  setKeyboardPanKey(state, 'KeyA', true)
  expect(keyboardPanDirection(state)).toEqual({ horizontal: 0, vertical: 1 })
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

test('speed scales with the visible width within fixed bounds', () => {
  expect(keyboardPanSpeed(0)).toBe(2)
  expect(keyboardPanSpeed(20)).toBeCloseTo(13)
  expect(keyboardPanSpeed(1000)).toBe(55)
})
