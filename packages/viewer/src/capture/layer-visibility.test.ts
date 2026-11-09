import { describe, expect, test } from 'bun:test'
import {
  isCaptureLayerVisible,
  isCaptureSessionVisible,
  isCaptureStreamVisible,
} from './layer-visibility'

describe('isCaptureLayerVisible', () => {
  test('keeps capture layers visible when the host has no default', () => {
    expect(isCaptureLayerVisible({}, 'pointCloud')).toBe(true)
  })

  test('uses the host default for an unset layer', () => {
    expect(isCaptureLayerVisible({}, 'pointCloud', { pointCloud: false })).toBe(false)
  })

  test('lets persisted scene visibility override the host default', () => {
    expect(isCaptureLayerVisible({ pointCloud: true }, 'pointCloud', { pointCloud: false })).toBe(
      true,
    )
    expect(isCaptureLayerVisible({ model: false }, 'model', { model: true })).toBe(false)
  })
})

describe('isCaptureStreamVisible', () => {
  test('resolves a stream through its capture layer', () => {
    const stream = {
      id: 'points',
      kind: 'point-cloud',
      role: 'pointCloud',
      availability: 'ready',
    } as const

    expect(isCaptureStreamVisible(stream, {}, { pointCloud: false })).toBe(false)
    expect(isCaptureStreamVisible(stream, { pointCloud: true }, { pointCloud: false })).toBe(true)
  })
})

describe('isCaptureSessionVisible', () => {
  test('requires both the global scan display and node visibility', () => {
    expect(isCaptureSessionVisible(true, true)).toBe(true)
    expect(isCaptureSessionVisible(false, true)).toBe(false)
    expect(isCaptureSessionVisible(true, false)).toBe(false)
  })
})
