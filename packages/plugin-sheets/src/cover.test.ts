import { describe, expect, test } from 'bun:test'
import { computeProjectData, maxRoofRise, polygonAreaSqM, projectSubtitle, UNKNOWN } from './cover'
import type { NodeMap } from './model'

const SQFT_PER_SQM = 10.763910416709722

/** A 10 × 8 m rectangle starting at the origin. */
function rect(w: number, h: number, x = 0, z = 0): [number, number][] {
  return [
    [x, z],
    [x + w, z],
    [x + w, z + h],
    [x, z + h],
  ]
}

/**
 * A synthetic scene: one level with a 10 × 8 living room and a 6 × 6 garage,
 * a 10 × 8 slab, a 30 × 40 lot, and a 30° gable roof over an 8 m depth.
 */
function scene(overrides: Partial<Record<string, unknown>> = {}): NodeMap {
  const nodes: NodeMap = {
    site_1: {
      id: 'site_1',
      type: 'site',
      polygon: { type: 'polygon', points: rect(30, 40, -10, -10) },
      zone: 'r-1',
    },
    level_0: { id: 'level_0', type: 'level', level: 0, height: 2.8, children: [] },
    zone_living: {
      id: 'zone_living',
      type: 'zone',
      name: 'Living room',
      parentId: 'level_0',
      polygon: rect(10, 8),
    },
    zone_bed: {
      id: 'zone_bed',
      type: 'zone',
      name: 'Bedroom 1',
      parentId: 'level_0',
      polygon: rect(4, 4, 12, 0),
    },
    zone_bath: {
      id: 'zone_bath',
      type: 'zone',
      name: 'Bathroom',
      parentId: 'level_0',
      polygon: rect(2, 3, 12, 6),
    },
    zone_garage: {
      id: 'zone_garage',
      type: 'zone',
      name: 'Garage',
      parentId: 'level_0',
      polygon: rect(6, 6, 20, 0),
    },
    slab_0: { id: 'slab_0', type: 'slab', parentId: 'level_0', polygon: rect(10, 8) },
    rseg_0: {
      id: 'rseg_0',
      type: 'roof-segment',
      parentId: 'roof_0',
      roofType: 'gable',
      pitch: 45,
      width: 10,
      depth: 8,
    },
  }
  return { ...nodes, ...(overrides as NodeMap) }
}

function dataValue(nodes: NodeMap, label: string): string {
  const row = computeProjectData(nodes).rows.find((r) => r.label === label)
  if (!row) throw new Error(`no row labelled ${label}`)
  return row.value
}

