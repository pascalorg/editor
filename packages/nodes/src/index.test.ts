import { beforeEach, describe, expect, test } from 'bun:test'
import { AnyNode, floorPlacedConfig, loadPlugin, nodeKindOf, nodeRegistry } from '@pascal-app/core'
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
    expect(nodeRegistry.has('shelf')).toBe(true)
    expect(nodeRegistry.size).toBeGreaterThanOrEqual(1)
  })

  test('every AnyNode discriminator is registered in builtinPlugin', async () => {
    // Phase 6 coverage check. The `AnyNode` discriminated union and the
    // `builtinPlugin.nodes` array are both hand-maintained today (full
    // codegen would have to run at module-load time, which loses the
    // static node typing TypeScript relies on). This test makes drift a
    // CI failure: every node `type` literal in the union must have a
    // matching `def.kind` in the plugin, and vice versa.
    //
    // When a kind is added: append it to both `core/src/schema/types.ts`
    // (the union) and `nodes/src/index.ts` (the plugin), and this test
    // will keep them honest.
    await loadPlugin(builtinPlugin)
    const unionKinds = new Set(AnyNode.options.map(nodeKindOf))
    const registryKinds = new Set(Array.from(nodeRegistry.entries(), ([kind]) => kind))
    const missingFromRegistry = [...unionKinds].filter((k) => !registryKinds.has(k))
    const missingFromUnion = [...registryKinds].filter((k) => !unionKinds.has(k))
    expect(missingFromRegistry).toEqual([])
    expect(missingFromUnion).toEqual([])
  })
  test('headless floor lift uses the same floorPlaced capability as each definition', () => {
    // With the registry empty, as in MCP and the hosted scene API, core's
    // nodeLevelFrame reads floorPlacedConfig. Item-like kinds get their box
    // footprint from core's own query path instead.
    const itemLike = new Set(['item', 'shelf', 'cabinet', 'cabinet-module', 'procedural-item'])
    const drifted = (builtinPlugin.nodes ?? [])
      .filter((def) => def.capabilities.floorPlaced && !itemLike.has(def.kind))
      .filter((def) => floorPlacedConfig(def.kind) !== def.capabilities.floorPlaced)
      .map((def) => def.kind)
    expect(drifted).toEqual([])
  })
})
