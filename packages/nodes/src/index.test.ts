import { beforeEach, describe, expect, test } from 'bun:test'
import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { builtinPlugin } from './index'

describe('builtinPlugin', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('has the expected manifest shape', () => {
    expect(builtinPlugin.id).toBe('pascal:core')
    expect(builtinPlugin.apiVersion).toBe(1)
    expect(Array.isArray(builtinPlugin.nodes)).toBe(true)
  })

  test('loads the registered kinds without error', async () => {
    await loadPlugin(builtinPlugin)
    // Phase 2 registers shelf unconditionally; spawn is flag-gated. So the
    // registry should always contain shelf, and may contain spawn depending
    // on the NEXT_PUBLIC_USE_REGISTRY_FOR_SPAWN env value at module load.
    expect(nodeRegistry.has('shelf')).toBe(true)
    expect(nodeRegistry.size).toBeGreaterThanOrEqual(1)
  })
})
