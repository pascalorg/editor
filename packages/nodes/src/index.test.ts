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

  test('loads with zero kinds today (Phase 0 — registry empty)', async () => {
    await loadPlugin(builtinPlugin)
    expect(nodeRegistry.size).toBe(0)
  })
})
