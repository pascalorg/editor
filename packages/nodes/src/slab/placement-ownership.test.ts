import { describe, expect, test } from 'bun:test'
import { type SlabCompletionTrigger, shouldRegistryCommitSlab } from './placement-ownership'

function slabCreatorCount(viewMode: '2d' | '3d' | 'split', trigger: SlabCompletionTrigger): number {
  const floorplanCommits = viewMode === '2d' && trigger === 'grid'
  const registryCommits = shouldRegistryCommitSlab(viewMode, trigger)
  return Number(floorplanCommits) + Number(registryCommits)
}

describe('slab placement ownership', () => {
  test.each([
    ['2d', 'grid'],
    ['2d', 'keyboard'],
    ['3d', 'grid'],
    ['split', 'grid'],
  ] as const)('commits one slab in %s from %s completion', (viewMode, trigger) => {
    expect(slabCreatorCount(viewMode, trigger)).toBe(1)
  })
})
