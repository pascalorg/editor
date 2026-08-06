import { describe, expect, test } from 'bun:test'
import { analyzeCadDrawing, stripExtension, suggestUnits } from './cad-import'

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`
}

function dxf({
  insunits,
  entities = '',
  layers = [],
}: {
  insunits?: number
  entities?: string
  layers?: { name: string; flags?: number; color?: number }[]
}): string {
  let out = pair(0, 'SECTION') + pair(2, 'HEADER')
  if (insunits !== undefined) out += pair(9, '$INSUNITS') + pair(70, insunits)
  out += pair(0, 'ENDSEC')

  out += pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER')
  for (const layer of layers) {
    out += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, layer.flags ?? 0)
    out += pair(62, layer.color ?? 7)
  }
  out += pair(0, 'ENDTAB') + pair(0, 'ENDSEC')

  out += pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities + pair(0, 'ENDSEC') + pair(0, 'EOF')
  return out
}

function line(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return (
    pair(0, 'LINE') +
    pair(8, layer) +
    pair(10, x1) +
    pair(20, y1) +
    pair(30, 0) +
    pair(11, x2) +
    pair(21, y2) +
    pair(31, 0)
  )
}

/**
 * A 30 m × 20 m building drawn in whatever unit the caller implies: the
 * outline plus enough interior partitions to have the segment density of a
 * real plan. Density matters — the outlier trim that decides framing and unit
 * suggestions deliberately does nothing on a handful of points.
 */
function building(scale: number, layer = 'DUVAR'): string {
  let out =
    line(layer, 0, 0, 30 * scale, 0) +
    line(layer, 30 * scale, 0, 30 * scale, 20 * scale) +
    line(layer, 30 * scale, 20 * scale, 0, 20 * scale) +
    line(layer, 0, 20 * scale, 0, 0)

  for (let i = 1; i < 60; i++) {
    const x = (i * 30 * scale) / 60
    out += line(layer, x, 0, x, 20 * scale)
  }
  return out
}

function analyze(source: string) {
  return analyzeCadDrawing(source, 'plan.dxf', source.length)
}

describe('layer summary', () => {
  test('ranks layers by how much geometry they carry', () => {
    const entities =
      building(1000, 'DUVAR') +
      Array.from({ length: 12 }, (_, i) => line('TEFRIS', i * 10, 0, i * 10, 100)).join('')

    const analysis = analyze(dxf({ insunits: 4, entities }))

    // 63 wall segments beat 12 furniture ones. Ranking by weight is what makes
    // the layer list usable on a real drawing, where the decoration layers
    // carry most of the geometry and the walls are a rounding error.
    expect(analysis.layers[0]).toMatchObject({ name: 'DUVAR', segmentCount: 63 })
    expect(analysis.layers[1]).toMatchObject({ name: 'TEFRIS', segmentCount: 12 })
  })

  test('omits layers that carry nothing', () => {
    const analysis = analyze(
      dxf({
        insunits: 4,
        layers: [{ name: 'DUVAR' }, { name: 'UNUSED' }],
        entities: building(1000),
      }),
    )

    expect(analysis.layers.map((l) => l.name)).toEqual(['DUVAR'])
  })

  test("carries the drawing's own off state through as the default", () => {
    const analysis = analyze(
      dxf({
        insunits: 4,
        layers: [{ name: 'DUVAR' }, { name: 'DEFPOINTS', color: -7 }],
        entities: building(1000) + line('DEFPOINTS', 0, 0, 1, 1),
      }),
    )

    expect(analysis.layers.find((l) => l.name === 'DEFPOINTS')?.visibleByDefault).toBe(false)
    expect(analysis.layers.find((l) => l.name === 'DUVAR')?.visibleByDefault).toBe(true)
  })
})

describe('units', () => {
  test('takes the declared unit and asks nothing', () => {
    const analysis = analyze(dxf({ insunits: 4, entities: building(1000) }))

    expect(analysis.metersPerUnit).toBe(0.001)
    expect(analysis.unitSuggestions).toEqual([])
    expect(analysis.warnings.map((w) => w.code)).not.toContain('unitless')
  })

  test('asks when the drawing declares none', () => {
    const analysis = analyze(dxf({ entities: building(1000) }))

    expect(analysis.metersPerUnit).toBeNull()
    expect(analysis.warnings.map((w) => w.code)).toContain('unitless')
  })

  test('picks millimetres for a building drawn at millimetre magnitudes', () => {
    const analysis = analyze(dxf({ entities: building(1000) }))
    const likely = analysis.unitSuggestions.find((s) => s.likely)

    expect(likely?.label).toBe('Millimetres')
    // Sizes come from the outlier-trimmed extent, so they read a few percent
    // under the true dimension. That is the price of being immune to a stray
    // entity, and it costs nothing here: the number exists to make the order
    // of magnitude obvious, not to be measured against.
    expect(likely?.widthMeters).toBeGreaterThan(25)
    expect(likely?.widthMeters).toBeLessThanOrEqual(30)
  })

  test('picks metres for a building drawn at metre magnitudes', () => {
    const analysis = analyze(dxf({ entities: building(1) }))
    expect(analysis.unitSuggestions.find((s) => s.likely)?.label).toBe('Metres')
  })

  test('picks centimetres for a building drawn at centimetre magnitudes', () => {
    const analysis = analyze(dxf({ entities: building(100) }))
    expect(analysis.unitSuggestions.find((s) => s.likely)?.label).toBe('Centimetres')
  })

  test('shows the resulting size for every option, so a wrong pick is obvious', () => {
    const analysis = analyze(dxf({ entities: building(1000) }))
    const metres = analysis.unitSuggestions.find((s) => s.label === 'Metres')

    // Reading the mm drawing as metres would make a ~30 km building — the
    // point being that no one could mistake that for a plan.
    expect(metres?.widthMeters).toBeGreaterThan(25_000)
    expect(metres?.likely).toBe(false)
  })

  test('marks nothing likely when no interpretation is plausible', () => {
    // A 2 mm square: too small to be a building under any unit.
    const analysis = analyze(dxf({ entities: line('0', 0, 0, 0.002, 0.002) }))
    expect(analysis.unitSuggestions.every((s) => !s.likely)).toBe(true)
  })
})

describe('warnings', () => {
  test('reports entity types it could not draw, with counts', () => {
    const spline = pair(0, 'SPLINE') + pair(8, 'ARAC') + pair(10, 0) + pair(20, 0)
    const analysis = analyze(dxf({ insunits: 4, entities: building(1000) + spline + spline }))

    const warning = analysis.warnings.find((w) => w.code === 'skipped-entities')
    expect(warning?.message).toContain('2 SPLINE')
    expect(analysis.skippedTypes.SPLINE).toBe(2)
  })

  test('flags a drawing whose extent dwarfs its content', () => {
    // A building plus one stray far away — the multi-sheet / forgotten-entity
    // shape that real files have.
    const entities = building(1000) + line('STRAY', -400_000, 0, -399_000, 0)
    const analysis = analyze(dxf({ insunits: 4, entities }))

    expect(analysis.warnings.map((w) => w.code)).toContain('scattered-content')
  })

  test('stays quiet for a tidy drawing', () => {
    const analysis = analyze(dxf({ insunits: 4, entities: building(1000) }))
    expect(analysis.warnings).toEqual([])
  })

  test('reports an empty drawing rather than importing nothing', () => {
    const analysis = analyze(dxf({ insunits: 4 }))

    expect(analysis.segmentCount).toBe(0)
    expect(analysis.warnings.map((w) => w.code)).toContain('empty')
  })
})

describe('suggestUnits', () => {
  test('reads the content extent, not the full extent', () => {
    // Content is a 30 m building in mm; the full extent is dragged out by a
    // stray. Judging on the full extent would suggest the wrong unit.
    const entities = building(1000) + line('STRAY', -8_000_000, 0, -7_990_000, 0)
    const analysis = analyze(dxf({ entities }))

    expect(analysis.unitSuggestions.find((s) => s.likely)?.label).toBe('Millimetres')
  })

  test('is derived from the underlay, not the raw drawing', () => {
    const analysis = analyze(dxf({ entities: building(1000) }))
    expect(suggestUnits(analysis.underlay)).toEqual(analysis.unitSuggestions)
  })
})

describe('stripExtension', () => {
  test('drops the extension for the node name', () => {
    expect(stripExtension('MENART-Yaka Etüd_25.06.26.dxf')).toBe('MENART-Yaka Etüd_25.06.26')
    expect(stripExtension('plan')).toBe('plan')
    expect(stripExtension('  ')).toBe('CAD drawing')
    expect(stripExtension('.hidden')).toBe('.hidden')
  })
})
