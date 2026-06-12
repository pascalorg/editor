import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { resolveAssetSnapTarget, resolveNodeSnapTarget } from './snap-target-badge'

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

describe('resolveNodeSnapTarget', () => {
  test('prefers roof attachment when a node is hosted by a roof segment', () => {
    const node = {
      id: 'window_1',
      type: 'window',
      roofSegmentId: 'roof-segment_1',
    } as unknown as AnyNode

    expect(resolveNodeSnapTarget(node)).toBe('roof')
  })

  test('badges gutter-hosted downspouts as roof accessories', () => {
    const node = {
      id: 'downspout_1',
      type: 'downspout',
      gutterId: 'gutter_1',
    } as unknown as AnyNode

    expect(resolveNodeSnapTarget(node)).toBe('roof')
  })
})