describe('polygon area', () => {
  test('shoelace is orientation-independent', () => {
    expect(polygonAreaSqM(rect(10, 8))).toBeCloseTo(80, 6)
    expect(polygonAreaSqM([...rect(10, 8)].reverse())).toBeCloseTo(80, 6)
  })

  test('fewer than three points has no area', () => {
    expect(
      polygonAreaSqM([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(0)
  })
})

describe('project data', () => {
  test('living area is the zones, less the garage', () => {
    // 80 (living) + 16 (bed) + 6 (bath) = 102 m²; the 36 m² garage is excluded.
    const expected = Math.round(102 * SQFT_PER_SQM).toLocaleString('en-US')
    expect(dataValue(scene(), 'LIVING AREA')).toBe(`${expected} SF`)
  })

  test('total under roof is the largest level slab area', () => {
    expect(dataValue(scene(), 'TOTAL UNDER ROOF')).toBe(
      `${Math.round(80 * SQFT_PER_SQM).toLocaleString('en-US')} SF`,
    )
  })

  test('lot area comes from the site polygon when there is no parcel record', () => {
    expect(dataValue(scene(), 'LOT AREA')).toBe(
      `${Math.round(1200 * SQFT_PER_SQM).toLocaleString('en-US')} SF`,
    )
  })

  test('a resolved parcel record wins over the drawn polygon', () => {
    const nodes = scene()
    nodes.site_1 = { ...nodes.site_1, parcel: { lotAreaSqFt: 8712 } } as NodeMap[string]
    expect(dataValue(nodes, 'LOT AREA')).toBe('8,712 SF')
  })

  test('coverage and FAR are the ratios of the areas already reported', () => {
    // 80 m² under roof on a 1200 m² lot = 6.7 %; 102 / 1200 = 0.09 FAR.
    expect(dataValue(scene(), 'LOT COVERAGE')).toBe('6.7 %')
    expect(dataValue(scene(), 'FLOOR AREA RATIO')).toBe('0.09')
  })

  test('building height is storey height plus the roof rise', () => {
    // 2.8 m storey + tan(45°) × (8 / 2) = 4 m rise = 6.8 m = 22'-4".
    expect(dataValue(scene(), 'BUILDING HEIGHT')).toBe(`22'-4"`)
  })

  test('bedrooms and baths come from the room names', () => {
    expect(dataValue(scene(), 'BEDROOMS')).toBe('1')
    expect(dataValue(scene(), 'BATHS')).toBe('1')
    expect(dataValue(scene(), 'STORIES')).toBe('1')
  })

  test('every figure the scene cannot support reads NOT ESTABLISHED', () => {
    const bare: NodeMap = { level_0: { id: 'level_0', type: 'level', level: 0, children: [] } }
    const data = computeProjectData(bare)
    const values = Object.fromEntries(data.rows.map((r) => [r.label, r.value]))
    expect(values['LIVING AREA']).toBe(UNKNOWN)
    expect(values['TOTAL UNDER ROOF']).toBe(UNKNOWN)
    expect(values['LOT AREA']).toBe(UNKNOWN)
    expect(values['LOT COVERAGE']).toBe(UNKNOWN)
    expect(values['FLOOR AREA RATIO']).toBe(UNKNOWN)
    expect(values['BUILDING HEIGHT']).toBe(UNKNOWN)
    expect(values['BEDROOMS']).toBe(UNKNOWN)
    // The one thing a bare scene DOES know.
    expect(values['STORIES']).toBe('1')
    expect(data.unknown).toContain('LOT AREA')
  })

  test('a storey with no height leaves the building height unestablished', () => {
    const nodes = scene()
    nodes.level_0 = { id: 'level_0', type: 'level', level: 0, children: [] }
    expect(dataValue(nodes, 'BUILDING HEIGHT')).toBe(UNKNOWN)
  })

  test('no roof means no height, and the sheet says why', () => {
    const nodes = scene()
    delete nodes.rseg_0
    expect(dataValue(nodes, 'BUILDING HEIGHT')).toBe(UNKNOWN)
    expect(computeProjectData(nodes).basis.join(' ')).toContain('No roof is modelled')
  })

  test('per-level rows appear only on a multi-level scene', () => {
    const one = computeProjectData(scene()).rows.filter((r) => r.indent)
    expect(one).toHaveLength(0)
    const nodes = scene()
    nodes.level_1 = { id: 'level_1', type: 'level', level: 1, height: 2.6, children: [] }
    nodes.zone_up = {
      id: 'zone_up',
      type: 'zone',
      name: 'Bedroom 2',
      parentId: 'level_1',
      polygon: rect(5, 4),
    }
    const two = computeProjectData(nodes).rows.filter((r) => r.indent)
    expect(two.length).toBeGreaterThan(0)
  })

  test('every computed figure is accompanied by its basis', () => {
    expect(computeProjectData(scene()).basis.length).toBeGreaterThanOrEqual(4)
  })
})

describe('roof rise', () => {
  test('a shed slopes across the whole depth, a gable to the middle', () => {
    const gable = maxRoofRise({
      s: { id: 's', type: 'roof-segment', roofType: 'gable', pitch: 45, depth: 8, width: 10 },
    })
    const shed = maxRoofRise({
      s: { id: 's', type: 'roof-segment', roofType: 'shed', pitch: 45, depth: 8, width: 10 },
    })
    expect(gable).toBeCloseTo(4, 6)
    expect(shed).toBeCloseTo(8, 6)
  })

  test('a flat roof has no rise, but is still a roof', () => {
    expect(
      maxRoofRise({
        s: { id: 's', type: 'roof-segment', roofType: 'flat', pitch: 0, depth: 8, width: 10 },
      }),
    ).toBe(0)
  })

  test('no roof at all is null, not zero', () => {
    expect(maxRoofRise({})).toBeNull()
  })
})

describe('the project subtitle', () => {
  test('reads the record’s project type', () => {
    const nodes: NodeMap = {
      rec: { id: 'rec', type: 'sheets:project-record', projectType: 'adu' },
    }
    expect(projectSubtitle(nodes)).toBe('NEW ACCESSORY DWELLING UNIT (ADU)')
  })

  test('falls back to RESIDENCE when nothing is typed in', () => {
    expect(projectSubtitle({})).toBe('RESIDENCE')
  })

  test('an unusual type prints itself rather than being flattened', () => {
    const nodes: NodeMap = {
      rec: { id: 'rec', type: 'sheets:project-record', projectType: 'duplex conversion' },
    }
    expect(projectSubtitle(nodes)).toBe('DUPLEX CONVERSION')
  })
})
