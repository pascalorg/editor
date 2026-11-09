import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '../../schema'
import { SiteNode } from '../../schema/nodes/site'
import { newWallTypeId, WallTypeDefinition } from '../../schema/wall-type'
import {
  assemblyThickness,
  GYPSUM_HALF,
  getWallAssemblyPreset,
  isExteriorWallAssembly,
  projectWallTypes,
  STUCCO_3_COAT,
  STUD_2X6,
  STUD_SPACING_24,
  WALL_ASSEMBLY_PRESETS,
  WALL_FINISH_LIBRARY_REF,
  WALL_TYPE_CORES,
  WSP_SHEATHING,
  wallAssemblyFaceFinish,
  wallAssemblyFinishRef,
  wallAssemblyFraming,
  wallAssemblyPatch,
  wallAssemblyToLegacy,
  wallCladdingProducts,
  wallTypeAssembly,
  wallTypeCoreOf,
} from './wall-assembly'

const IN = 0.0254
const core = (id: string) => WALL_TYPE_CORES.find((entry) => entry.id === id)!

/** A 2x6 at 24 in stucco wall with an inch of foam outside the sheathing. */
const STUCCO_FOAM = wallTypeAssembly('custom-stucco-foam', [
  { role: 'finish', material: 'stucco', thickness: STUCCO_3_COAT },
  { role: 'insulation', material: 'rigid-foam', thickness: 1 * IN },
  { role: 'sheathing', material: 'osb', thickness: WSP_SHEATHING },
  {
    role: 'structure',
    core: true,
    material: 'wood',
    thickness: core('wood-2x6-24').thickness,
    spacing: core('wood-2x6-24').spacing,
  },
  { role: 'lining', material: 'drywall', thickness: GYPSUM_HALF },
])

function wall(assembly = getWallAssemblyPreset('exterior-2x6-siding')!.assembly, extra = {}) {
  return {
    id: 'wall_a',
    type: 'wall',
    children: [],
    start: [0, 0],
    end: [4, 0],
    frontSide: 'exterior',
    backSide: 'interior',
    ...wallAssemblyPatch(assembly),
    ...extra,
  } as unknown as WallNode
}

describe('wall type placement, read from the stack', () => {
  test('each preset lists under exterior when it has a cladding side, interior when both faces are lined', () => {
    const exterior = WALL_ASSEMBLY_PRESETS.filter((preset) =>
      isExteriorWallAssembly(preset.assembly),
    ).map((preset) => preset.id)
    expect(exterior).toEqual([
      'exterior-2x4-siding',
      'exterior-2x6-siding',
      'exterior-2x6-stucco',
      'exterior-2x6-brick',
      'exterior-cmu-stucco',
    ])
    const interior = WALL_ASSEMBLY_PRESETS.filter(
      (preset) => !isExteriorWallAssembly(preset.assembly),
    ).map((preset) => preset.id)
    // The furred block wall is drywall on both faces: a partition by its own layers.
    expect(interior).toEqual([
      'interior-2x4-drywall',
      'interior-2x6-plumbing',
      'cmu-8-furred-drywall',
    ])
  })

  test('a stack lined on one face only has an exterior side; bare on both is a partition', () => {
    const block = { role: 'structure', core: true, material: 'cmu', thickness: 0.19 } as const
    const lining = { role: 'lining', material: 'drywall', thickness: GYPSUM_HALF } as const
    expect(isExteriorWallAssembly(wallTypeAssembly('custom-a', [block, lining]))).toBe(true)
    expect(isExteriorWallAssembly(wallTypeAssembly('custom-b', [lining, block, lining]))).toBe(
      false,
    )
    expect(isExteriorWallAssembly(wallTypeAssembly('custom-c', [block]))).toBe(false)
    expect(isExteriorWallAssembly(STUCCO_FOAM)).toBe(true)
  })
})

