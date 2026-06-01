import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { AnyNode, loadPlugin, nodeRegistry } from '@pascal-app/core'
import { BufferGeometry, MeshStandardMaterial } from 'three'

mock.module('@pascal-app/viewer', () => ({
  applyMaterialPresetToMaterials: () => {},
  createMaterial: () => new MeshStandardMaterial(),
  DEFAULT_SHELF_MATERIAL: new MeshStandardMaterial({ color: 0xf3f0e8 }),
  DEFAULT_SLAB_MATERIAL: new MeshStandardMaterial({ color: 0xe5e5e5 }),
  DEFAULT_STAIR_MATERIAL: new MeshStandardMaterial({ color: 0x8b7355 }),
  generateFenceGeometry: () => new BufferGeometry(),
  generateSlabGeometry: () => new BufferGeometry(),
  useViewer: () => null,
}))

mock.module('@pascal-app/editor', () => ({
  buildFloorplanStairEntry: () => null,
  buildSvgAnnularSectorPath: () => '',
  buildSvgArcPath: () => '',
  buildSvgArrowHeadPoints: () => '',
  getArcPlanPoint: () => [0, 0],
  getWallGridStep: () => 0.5,
  isWallLongEnough: () => true,
  snapFenceDraftPoint: (point: unknown) => point,
  snapPointToGrid: (point: unknown) => point,
  snapScalarToGrid: (value: number) => value,
  snapToHalf: (value: number) => Math.round(value * 2) / 2,
  snapWallDraftPoint: (point: unknown) => point,
  SliderControl: () => null,
  t: (_key: string, fallback?: string) => fallback ?? _key,
  triggerSFX: () => {},
}))

const { builtinPlugin } = await import('./index')

function nodeKindFromUnionOption(option: unknown): string {
  const shape = (option as { shape?: Record<string, unknown> }).shape
  let typeSchema = shape?.type as
    | { value?: string; values?: Set<string>; def?: { innerType?: unknown; values?: string[] } }
    | undefined

  while (typeSchema?.def?.innerType) {
    typeSchema = typeSchema.def.innerType as typeof typeSchema
  }

  if (typeof typeSchema?.value === 'string') return typeSchema.value
  if (typeSchema?.values instanceof Set) {
    const [value] = typeSchema.values
    if (typeof value === 'string') return value
  }
  const [value] = typeSchema?.def?.values ?? []
  if (typeof value === 'string') return value

  throw new Error('Unable to read AnyNode type literal from Zod option')
}

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
    const unionKinds = new Set(AnyNode.options.map(nodeKindFromUnionOption))
    const registryKinds = new Set(Array.from(nodeRegistry.entries(), ([kind]) => kind))
    const missingFromRegistry = [...unionKinds].filter((k) => !registryKinds.has(k))
    const missingFromUnion = [...registryKinds].filter((k) => !unionKinds.has(k))
    expect(missingFromRegistry).toEqual([])
    expect(missingFromUnion).toEqual([])
  })

  test('primitive and single-surface kinds declare an editable material target', async () => {
    await loadPlugin(builtinPlugin)
    const materialKinds = [
      'box',
      'cylinder',
      'cone',
      'frustum',
      'hemisphere',
      'torus',
      'wedge',
      'trapezoid-prism',
      'sphere',
      'lathe',
      'capsule',
      'half-cylinder',
      'rounded-panel',
      'extrude',
      'sweep',
      'fence',
      'column',
      'slab',
      'ceiling',
      'shelf',
    ]

    for (const kind of materialKinds) {
      expect(nodeRegistry.get(kind)?.materialTargets).toEqual([
        {
          key: 'surface',
          label: 'Overall',
          kind: 'whole',
          materialKey: 'material',
          materialPresetKey: 'materialPreset',
        },
      ])
    }
  })
})
