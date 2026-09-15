import { describe, expect, test } from 'bun:test'
import { shouldRegistryCommitSlab } from './placement-ownership'

describe('slab placement ownership', () => {
  test.each(['2d', '3d', 'split'] as const)('commits one slab in %s', (viewMode) => {
    const floorplanCommits = viewMode === '2d'
    expect(Number(floorplanCommits) + Number(shouldRegistryCommitSlab(viewMode))).toBe(1)
  })
})
