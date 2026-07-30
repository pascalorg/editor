import { describe, expect, test } from 'bun:test'
import { shouldRegistryCommitCeiling } from './placement-ownership'

function ceilingCreatorCount(viewMode: '2d' | '3d' | 'split'): number {
  const floorplanCommits = viewMode === '2d'
  const registryCommits = shouldRegistryCommitCeiling(viewMode)
  return Number(floorplanCommits) + Number(registryCommits)
}

describe('ceiling placement ownership', () => {
  test.each(['2d', '3d', 'split'] as const)('commits one ceiling in %s', (viewMode) => {
    expect(ceilingCreatorCount(viewMode)).toBe(1)
  })
})