describe('project wall types', () => {
  test('the layers set the thickness, and the core frames at its size and spacing', () => {
    const patch = wallAssemblyPatch(STUCCO_FOAM)
    const expected = STUCCO_3_COAT + 1 * IN + WSP_SHEATHING + STUD_2X6 + GYPSUM_HALF
    expect(patch.thickness).toBeCloseTo(expected, 12)
    expect(assemblyThickness(STUCCO_FOAM)).toBeCloseTo(expected, 12)
    expect(wallAssemblyFraming({ assembly: STUCCO_FOAM })).toEqual({
      depth: STUD_2X6,
      kind: 'wood',
    })
    const framing = STUCCO_FOAM.layers.find((layer) => layer.core)!
    expect(framing.spacing).toBeCloseTo(STUD_SPACING_24, 12)
    expect(wallTypeCoreOf(STUCCO_FOAM)?.id).toBe('wood-2x6-24')
  })

  test('layers take the ids the presets use, so a stack WS5 can express stays editable', () => {
    expect(STUCCO_FOAM.layers.map((layer) => layer.id)).toEqual([
      'exterior',
      'insulation',
      'sheathing',
      'framing',
      'interior',
    ])
    const plain = wallTypeAssembly('custom-plain', [
      { role: 'finish', material: 'siding', thickness: 0.75 * IN },
      { role: 'sheathing', material: 'osb', thickness: WSP_SHEATHING },
      { role: 'structure', core: true, material: 'wood', thickness: STUD_2X6 },
      { role: 'lining', material: 'drywall', thickness: GYPSUM_HALF },
    ])
    expect(wallAssemblyToLegacy(plain)?.framing.depth).toBe(STUD_2X6)
    // A preset's own core (no spacing: the framer's default) reads as the 16 in one.
    expect(wallTypeCoreOf(getWallAssemblyPreset('exterior-2x6-siding')!.assembly)?.id).toBe(
      'wood-2x6-16',
    )
    expect(wallTypeCoreOf(getWallAssemblyPreset('exterior-cmu-stucco')!.assembly)?.id).toBe('cmu-8')
  })

  test('a project type round-trips through the site schema and a save, and legacy sites are unchanged', () => {
    const id = newWallTypeId()
    expect(id).toMatch(/^custom-[a-z0-9]{16}$/)
    const type = WallTypeDefinition.parse({
      id,
      label: '2x6 stucco + foam',
      assembly: { ...STUCCO_FOAM, presetId: id },
    })
    const legacy = SiteNode.parse({ id: 'site_lot', children: ['building_house'] })
    expect(legacy.wallTypes).toBeUndefined()
    const saved = JSON.parse(JSON.stringify({ ...legacy, wallTypes: [type] }))
    const restored = SiteNode.parse(saved)
    expect(restored.wallTypes).toEqual([type])
    const nodes = { [restored.id]: restored } as unknown as Record<string, AnyNode>
    expect(projectWallTypes(nodes, [restored.id])).toEqual([type])
  })

  test('a type without a core, or with a preset-style id, does not parse; a bad saved entry is skipped', () => {
    const coreless = { ...STUCCO_FOAM, layers: STUCCO_FOAM.layers.filter((layer) => !layer.core) }
    expect(
      WallTypeDefinition.safeParse({ id: 'custom-x', label: 'X', assembly: coreless }).success,
    ).toBe(false)
    expect(
      WallTypeDefinition.safeParse({ id: 'exterior-2x6-siding', label: 'X', assembly: STUCCO_FOAM })
        .success,
    ).toBe(false)
    const good = { id: 'custom-good', label: 'Good', assembly: STUCCO_FOAM }
    const site = {
      ...SiteNode.parse({ id: 'site_lot' }),
      wallTypes: [{ id: 'custom-bad', label: '' }, good, { ...good, label: 'Repeat' }],
    }
    const nodes = { [site.id]: site } as unknown as Record<string, AnyNode>
    expect(projectWallTypes(nodes, [site.id]).map((type) => type.label)).toEqual(['Good'])
  })
})

describe('finishes picked while drafting', () => {
  const sage = 'library:siding-lap-sage'
  const blush = 'library:preset-blush'

  test('each kind offers its own products, its default among them', () => {
    for (const kind of ['siding', 'fiber-cement', 'stucco', 'brick']) {
      const ids = wallCladdingProducts(kind).map((item) => `library:${item.id}`)
      expect(ids).toContain(WALL_FINISH_LIBRARY_REF[kind]!)
    }
    expect(wallCladdingProducts('siding').every((item) => item.category === 'siding')).toBe(true)
    expect(wallCladdingProducts('brick').every((item) => item.category === 'brick')).toBe(true)
    expect(wallCladdingProducts('none')).toEqual([])
  })

  test('the faces follow the exterior side: cladding outside, paint inside, either way round', () => {
    const slots = { 'layer:exterior': sage, 'layer:interior': blush }
    const front = wall(undefined, { slots })
    expect(wallAssemblyFinishRef(front)).toBe(sage)
    expect(wallAssemblyFaceFinish(front, 'a')).toBe(sage)
    expect(wallAssemblyFaceFinish(front, 'b')).toBe(blush)
    const back = wall(undefined, { slots, frontSide: 'interior', backSide: 'exterior' })
    expect(wallAssemblyFaceFinish(back, 'a')).toBe(blush)
    expect(wallAssemblyFaceFinish(back, 'b')).toBe(sage)
    // No picks: the kind's own cladding outside, nothing inside (the slot default shows).
    const plain = wall()
    expect(wallAssemblyFaceFinish(plain, 'a')).toBe(WALL_FINISH_LIBRARY_REF.siding!)
    expect(wallAssemblyFaceFinish(plain, 'b')).toBeNull()
  })

  test('a partition shows its paint on both faces', () => {
    const partition = wall(getWallAssemblyPreset('interior-2x4-drywall')!.assembly, {
      frontSide: 'interior',
      backSide: 'interior',
      slots: { 'layer:interior-back': blush, 'layer:interior': blush },
    })
    expect(wallAssemblyFaceFinish(partition, 'a')).toBe(blush)
    expect(wallAssemblyFaceFinish(partition, 'b')).toBe(blush)
  })

  test('a product picked for siding gives way once the cladding is changed to stucco', () => {
    const changed = wall(getWallAssemblyPreset('exterior-2x6-stucco')!.assembly, {
      slots: { 'layer:exterior': sage },
    })
    expect(wallAssemblyFinishRef(changed)).toBe(WALL_FINISH_LIBRARY_REF.stucco!)
  })
})
