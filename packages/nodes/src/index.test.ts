import { beforeEach, describe, expect, test } from 'bun:test'
import { AnyNode, loadPlugin, nodeKindOf, nodeRegistry } from '@pascal-app/core'
import { builtinPlugin, WallFeatureNode, wallFeatureDefinition } from './index'

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

  test('registers wall features with host ownership and host-relative data', async () => {
    await loadPlugin(builtinPlugin)
    const definition = nodeRegistry.get('wall-feature')
    expect(definition).toBe(wallFeatureDefinition)
    const node = WallFeatureNode.parse({
      ...definition?.defaults(),
      parentId: 'wall_host',
      mode: 'bump',
    })
    expect(definition?.schema.parse(node)).toEqual(node)
    expect(
      nodeRegistry.get('wall')?.schema.parse({
        start: [0, 0],
        end: [4, 0],
        children: [node.id],
      }).children,
    ).toEqual([node.id])
    expect(nodeRegistry.get('wall')?.relations?.hosts).toContain('wall-feature')
    expect(definition?.relations?.cascadeDelete).toBe('descendants')
  })

  test('opening paint reads the body material beneath slot overrides', async () => {
    await loadPlugin(builtinPlugin)
    for (const type of ['door', 'window'] as const) {
      const node = AnyNode.parse({
        type,
        wallId: 'wall_test',
        material: { properties: { color: '#123456' } },
      })
      const paint = nodeRegistry.get(type)?.capabilities?.paint
      const pick = (role: string, painted = node) =>
        paint?.getEffectiveMaterial?.({ node: painted, role, nodes: {} })
      expect(pick('frame')?.material?.properties?.color).toBe('#123456')
      if (type === 'door') expect(pick('panel')?.material?.properties?.color).toBe('#123456')
      expect(pick('glass')).toBeNull()
      expect(
        pick('frame', AnyNode.parse({ ...node, slots: { frame: '#abcdef' } }))?.material?.properties
          ?.color,
      ).toBe('#abcdef')
    }
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
})
