import { describe, expect, test } from 'bun:test'
import {
  CONTINUATION_PROFILES,
  continuationContextOf,
  keyCyclableContinuationContext,
  nextContinuation,
} from './continuation'

describe('canopy continuation', () => {
  test('maps the canopy tool to its own single and continuous profile', () => {
    expect(continuationContextOf('lean-to-extension')).toBe('canopy')
    expect(CONTINUATION_PROFILES.canopy.default).toBe('single')
    expect(nextContinuation('canopy', 'single')).toBe('continuous')
    expect(nextContinuation('canopy', 'continuous')).toBe('single')
  })
})

describe('wall drawing mode', () => {
  test('is picked in the Build panel, never cycled by C or a HUD chip', () => {
    expect(CONTINUATION_PROFILES.wall.options).toEqual(['room', 'single', 'rectangle'])
    expect(keyCyclableContinuationContext('wall')).toBeNull()
  })

  test('other contexts still cycle from the keyboard', () => {
    expect(keyCyclableContinuationContext('fence')).toBe('fence')
    expect(keyCyclableContinuationContext('point')).toBe('point')
    expect(keyCyclableContinuationContext(null)).toBeNull()
  })
})
