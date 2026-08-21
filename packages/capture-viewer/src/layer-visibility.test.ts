import { describe, expect, test } from 'bun:test'
import { isCaptureLayerVisible } from './layer-visibility'

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
