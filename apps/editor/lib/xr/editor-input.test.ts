import { describe, expect, test } from 'bun:test'
import {
  didXRButtonPressStart,
  isXRCancelPressed,
  selectPrimaryXRInputSource,
} from './editor-input'

function inputSource({
  button5 = false,
  handedness,
  targetRayMode = 'tracked-pointer',
}: {
  button5?: boolean
  handedness: XRHandedness
  targetRayMode?: XRTargetRayMode
}): XRInputSource {
  return {
    gamepad: { buttons: [{}, {}, {}, {}, {}, { pressed: button5 }] },
    handedness,
    targetRayMode,
  } as unknown as XRInputSource
}

describe('XR editor input routing', () => {
  test('keeps the input source that owns the active press', () => {
    const left = inputSource({ handedness: 'left' })
    const right = inputSource({ handedness: 'right' })
    expect(selectPrimaryXRInputSource([left, right], left)).toBe(left)
  })

  test('prefers the right tracked pointer while idle', () => {
    const left = inputSource({ handedness: 'left' })
    const right = inputSource({ handedness: 'right' })
    expect(selectPrimaryXRInputSource([left, right])).toBe(right)
  })

  test('maps the right controller B button to cancel on its rising edge', () => {
    const right = inputSource({ button5: true, handedness: 'right' })
    expect(isXRCancelPressed([right])).toBe(true)
    expect(didXRButtonPressStart(false, true)).toBe(true)
    expect(didXRButtonPressStart(true, true)).toBe(false)
  })
})
