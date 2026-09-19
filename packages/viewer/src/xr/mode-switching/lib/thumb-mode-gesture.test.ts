// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import {
  advanceThumbModeGesture,
  areThumbTipsTouching,
  THUMB_TOUCH_TRIGGER_SECONDS,
} from './thumb-mode-gesture'

describe('hand-tracked player mode switching', () => {
  test('recognizes two visible touching thumb tips', () => {
    expect(
      areThumbTipsTouching(
        { visible: true, position: new Vector3(0, 0, 0) },
        { visible: true, position: new Vector3(0.02, 0, 0) },
      ),
    ).toBe(true)
  })

  test('toggles once after a held touch and rearms after release', () => {
    const state = { elapsed: 0, triggered: false }
    expect(advanceThumbModeGesture(state, true, THUMB_TOUCH_TRIGGER_SECONDS - 0.01)).toBe(false)
    expect(advanceThumbModeGesture(state, true, 0.01)).toBe(true)
    expect(advanceThumbModeGesture(state, true, 1)).toBe(false)
    advanceThumbModeGesture(state, false, 0.016)
    expect(advanceThumbModeGesture(state, true, THUMB_TOUCH_TRIGGER_SECONDS)).toBe(true)
  })
})
