import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { coerce } from '../test-utils'
import { loadPlugin, nodeRegistry, registerNode } from './registry'
import type { AnyNodeDefinition, Plugin } from './types'

function makeDefinition(
  kind: string,
  overrides: Partial<AnyNodeDefinition> = {},
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }),
    category: 'utility',
    defaults: () => ({}),
    capabilities: {},
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
    ...overrides,
  }
}

describe('nodeRegistry', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('starts empty', () => {
    expect(nodeRegistry.size).toBe(0)
    expect(nodeRegistry.has('anything')).toBe(false)
    expect(nodeRegistry.get('anything')).toBeUndefined()
  })

  test('registerNode adds a definition', () => {
    const def = makeDefinition('column')
    registerNode(def)
    expect(nodeRegistry.size).toBe(1)
    expect(nodeRegistry.has('column')).toBe(true)
    expect(nodeRegistry.get('column')).toBe(def)
  })

  test('registerNode throws on duplicate kind', () => {
    registerNode(makeDefinition('column'))
    expect(() => registerNode(makeDefinition('column'))).toThrow(/duplicate node kind/)
  })

  test('registerNode rejects empty kind', () => {
    expect(() => registerNode(makeDefinition(''))).toThrow(/non-empty string/)
  })

  test('registerNode rejects invalid schemaVersion', () => {
    expect(() => registerNode(makeDefinition('bad', { schemaVersion: 0 }))).toThrow(/schemaVersion/)
    expect(() => registerNode(makeDefinition('bad', { schemaVersion: -1 }))).toThrow(
      /schemaVersion/,
    )
  })

  test('entries() iterates registered definitions', () => {
    registerNode(makeDefinition('a'))
    registerNode(makeDefinition('b'))
    const kinds = Array.from(nodeRegistry.entries(), ([k]) => k)
    expect(kinds).toEqual(['a', 'b'])
  })

  test('schemas() returns all registered schemas', () => {
    const a = makeDefinition('a')
    const b = makeDefinition('b')
    registerNode(a)
    registerNode(b)
    expect(nodeRegistry.schemas()).toEqual([a.schema, b.schema])
  })
})

describe('loadPlugin', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('registers all nodes from a plugin', async () => {
    const plugin: Plugin = {
      id: 'test:plugin',
      apiVersion: 1,
      nodes: [makeDefinition('a'), makeDefinition('b')],
    }
    await loadPlugin(plugin)
    expect(nodeRegistry.size).toBe(2)
    expect(nodeRegistry.has('a')).toBe(true)
    expect(nodeRegistry.has('b')).toBe(true)
  })

  test('handles plugin with no nodes', async () => {
    await loadPlugin({ id: 'empty', apiVersion: 1 })
    expect(nodeRegistry.size).toBe(0)
  })

  test('handles plugin with empty nodes array', async () => {
    await loadPlugin({ id: 'empty', apiVersion: 1, nodes: [] })
    expect(nodeRegistry.size).toBe(0)
  })

  test('throws on apiVersion mismatch', async () => {
    const plugin = coerce<Plugin>({
      id: 'old-plugin',
      apiVersion: 99,
      nodes: [],
    })
    await expect(loadPlugin(plugin)).rejects.toThrow(/apiVersion/)
  })

  test('propagates duplicate-kind error from a single plugin', async () => {
    const plugin: Plugin = {
      id: 'broken',
      apiVersion: 1,
      nodes: [makeDefinition('dup'), makeDefinition('dup')],
    }
    await expect(loadPlugin(plugin)).rejects.toThrow(/duplicate node kind/)
  })

  test('propagates duplicate-kind error across plugins', async () => {
    await loadPlugin({ id: 'a', apiVersion: 1, nodes: [makeDefinition('shared')] })
    await expect(
      loadPlugin({ id: 'b', apiVersion: 1, nodes: [makeDefinition('shared')] }),
    ).rejects.toThrow(/duplicate node kind/)
  })
})
