// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { immersiveXRBackgroundColor } from './presentation-background'

describe('immersive XR background', () => {
  test('uses the scene background instead of flattening the blue zenith color', () => {
    expect(immersiveXRBackgroundColor('studio')).toBe('#fbfbfa')
  })
})
