import { describe, expect, test } from 'bun:test'
import { CONTINUATION_PROFILES, continuationContextOf, nextContinuation } from './continuation'

describe('canopy continuation', () => {
  test('maps the canopy tool to its own single and continuous profile', () => {
    expect(continuationContextOf('lean-to-extension')).toBe('canopy')
    expect(CONTINUATION_PROFILES.canopy.default).toBe('single')
    expect(nextContinuation('canopy', 'single')).toBe('continuous')
    expect(nextContinuation('canopy', 'continuous')).toBe('single')
  })
})
