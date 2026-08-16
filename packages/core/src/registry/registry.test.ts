import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  getHostRefFields,
  getInspectorExtensions,
  getNodePluginId,
  isDrawnViaTool,
  isDrawnViaToolKind,
  isNodeKindEnabled,
  isPresettable,
  isPresettableKind,
  loadPlugin,
  nodeRegistry,
  registerNode,
} from './registry'
import type { AnyNodeDefinition, InspectorExtension, Plugin } from './types'

// Re-registering a kind warns + replaces in dev (HMR) but throws in
// production — see `registry._register`. `bun test` runs with
// NODE_ENV=test (dev path), so the throw-path tests pin NODE_ENV to
// 'production' for the duration of the call.
async function inProduction<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    return await fn()
  } finally {
    process.env.NODE_ENV = prev
  }
}

function makeDefinition(
  kind: string,
  overrides: Partial<AnyNodeDefinition> = {},
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as any,
    category: 'utility',
    defaults: () => ({}) as any,
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

  test('registerNode throws on duplicate kind in production', async () => {
    await inProduction(() => {
      registerNode(makeDefinition('column'))
      expect(() => registerNode(makeDefinition('column'))).toThrow(/duplicate node kind/)
    })
  })

  test('registerNode replaces on duplicate kind in dev (HMR)', () => {
    const first = makeDefinition('column')
    const second = makeDefinition('column')
    registerNode(first)
    registerNode(second)
    expect(nodeRegistry.size).toBe(1)
    expect(nodeRegistry.get('column')).toBe(second)
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

describe('isPresettable', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('explicit true wins', () => {
    const def = makeDefinition('explicit-true', { capabilities: { presettable: true } })
    expect(isPresettable(def)).toBe(true)
  })

  test('explicit false wins even with parametrics', () => {
    const def = makeDefinition('explicit-false', {
      capabilities: { presettable: false },
      parametrics: { groups: [] } as any,
    })
    expect(isPresettable(def)).toBe(false)
  })

  test('defaults to true when parametrics exists', () => {
    const def = makeDefinition('param', { parametrics: { groups: [] } as any })
    expect(isPresettable(def)).toBe(true)
  })

  test('defaults to false without parametrics', () => {
    const def = makeDefinition('no-param')
    expect(isPresettable(def)).toBe(false)
  })

  test('isPresettableKind looks up the registry', () => {
    registerNode(makeDefinition('shelfy', { parametrics: { groups: [] } as any }))
    expect(isPresettableKind('shelfy')).toBe(true)
    expect(isPresettableKind('unknown')).toBe(false)
  })
})

describe('getHostRefFields', () => {
  test('returns the declared hostRefFields verbatim', () => {
    const def = makeDefinition('door', { capabilities: { hostRefFields: ['wallId'] } })
    expect(getHostRefFields(def)).toEqual(['wallId'])
  })

  test('defaults to an empty array when none declared', () => {
    const def = makeDefinition('shelf')
    expect(getHostRefFields(def)).toEqual([])
  })
})

describe('isDrawnViaTool', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('true when capability set', () => {
    const def = makeDefinition('fence', { capabilities: { drawTool: true } })
    expect(isDrawnViaTool(def)).toBe(true)
  })

  test('false when unset or not exactly true', () => {
    expect(isDrawnViaTool(makeDefinition('column'))).toBe(false)
    expect(isDrawnViaTool(makeDefinition('off', { capabilities: { drawTool: false } }))).toBe(false)
  })

  test('isDrawnViaToolKind looks up the registry', () => {
    registerNode(makeDefinition('fence', { capabilities: { drawTool: true } }))
    expect(isDrawnViaToolKind('fence')).toBe(true)
    expect(isDrawnViaToolKind('unknown')).toBe(false)
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
    expect(getNodePluginId('a')).toBe('test:plugin')
    expect(getNodePluginId('b')).toBe('test:plugin')
  })

  test('enables plugin kinds only when the project has the plugin installed', async () => {
    await loadPlugin({ id: 'test:plugin', apiVersion: 1, nodes: [makeDefinition('plugin:node')] })

    expect(isNodeKindEnabled('plugin:node', [])).toBe(false)
    expect(isNodeKindEnabled('plugin:node', ['test:plugin'])).toBe(true)
    expect(isNodeKindEnabled('plugin:node')).toBe(true)
    expect(isNodeKindEnabled('host:node', [])).toBe(true)
  })

  test('keeps built-in plugin kinds enabled independently of project installs', async () => {
    await loadPlugin({ id: 'pascal:core', apiVersion: 1, nodes: [makeDefinition('wall')] })

    expect(isNodeKindEnabled('wall', [])).toBe(true)
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
    const plugin = {
      id: 'old-plugin',
      apiVersion: 99 as unknown as 1,
      nodes: [],
    }
    await expect(loadPlugin(plugin)).rejects.toThrow(/apiVersion/)
  })

  test('propagates duplicate-kind error from a single plugin in production', async () => {
    const plugin: Plugin = {
      id: 'broken',
      apiVersion: 1,
      nodes: [makeDefinition('dup'), makeDefinition('dup')],
    }
    await inProduction(() => expect(loadPlugin(plugin)).rejects.toThrow(/duplicate node kind/))
  })

  test('propagates duplicate-kind error across plugins in production', async () => {
    await inProduction(async () => {
      await loadPlugin({ id: 'a', apiVersion: 1, nodes: [makeDefinition('shared')] })
      await expect(
        loadPlugin({ id: 'b', apiVersion: 1, nodes: [makeDefinition('shared')] }),
      ).rejects.toThrow(/duplicate node kind/)
    })
  })

  // GATE (late-plugin subscriptions): plugins register via async dynamic
  // imports AFTER consumers mount. The selection managers rebuild their
  // `getSelectableKinds()` emitter subscriptions off this change signal —
  // without it, a plugin kind selects but never hovers in prod (the outline
  // subscription list froze pre-registration).
  test('registerNode bumps the registry version and notifies subscribers', async () => {
    const { getRegistryVersion, onRegistryChange } = await import('./registry')
    const before = getRegistryVersion()
    let notified = 0
    const unsubscribe = onRegistryChange(() => {
      notified += 1
    })

    registerNode(makeDefinition('late:kind', { capabilities: { selectable: {} } }))
    expect(getRegistryVersion()).toBe(before + 1)
    expect(notified).toBe(1)

    // A consumer re-deriving on the notification now sees the new kind.
    const { getSelectableKinds } = await import('./registry')
    expect(getSelectableKinds()).toContain('late:kind')

    unsubscribe()
    registerNode(makeDefinition('late:kind-2'))
    expect(getRegistryVersion()).toBe(before + 2)
    expect(notified).toBe(1) // unsubscribed — no further calls
  })

  test('loadPlugin notifies once per registered kind', async () => {
    const { getRegistryVersion } = await import('./registry')
    const before = getRegistryVersion()
    await loadPlugin({
      id: 'pack',
      apiVersion: 1,
      nodes: [makeDefinition('pack:a'), makeDefinition('pack:b')],
    })
    expect(getRegistryVersion()).toBe(before + 2)
  })
})

describe('inspector extensions', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  function makeExtension(
    id: string,
    kinds: string[],
    overrides: Partial<InspectorExtension> = {},
  ): InspectorExtension {
    return {
      id,
      pluginId: 'test:plugin',
      kinds,
      icon: { kind: 'url', src: '/icons/test.png' },
      title: 'Engineering',
      component: async () => ({ default: () => null }),
      ...overrides,
    }
  }

  test('starts empty for any kind', () => {
    expect(getInspectorExtensions('wall')).toEqual([])
  })

  test('loadPlugin registers extensions under each declared kind', async () => {
    const extension = makeExtension('test:plugin:eng', ['wall', 'slab'])
    await loadPlugin({ id: 'test:plugin', apiVersion: 1, inspectorExtensions: [extension] })

    expect(getInspectorExtensions('wall')).toEqual([extension])
    expect(getInspectorExtensions('slab')).toEqual([extension])
    expect(getInspectorExtensions('roof')).toEqual([])
  })

  test('extensions from separate plugins accumulate in load order', async () => {
    const a = makeExtension('a:eng', ['wall'], { pluginId: 'a' })
    const b = makeExtension('b:eng', ['wall'], { pluginId: 'b' })
    await loadPlugin({ id: 'a', apiVersion: 1, inspectorExtensions: [a] })
    await loadPlugin({ id: 'b', apiVersion: 1, inspectorExtensions: [b] })

    expect(getInspectorExtensions('wall')).toEqual([a, b])
  })

  test('re-registering the same extension id replaces in place (HMR)', async () => {
    const first = makeExtension('test:plugin:eng', ['wall'])
    const second = makeExtension('test:plugin:eng', ['wall'], { title: 'Engineering v2' })
    await loadPlugin({ id: 'test:plugin', apiVersion: 1, inspectorExtensions: [first] })
    await loadPlugin({ id: 'test:plugin', apiVersion: 1, inspectorExtensions: [second] })

    const registered = getInspectorExtensions('wall')
    expect(registered).toHaveLength(1)
    expect(registered[0]?.title).toBe('Engineering v2')
  })

  // GATE (late-plugin inspector sections): the inspector card derives its
  // extension list at render time — without a version bump for a plugin
  // that ships ONLY extensions (no node kinds), a late load would never
  // re-render the open card and the section would silently not appear.
  test('registering extensions bumps the registry version', async () => {
    const { getRegistryVersion } = await import('./registry')
    const before = getRegistryVersion()
    await loadPlugin({
      id: 'test:plugin',
      apiVersion: 1,
      inspectorExtensions: [makeExtension('test:plugin:eng', ['wall'])],
    })
    expect(getRegistryVersion()).toBeGreaterThan(before)
  })

  test('_reset clears registered extensions', async () => {
    await loadPlugin({
      id: 'test:plugin',
      apiVersion: 1,
      inspectorExtensions: [makeExtension('test:plugin:eng', ['wall'])],
    })
    expect(getInspectorExtensions('wall')).toHaveLength(1)
    nodeRegistry._reset()
    expect(getInspectorExtensions('wall')).toEqual([])
  })
})
