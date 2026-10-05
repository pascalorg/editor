/**
 * F2 assembly layers, executable examples.
 *
 * The contract: the schema, the host declarations and the band math. The
 * stack sets the body: a wall's `thickness` is the sum of its layers (WS5's
 * rule). Wall and roof rendering must reproduce these numbers; the fixtures
 * pin the stacking datum against explicit layer boundaries.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { resolveAssemblyStack } from '../lib/assembly-stack'
import { Assembly, type AssemblyLayer } from '../schema/assembly'
import { RoofNode } from '../schema/nodes/roof'
import { WallNode } from '../schema/nodes/wall'
import { parseSourceRef } from '../schema/source-ref'
import { getWallPlanFootprint } from '../systems/wall/wall-footprint'
import { getWallLayerBands } from '../systems/wall/wall-layer-bands'
import { calculateLevelMiters } from '../systems/wall/wall-mitering'
import { EXISTING_REFERENCES } from './reference-inventory'

const close = (actual: number, expected: number, digits = 9) =>
  expect(actual).toBeCloseTo(expected, digits)

type Band = { back: number; front: number }
const bandsOf = (wall: WallNode, assembly: Assembly) =>
  getWallLayerBands(wall, assembly, calculateLevelMiters([wall]))

describe('a stucco exterior wall (2×6 frame)', () => {
  const assembly = Assembly.parse({
    layers: [
      { id: 'drywall', role: 'lining', thickness: 0.0127, material: 'drywall' },
      { id: 'studs', role: 'structure', thickness: 0.1397, core: true, material: 'wood' },
      { id: 'sheathing', role: 'sheathing', thickness: 0.0111, material: 'osb' },
      {
        id: 'stucco',
        role: 'finish',
        thickness: 0.0222,
        material: 'stucco',
        src: 'ex:wall-01/outside-finish',
      },
    ],
  })
  const wall = WallNode.parse({
    id: 'wall_stucco',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1857,
    frontSide: 'interior',
    backSide: 'exterior',
  })

  test('the stack sets the body: the layers sum to the wall thickness', () => {
    // A wall stores its body as `thickness`.
    const stack = resolveAssemblyStack(assembly, { body: wall.thickness! })
    expect(stack.diagnostics).toEqual([])
    expect(stack.layers.map((layer) => [layer.id, layer.depth, layer.thickness])).toEqual([
      ['drywall', 0, 0.0127],
      ['studs', 0.0127, 0.1397],
      ['sheathing', expect.closeTo(0.1524, 12), 0.0111],
      ['stucco', expect.closeTo(0.1635, 12), 0.0222],
    ])
    close(stack.total, 0.1857)
    expect(stack.layers[1]!.core).toBe(true)
    expect(stack.layers[3]!.src).toBe('ex:wall-01/outside-finish')
  })

  test('bands: the front face (+n, interior) is +thickness/2; the stucco is the back skin', () => {
    const { bands } = bandsOf(wall, assembly)
    const faces = Object.fromEntries(bands.map((band) => [band.layerId, band])) as Record<
      string,
      Band
    >
    close(faces.drywall!.front, 0.09285)
    close(faces.studs!.front, 0.08015)
    close(faces.studs!.back, -0.05955)
    close(faces.sheathing!.back, -0.07065)
    close(faces.stucco!.back, -0.09285)
    // The stucco band in plan: the wall runs +x, so +n is +y and the band is y ∈ [−0.09285, −0.07065].
    const stucco = bands.find((band) => band.layerId === 'stucco')!.polygons
    expect(stucco).toHaveLength(1)
    const ys = stucco[0]!.map((point) => point.y)
    close(Math.min(...ys), -0.09285)
    close(Math.max(...ys), -0.07065)
  })

  test('face: exterior lists the stack from the outside, whichever side that is', () => {
    const outsideIn = Assembly.parse({
      ...assembly,
      layers: [...assembly.layers].reverse(),
      face: 'exterior',
    })
    const at = (side: Partial<WallNode>) => {
      const faced = WallNode.parse({ ...wall, ...side })
      return Object.fromEntries(bandsOf(faced, outsideIn).bands.map((b) => [b.layerId, b]))
    }
    // Exterior on the back: the same bands as the front-listed stack.
    close(at({})['stucco']!.back, -0.09285)
    // Rooms re-detected with the exterior on the front: the stucco follows it.
    close(at({ frontSide: 'exterior', backSide: 'interior' })['stucco']!.front, 0.09285)
    // Undetermined sides fall back to side B, where the 3D cladding goes.
    close(at({ frontSide: 'unknown', backSide: 'unknown' })['stucco']!.back, -0.09285)
  })

  test('a stored thickness that is not the layer sum is reported, and draws no bands', () => {
    const stale = WallNode.parse({ ...wall, thickness: 0.2 })
    const result = bandsOf(stale, assembly)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['assembly.thickness-mismatch'])
    expect(result.bands).toEqual([])
    close(result.total, 0.1857)
  })
})

describe('a shingle roof (covering, underlay, sheathing)', () => {
  // The covering, underlay and decking form one contiguous stack.
  const roof = RoofNode.parse({
    id: 'roof_shingle',
    assembly: {
      layers: [
        { id: 'covering', role: 'covering', thickness: 0.009 },
        { id: 'underlay', role: 'underlay', thickness: 0.001 },
        { id: 'sheathing', role: 'sheathing', thickness: 0.015875 },
      ],
    },
  })

  test('one contiguous stack inward from the covering-top plane; the body is the sum', () => {
    // A roof stores no body thickness.
    const stack = resolveAssemblyStack(roof.assembly!, { body: null })
    expect(stack.diagnostics).toEqual([])
    expect(stack.layers.map((layer) => [layer.id, layer.depth])).toEqual([
      ['covering', 0],
      ['underlay', 0.009],
      ['sheathing', expect.closeTo(0.01, 12)],
    ])
    close(stack.total, 0.025875)
  })

  test('measured along the facet normal: a 40° facet cuts each layer 1/cos(40°) tall', () => {
    // The direct path splits the vertical prism: a layer t thick along the
    // normal spans t / cos(pitch) of the vertical.
    const stack = resolveAssemblyStack(roof.assembly!, { body: null })
    const vertical = (t: number) => t / Math.cos((40 * Math.PI) / 180)
    close(vertical(stack.layers[2]!.thickness), 0.020723, 6)
    close(vertical(stack.total), 0.033777, 6)
  })
})

describe('an absent assembly is byte-identical', () => {
  test('roofs without the field parse exactly as before', () => {
    // The schema as it was: the same fields, without `assembly`.
    const before = z.object(
      Object.fromEntries(Object.entries(RoofNode.shape).filter(([key]) => key !== 'assembly')),
    )
    const legacyRoof = { id: 'roof_legacy' }
    expect(JSON.stringify(RoofNode.parse(legacyRoof))).toBe(
      JSON.stringify(before.parse(legacyRoof)),
    )
    expect('assembly' in RoofNode.parse(legacyRoof)).toBe(false)
  })
})

describe('the schema refuses ambiguous stacks', () => {
  const layer = (id: string, extra: Partial<AssemblyLayer> = {}): AssemblyLayer => ({
    id,
    role: 'finish',
    thickness: 0.01,
    ...extra,
  })
  const issues = (value: unknown) =>
    Assembly.safeParse(value).error?.issues.map((issue) => issue.path.join('.')) ?? []

  test('ids are unique across body and backing, and address-safe', () => {
    expect(issues({ layers: [layer('a'), layer('a')] })).toEqual(['layers.1.id'])
    expect(issues({ layers: [layer('a')], backing: [layer('a')] })).toEqual(['backing.0.id'])
    expect(issues({ layers: [layer('finish#ext')] })).toEqual(['layers.0.id'])
    expect(issues({ layers: [layer('x'.repeat(41))] })).toEqual(['layers.0.id'])
  })

  test('one core, in the body only; backing-only fields stay in backing', () => {
    const structure = { role: 'structure', core: true } as const
    expect(issues({ layers: [layer('a', structure), layer('b', structure)] })).toEqual([
      'layers.1.core',
    ])
    expect(issues({ layers: [layer('a')], backing: [layer('b', structure)] })).toEqual([
      'backing.0.core',
    ])
    expect(issues({ layers: [layer('a', { inset: 0.1, lift: 0.2 })] })).toEqual([
      'layers.0.inset',
      'layers.0.lift',
    ])
    expect(issues({ layers: [layer('a')], backing: [layer('b', { inset: 0.1 })] })).toEqual([])
  })

  test('bounds: finite nonnegative thickness and bounded layer counts', () => {
    expect(issues({ layers: [] })).toEqual(['layers'])
    expect(issues({ layers: Array.from({ length: 13 }, (_, i) => layer(`l${i}`)) })).toEqual([
      'layers',
    ])
    for (const thickness of [0, 5.001, 100]) {
      expect(issues({ layers: [layer('a', { thickness })] })).toEqual([])
    }
    for (const thickness of [-0.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(issues({ layers: [layer('a', { thickness })] })).toEqual(['layers.0.thickness'])
    }
    expect(
      issues({ layers: [], backing: Array.from({ length: 9 }, (_, i) => layer(`b${i}`)) }),
    ).toEqual(['backing'])
  })

  test('preset and insulation fields preserve empty text but reject other types', () => {
    for (const field of ['presetId', 'cavityInsulation']) {
      expect(issues({ layers: [layer('a')], [field]: '' })).toEqual([])
      expect(issues({ layers: [layer('a')], [field]: 123 })).toEqual([field])
    }
  })
})

describe('stack resolution never throws', () => {
  const layers = (...thicknesses: number[]) =>
    thicknesses.map((thickness, index) => ({
      id: `l${index}`,
      role: 'finish' as const,
      thickness,
    }))

  test('a declared thickness is never rescaled; a disagreeing body is only reported', () => {
    const stack = resolveAssemblyStack({ layers: layers(0.05, 0.05) }, { body: 0.2 })
    expect(stack.diagnostics.map((d) => d.code)).toEqual(['assembly.thickness-mismatch'])
    expect(stack.layers.map((layer) => layer.thickness)).toEqual([0.05, 0.05])
    expect(stack.total).toBe(0.1)
    // No core is needed: a partition is finish, studs, finish.
    const exact = resolveAssemblyStack({ layers: layers(0.05, 0.15) }, { body: 0.2 })
    expect(exact.diagnostics).toEqual([])
  })

  test('backing on a wall or roof is ignored', () => {
    const stack = resolveAssemblyStack(
      { layers: [{ id: 'deck', role: 'deck', thickness: 0.02 }], backing: layers(0.1) },
      { body: null },
    )
    expect(stack.diagnostics.map((d) => d.code)).toEqual(['assembly.backing-refused'])
    expect(stack.total).toBe(0.02)
  })

  test('nothing to stack', () => {
    const stack = resolveAssemblyStack({ layers: layers(0) }, { body: null })
    expect(stack.diagnostics.map((d) => d.code)).toEqual(['assembly.empty'])
    expect(stack.layers).toEqual([])
  })
})

describe('layer src is one source reference in the I-01 grammar', () => {
  const src = (value: string) =>
    Assembly.safeParse({ layers: [{ id: 'a', role: 'finish', thickness: 0.01, src: value }] })
      .success

  test('<ns>:<id>[::<sub>] with the provenance caps: ns ≤ 48, id ≤ 160', () => {
    expect(src('al:ground-exterior-01/wall-segment-1/outside-finish')).toBe(true)
    expect(src('ifc:duplex.ifc:2O2Fr$t4X7Zf8NOew3FNr2')).toBe(true)
    expect(src('al:structure-04-lining::drywall')).toBe(true)
    expect(src(`${'n'.repeat(48)}:${'i'.repeat(160)}`)).toBe(true)

    expect(src('not a source ref')).toBe(false)
    expect(src('no-namespace')).toBe(false)
    expect(src(':id')).toBe(false)
    expect(src('al:')).toBe(false)
    expect(src('al:id::')).toBe(false)
    expect(src('al::id')).toBe(false)
    // Printable ASCII in every part, as the typed ref: spaces pass, the rest is percent-encoded.
    expect(src('al:Kitchen wall 01')).toBe(true)
    expect(src('al:café')).toBe(false)
    expect(src('al:tab\there')).toBe(false)
    expect(src(`${'n'.repeat(49)}:id`)).toBe(false)
    expect(src(`al:${'i'.repeat(161)}`)).toBe(false)
  })

  test('parses to the typed ref fields; a namespace may carry its own qualifier', () => {
    expect(parseSourceRef('al:ground-exterior-01')).toEqual({ ns: 'al', id: 'ground-exterior-01' })
    expect(parseSourceRef('ifc:duplex.ifc:2O2Fr$t4X7Zf8NOew3FNr2::opening')).toEqual({
      ns: 'ifc:duplex.ifc',
      id: '2O2Fr$t4X7Zf8NOew3FNr2',
      sub: 'opening',
    })
    expect(parseSourceRef('not a source ref')).toBeNull()
    expect(parseSourceRef('al:Kitchen wall 01')).toEqual({ ns: 'al', id: 'Kitchen wall 01' })
  })
})

describe('layer provenance is content (R3, R9)', () => {
  test('src is a source reference a preset strips; ids define #layer keys', () => {
    const src = EXISTING_REFERENCES.find((row) => row.path === 'assembly.layers[].src')
    expect(src).toMatchObject({ namespace: 'source', role: 'content', onPreset: 'strip' })
    expect(src?.remaps).toEqual([])
  })
})

/**
 * Synthetic wall build-ups expressed as layer boundaries in metres from the
 * exterior face. In both walls the interior side is the Pascal front (+n) face.
 */
