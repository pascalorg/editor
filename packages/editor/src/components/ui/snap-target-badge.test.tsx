import { describe, expect, test } from 'bun:test'
import { resolveAssetSnapTarget } from './snap-target-badge'

describe('resolveAssetSnapTarget', () => {
  test('maps wall-hosted catalog assets to a wall badge', () => {
    expect(resolveAssetSnapTarget('wall')).toBe('wall')
    expect(resolveAssetSnapTarget('wall-side')).toBe('wall')
  })

  test('maps ceiling-hosted catalog assets to a ceiling badge', () => {
    expect(resolveAssetSnapTarget('ceiling')).toBe('ceiling')
  })

  test('does not badge floor assets', () => {
    expect(resolveAssetSnapTarget(undefined)).toBeNull()
  })
})
