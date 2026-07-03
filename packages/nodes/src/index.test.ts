import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { AnyNode, loadPlugin, nodeRegistry } from '@pascal-app/core'
import { BufferGeometry, MeshStandardMaterial } from 'three'

mock.module('@pascal-app/viewer', () => ({
  applyMaterialPresetToMaterials: () => {},
  createDefaultMaterial: () => new MeshStandardMaterial(),
  createMaterial: (material?: { properties?: { color?: string } }) =>
    new MeshStandardMaterial({ color: material?.properties?.color ?? 0xffffff }),
  createSurfaceRoleMaterial: () => new MeshStandardMaterial(),
  DEFAULT_SHELF_MATERIAL: () => new MeshStandardMaterial({ color: 0xffffff }),
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
  SegmentedControl: () => null,
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

  test('places the warehouse shelf in the structure palette', async () => {
    await loadPlugin(builtinPlugin)
    const shelf = nodeRegistry.get('shelf')
    expect(shelf?.category).toBe('structure')
    expect(shelf?.presentation?.label).toBe('货架')
    expect(shelf?.presentation?.paletteSection).toBe('structure')
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
      'conformal-strip',
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
      'road',
      'column',
      'slab',
      'ceiling',
      'shelf',
      'item',
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

  test('wall declares editable interior and exterior material targets', async () => {
    await loadPlugin(builtinPlugin)
    expect(nodeRegistry.get('wall')?.materialTargets).toEqual([
      {
        key: 'interior',
        label: 'Interior',
        kind: 'face',
        materialKey: 'interiorMaterial',
        materialPresetKey: 'interiorMaterialPreset',
      },
      {
        key: 'exterior',
        label: 'Exterior',
        kind: 'face',
        materialKey: 'exteriorMaterial',
        materialPresetKey: 'exteriorMaterialPreset',
      },
    ])
  })

  test('roof and stair declare editable surface material targets', async () => {
    await loadPlugin(builtinPlugin)
    expect(nodeRegistry.get('roof')?.materialTargets).toEqual([
      {
        key: 'top',
        label: 'Top',
        kind: 'face',
        materialKey: 'topMaterial',
        materialPresetKey: 'topMaterialPreset',
      },
      {
        key: 'edge',
        label: 'Edge',
        kind: 'face',
        materialKey: 'edgeMaterial',
        materialPresetKey: 'edgeMaterialPreset',
      },
      {
        key: 'wall',
        label: 'Wall',
        kind: 'face',
        materialKey: 'wallMaterial',
        materialPresetKey: 'wallMaterialPreset',
      },
    ])
    expect(nodeRegistry.get('stair')?.materialTargets).toEqual([
      {
        key: 'tread',
        label: 'Tread',
        kind: 'part',
        materialKey: 'treadMaterial',
        materialPresetKey: 'treadMaterialPreset',
      },
      {
        key: 'side',
        label: 'Side',
        kind: 'part',
        materialKey: 'sideMaterial',
        materialPresetKey: 'sideMaterialPreset',
      },
      {
        key: 'railing',
        label: 'Railing',
        kind: 'part',
        materialKey: 'railingMaterial',
        materialPresetKey: 'railingMaterialPreset',
      },
    ])
  })
})
