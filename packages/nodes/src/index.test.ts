import { beforeEach, describe, expect, test } from 'bun:test'
import { AnyNode, loadPlugin, nodeRegistry } from '@pascal-app/core'
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
    const unionKinds = new Set(
      AnyNode.options.map((option) => {
        // zod v4: the `type` field is a literal, often wrapped in
        // ZodDefault. Unwrap to the innermost def and read its literal
        // value from `_zod.def.values` (the v3 `.value` getter is gone).
        let def = (option as unknown as { shape: Record<string, { _zod: { def: any } }> }).shape
          .type._zod.def
        while (def.innerType) {
          def = def.innerType._zod.def
        }
        return def.values?.[0] as string
      }),
    )
    const registryKinds = new Set(Array.from(nodeRegistry.entries(), ([kind]) => kind))
    const missingFromRegistry = [...unionKinds].filter((k) => !registryKinds.has(k))
    const missingFromUnion = [...registryKinds].filter((k) => !unionKinds.has(k))
    expect(missingFromRegistry).toEqual([])
    expect(missingFromUnion).toEqual([])
  })
})
