import { describe, expect, test } from 'bun:test'
import { shouldFollowOpeningGrid, shouldHandleOpeningHostLeave } from './opening-grid-follow'

describe('opening grid free-follow', () => {
  test('keeps an active wall preview when XR also emits a floor move', () => {
    expect(
      shouldFollowOpeningGrid({
        eventTime: 20,
        hasActiveHost: true,
        lastHostEventTime: 10,
        pointerType: 'xr',
      }),
    ).toBe(false)
  })

  test('follows the XR grid again after leaving the host', () => {
    expect(
      shouldFollowOpeningGrid({
        eventTime: 20,
        hasActiveHost: false,
        lastHostEventTime: 10,
        pointerType: 'xr',
      }),
    ).toBe(true)
  })

  test('preserves desktop same-event arbitration', () => {
    expect(
      shouldFollowOpeningGrid({
        eventTime: 10,
        hasActiveHost: true,
        lastHostEventTime: 10,
        pointerType: 'mouse',
      }),
    ).toBe(false)
    expect(
      shouldFollowOpeningGrid({
        eventTime: 20,
        hasActiveHost: true,
        lastHostEventTime: 10,
        pointerType: 'mouse',
      }),
    ).toBe(true)
  })

  test('lets the XR bridge, rather than competing pointer leaves, end the host preview', () => {
    const inputSource = {}
    expect(shouldHandleOpeningHostLeave({ inputSource })).toBe(false)
    expect(shouldHandleOpeningHostLeave({ pointerState: { inputSource } })).toBe(false)
    expect(shouldHandleOpeningHostLeave({ inputSource, openingHoverBridge: true })).toBe(true)
    expect(shouldHandleOpeningHostLeave({ pointerType: 'mouse' })).toBe(true)
  })
})