describe('wall layer boundary fixtures', () => {
  type Measured = { id: string; role: AssemblyLayer['role']; from: number; to: number }
  const fromMeasured = (measured: Measured[], core: string): Assembly => ({
    layers: [...measured].reverse().map(({ id, role, from, to }) => ({
      id,
      role,
      thickness: Number((to - from).toFixed(6)),
      ...(id === core ? { core: true as const } : {}),
      src: `ex:wall/${id}`,
    })),
  })

  test('timber weather wall: stucco, membrane, sheathing, studs, lining (200 mm)', () => {
    const measured: Measured[] = [
      { id: 'outside-finish', role: 'finish', from: 0, to: 0.01 },
      { id: 'finish-gap', role: 'air', from: 0.01, to: 0.039 },
      { id: 'weather-barrier', role: 'membrane', from: 0.039, to: 0.04 },
      { id: 'sheathing', role: 'sheathing', from: 0.04, to: 0.05 },
      { id: 'studs', role: 'structure', from: 0.05, to: 0.15 },
      { id: 'cavity', role: 'air', from: 0.15, to: 0.19 },
      { id: 'lining', role: 'lining', from: 0.19, to: 0.2 },
    ]
    const wall = WallNode.parse({
      id: 'wall_timber',
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    const result = bandsOf(wall, fromMeasured(measured, 'studs'))
    expect(result.diagnostics).toEqual([])
    const half = 0.2 / 2
    for (const { id, from, to } of measured) {
      const band = result.bands.find((b) => b.layerId === id)!
      close(band.back, from - half)
      close(band.front, to - half)
    }
    // The 100 mm studs sit on the wall centreline.
    const studs = result.bands.find((b) => b.layerId === 'studs')!
    close(studs.back + studs.front, 0)
  })

  test("CMU wall: the 50 mm interior build-up makes a 250 mm wall whose block band is today's body", () => {
    const measured: Measured[] = [
      { id: 'cmu', role: 'structure', from: 0, to: 0.2 },
      { id: 'insulation', role: 'insulation', from: 0.2, to: 0.22 },
      { id: 'furring', role: 'furring', from: 0.22, to: 0.24 },
      { id: 'lining', role: 'lining', from: 0.24, to: 0.25 },
    ]
    const today = WallNode.parse({
      id: 'wall_cmu',
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    // Same exterior face, centreline moved 25 mm toward the interior (+n).
    const layered = WallNode.parse({
      id: 'wall_cmu',
      start: [0, 0.025],
      end: [4, 0.025],
      thickness: 0.25,
    })
    const result = bandsOf(layered, fromMeasured(measured, 'cmu'))
    expect(result.diagnostics).toEqual([])
    close(result.layers.find((layer) => layer.id === 'cmu')!.thickness, 0.2)
    for (const { id, from, to } of measured) {
      const band = result.bands.find((b) => b.layerId === id)!
      close(band.back, from - 0.125)
      close(band.front, to - 0.125)
    }
    // The block band is exactly today's wall body.
    const block = result.bands.find((b) => b.layerId === 'cmu')!.polygons
    expect(block).toHaveLength(1)
    const key = (p: { x: number; y: number }) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`
    expect(block[0]!.map(key).sort()).toEqual(
      getWallPlanFootprint(today, calculateLevelMiters([today]))
        .map(key)
        .sort(),
    )
  })
})

describe('backing, structural layers and host capabilities', () => {
  test('backing resolves on a zero-body host: ceiling insulation', () => {
    const ceiling = Assembly.parse({
      layers: [],
      backing: [
        { id: 'insulation', role: 'insulation', thickness: 0.2, material: 'batt' },
        { id: 'fill', role: 'fill', thickness: 0.05, inset: 0.1 },
      ],
    })
    const stack = resolveAssemblyStack(ceiling, { body: 0, backing: true })
    expect(stack.diagnostics).toEqual([])
    expect(stack.layers).toEqual([])
    expect(stack.total).toBe(0)
    expect(stack.backing.map((layer) => [layer.id, layer.depth, layer.thickness])).toEqual([
      ['insulation', 0, 0.2],
      ['fill', 0.2, 0.05],
    ])
    expect(stack.backing[1]!.inset).toBe(0.1)
    // A host that refuses backing still gets none, with the diagnostic.
    const refused = resolveAssemblyStack(ceiling, { body: 0 })
    expect(refused.backing).toEqual([])
    expect(refused.diagnostics.map((d) => d.code)).toEqual([
      'assembly.backing-refused',
      'assembly.empty',
    ])
    // An assembly with neither body nor backing is still refused.
    expect(Assembly.safeParse({ layers: [] }).success).toBe(false)
  })

  test('core marks a structural layer only', () => {
    const core = (role: string) =>
      Assembly.safeParse({ layers: [{ id: 'a', role, thickness: 0.1, core: true }] }).success
    expect(core('structure')).toBe(true)
    expect(core('deck')).toBe(true)
    expect(core('shell')).toBe(true)
    expect(core('finish')).toBe(false)
    expect(core('lining')).toBe(false)
    expect(core('air')).toBe(false)
  })

  test('a layer slot is inventoried as a key into its own host slots', () => {
    for (const path of ['assembly.layers[].slot', 'assembly.backing[].slot']) {
      expect(EXISTING_REFERENCES.find((row) => row.path === path)).toMatchObject({
        namespace: 'part',
      })
    }
  })

  test('a roof keeps its slots, so a layer slot has something to resolve against', () => {
    const roof = RoofNode.parse({
      id: 'roof_slots',
      slots: { 'layer:covering': 'library:roof-shingles-grey' },
      assembly: { layers: [{ id: 'covering', role: 'covering', thickness: 0.009 }] },
    })
    expect(roof.slots).toEqual({ 'layer:covering': 'library:roof-shingles-grey' })
  })

  test('core declares no built-in host: each kind declares its own capability', async () => {
    const core = await import('../index')
    expect('wallAssemblyHost' in core).toBe(false)
    expect('roofAssemblyHost' in core).toBe(false)
  })
})
