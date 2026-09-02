import { describe, expect, test } from 'bun:test'
import {
  didXRButtonPressStart,
  isXRCancelPressed,
  pulseXRInputSource,
  resolveXRReleaseAction,
  selectPrimaryXRInputSource,
  shouldReleaseCapturedXRInput,
  shouldRouteXRMove,
  XRSelectReleaseGuard,
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
  test('defers empty-space deselection until node click listeners have run', async () => {
    const right = inputSource({ handedness: 'right' })
    const guard = new XRSelectReleaseGuard()
    let deselections = 0

    guard.start(right)
    guard.deferEmptyRelease(right, () => deselections++)
    guard.markNodeClick(right)
    await Promise.resolve()
    expect(deselections).toBe(0)

    guard.start(right)
    guard.deferEmptyRelease(right, () => deselections++)
    await Promise.resolve()
    expect(deselections).toBe(1)
  })

  test('cancels deferred deselection and keeps input-source cycles isolated', async () => {
    const left = inputSource({ handedness: 'left' })
    const right = inputSource({ handedness: 'right' })
    const guard = new XRSelectReleaseGuard()
    let deselections = 0

    guard.start(right)
    guard.deferEmptyRelease(right, () => deselections++)
    guard.cancel(right)
    await Promise.resolve()
    expect(deselections).toBe(0)

    guard.start(right)
    guard.deferEmptyRelease(right, () => deselections++)
    guard.markNodeClick(left)
    await Promise.resolve()
    expect(deselections).toBe(1)
  })

  test('routes select, tool, and drag releases without cross-triggering deselection', () => {
    expect(
      resolveXRReleaseAction({ mode: 'select', placementDrag: false, scopeKind: 'idle' }),
    ).toBe('defer-empty-selection')
    expect(
      resolveXRReleaseAction({ mode: 'select', placementDrag: false, scopeKind: 'handle-drag' }),
    ).toBe('ignore')
    expect(resolveXRReleaseAction({ mode: 'build', placementDrag: false, scopeKind: 'idle' })).toBe(
      'emit-tool-grid-click',
    )
    expect(resolveXRReleaseAction({ mode: 'select', placementDrag: true, scopeKind: 'idle' })).toBe(
      'finish-placement-drag',
    )
  })

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

  test('keeps a captured drag moving even when it crosses the wand panel', () => {
    const left = inputSource({ handedness: 'left' })
    expect(shouldRouteXRMove(left, left, true)).toBe(true)
    expect(shouldRouteXRMove(left, null, true)).toBe(false)
    expect(shouldRouteXRMove(left, null, false)).toBe(true)
  })

  test('releases a captured source after it disconnects', () => {
    const left = inputSource({ handedness: 'left' })
    const right = inputSource({ handedness: 'right' })
    expect(shouldReleaseCapturedXRInput([left, right], left)).toBe(false)
    expect(shouldReleaseCapturedXRInput([right], left)).toBe(true)
    expect(shouldReleaseCapturedXRInput([right], null)).toBe(false)
  })

  test('pulses supported haptics and ignores unsupported input sources', async () => {
    const pulse = async () => true
    const supported = {
      gamepad: { hapticActuators: [{ pulse }] },
    } as unknown as XRInputSource
    const unsupported = { gamepad: { buttons: [] } } as unknown as XRInputSource

    expect(pulseXRInputSource(supported)).toBe(true)
    expect(pulseXRInputSource(unsupported)).toBe(false)
  })
})
