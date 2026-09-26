import { describe, expect, test } from 'bun:test'
import { createTerrainField, type LevelNode, quantize, type SceneSnapshot } from '@pascal-app/core'
import { buildSitePlanDrawing, setbacksWarning } from './build-site-plan-drawing'
import { registerSitePlanContributor } from './contributors'
import { computeSiteCoverage } from './coverage'
import { detectFrontEdgeFromRoads } from './front-edge'
import {
  contourPrimitives,
  floorTops,
  formatStreetName,
  serviceEntranceOf,
  servicePoints,
  serviceRoute,
  streetEdgeNames,
  UNNAMED_STREET,
} from './site-annotations'

/** The QA lot (4121 NW 34th St, Gainesville): a through lot, NW 34th Terrace on the west edge (1), NW 34th Street on the east (3). */
const LOT: [number, number][] = [
  [16.9, 18.5],
  [-16.5, 18.3],
  [-16.2, -12.8],
  [17.1, -12.6],
]

describe('street names on a through lot', () => {
  test('the site plan prints a street type, abbreviates the quadrant, and tells a Terrace from a Street', () => {
    expect(formatStreetName('4121 NW 34th St')).toBe('NW 34TH STREET')
    expect(formatStreetName('Northwest 34th Street')).toBe('NW 34TH STREET')
    expect(formatStreetName('Northwest 34th Terrace')).toBe('NW 34TH TERRACE')
    expect(formatStreetName('2544 Beatrice Ln')).toBe('BEATRICE LANE')
    expect(formatStreetName('')).toBe('')
  })

  test('each street edge takes the road that runs along it (the drop-in stores them per edge)', () => {
    const match = detectFrontEdgeFromRoads(
      LOT,
      [
        {
          name: 'Northwest 34th Terrace',
          centerline: [
            [-22, 178],
            [-29, -73],
          ],
        },
        {
          name: 'Northwest 34th Street',
          centerline: [
            [31, 93],
            [32.5, -142],
          ],
        },
      ],
      '4121 NW 34th St',
    )
    expect(match?.streetEdges?.sort()).toEqual([1, 3])
    expect(match?.streetNames).toEqual({
      '1': 'Northwest 34th Terrace',
      '3': 'Northwest 34th Street',
    })
    const names = streetEdgeNames(
      {
        address: { street: '4121 NW 34th St' },
        streetEdges: [1, 3],
        metadata: { streetNames: match?.streetNames },
      },
      1,
    )
    expect([...names]).toEqual([
      [1, 'NW 34TH TERRACE'],
      [3, 'NW 34TH STREET'],
    ])
  })

  test('a lot dropped before names were kept: the front from the drop-in note, the address on the other street edge', () => {
    const names = streetEdgeNames(
      {
        address: { street: '4121 NW 34th St' },
        streetEdges: [1, 3],
        parcel: {
          notes: [
            'Front edge 2: fronts "Northwest 34th Terrace" (OpenStreetMap, the addressed street).',
          ],
        },
      },
      1,
    )
    expect(names.get(1)).toBe('NW 34TH TERRACE')
    expect(names.get(3)).toBe('NW 34TH STREET')
    // a side edge that fronts no street is never labelled
    expect(names.has(0)).toBe(false)
    expect(names.has(2)).toBe(false)
  })

  test('a street edge nobody named says so rather than repeating the address', () => {
    const names = streetEdgeNames({ address: { street: '10 Main St' }, streetEdges: [0, 1] }, 0)
    expect(names.get(0)).toBe('MAIN STREET')
    expect(names.get(1)).toBe(UNNAMED_STREET)
  })
})

describe('contour labels', () => {
  /** A 40 m field rising 2 m west to east over a 30 × 30 lot, with a survey datum at 174.15 ft. */
  const field = (() => {
    const f = createTerrainField({ origin: [-20, -20], spacing: 1, cols: 41, rows: 41 })
    const heights = new Int16Array(f.heights)
    for (let row = 0; row < 41; row++)
      for (let col = 0; col < 41; col++) heights[row * 41 + col] = quantize(f, (col / 40) * 2)
    return { ...f, heights }
  })()
  const lot: [number, number][] = [
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
  ]
  const labels = (datumFt: number | null) =>
    contourPrimitives({
      site: { terrainContours: undefined } as never,
      lot,
      field,
      intervalIn: 12,
      datumFt,
      fontSize: 0.4,
    })
      .filter((g) => g.kind === 'group')
      .map((g) => ((g as { children: { text: string }[] }).children[0] as { text: string }).text)

  test('lines at whole feet above the survey datum, each labelled once or twice — never on every piece', () => {
    const texts = labels(174.15)
    const counts = new Map<string, number>()
    for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1)
    // whole-foot elevations only
    for (const t of counts.keys()) expect(t).toMatch(/^\d{3}$/)
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2)
    expect(counts.size).toBeGreaterThanOrEqual(3)
  })
})

describe('service routes', () => {
  const house: [number, number][] = [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]
  const lot: [number, number][] = [
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
  ]
  test('out square from the wall, then to the street — around the house when the street is behind it', () => {
    // the street is edge 0 (z = −15); the service leaves the house's back (z = +5)
    const route = serviceRoute([0, 5], [0, 1], lot, [0], [house])!
    expect(route.length).toBe(4)
    const end = route[route.length - 1]!
    expect(end[1]).toBeCloseTo(-15, 6)
    // no leg passes through the house
    for (const p of route) expect(Math.abs(p[0]) < 5 && Math.abs(p[1]) < 5).toBe(false)
  })
})

describe('registered service points', () => {
  const level = { id: 'level_services', type: 'level' } as unknown as LevelNode
  registerSitePlanContributor('test-services', null, {
    points: (_scene, levelId) =>
      levelId === level.id
        ? [
            { role: 'water', position: [6, 0, 2] },
            { role: 'water', position: [9, 0, 9] },
          ]
        : [],
    entrance: (_scene, levelId) => (levelId === level.id ? 'underground' : null),
  })
  const scene = { nodes: {} } as unknown as SceneSnapshot

  test('the first point a plugin reports for a role is the one drawn', () => {
    expect(servicePoints(scene, level, null, [])).toEqual([
      { role: 'water', at: [6, 2], normal: null },
    ])
  })

  test('the plugin decides the entrance; a storey it does not know keeps the default', () => {
    expect(serviceEntranceOf(scene, level, null)).toEqual({ kind: 'underground', source: 'plugin' })
    expect(
      serviceEntranceOf(scene, { id: 'level_other', type: 'level' } as unknown as LevelNode, null),
    ).toEqual({ kind: 'overhead', source: 'default' })
  })
})

describe('coverage: one computation for the site plan and the cover', () => {
  test('the site plan’s lot label prints the shared figures', () => {
    const wall = (id: string, start: [number, number], end: [number, number]) => ({
      id,
      type: 'wall',
      parentId: 'level_0',
      start,
      end,
      thickness: 0.2,
      height: 2.8,
      children: [],
      metadata: {},
    })
    const nodes = {
      site_1: {
        id: 'site_1',
        type: 'site',
        polygon: { type: 'polygon', points: lot30() },
        children: ['bldg'],
        parcel: { lotAreaSqFt: 9687 },
      },
      bldg: {
        id: 'bldg',
        type: 'building',
        parentId: 'site_1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        children: ['level_0'],
      },
      level_0: {
        id: 'level_0',
        type: 'level',
        level: 0,
        parentId: 'bldg',
        children: ['w1', 'w2', 'w3', 'w4', 'floor', 'drive'],
      },
      w1: wall('w1', [-5, -4], [5, -4]),
      w2: wall('w2', [5, -4], [5, 4]),
      w3: wall('w3', [5, 4], [-5, 4]),
      w4: wall('w4', [-5, 4], [-5, -4]),
      floor: {
        id: 'floor',
        type: 'slab',
        parentId: 'level_0',
        polygon: [
          [-5, -4],
          [5, -4],
          [5, 4],
          [-5, 4],
        ],
        metadata: { floor: 'slab-on-grade' },
      },
      drive: {
        id: 'drive',
        type: 'slab',
        name: 'Driveway',
        parentId: 'level_0',
        polygon: [
          [-4, -4.1],
          [0, -4.1],
          [0, -15],
          [-4, -15],
        ],
        metadata: { flatwork: 'driveway', floor: 'porch-beam' },
      },
    }
    const coverage = computeSiteCoverage({ nodes } as never)
    // the storey slab is the house, never a "porch"; the driveway is paving
    expect(coverage.parts.map((p) => p.kind)).toEqual(['driveway'])
    expect(coverage.buildingSqFt).toBeCloseTo(10.2 * 8.2 * 10.7639, 0)
    expect(coverage.imperviousSqFt).toBeCloseTo((10.2 * 8.2 + 4 * 10.9) * 10.7639, 0)
    const drawing = buildSitePlanDrawing({
      nodes,
      rootNodeIds: [],
      collections: {},
      materials: {},
    } as unknown as SceneSnapshot)
    const label = drawing.primitives.find(
      (g) => (g as { metadata?: { sitePlan?: string } }).metadata?.sitePlan === 'coverage-label',
    ) as { text: string } | undefined
    expect(label?.text).toContain(
      `BUILDING COVERAGE ${Math.round(coverage.buildingCoverageSqFt).toLocaleString('en-US')} SF`,
    )
    expect(label?.text).toContain(
      `IMPERVIOUS ${Math.round(coverage.imperviousSqFt).toLocaleString('en-US')} SF`,
    )
  })
})

function lot30(): [number, number][] {
  return [
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
  ]
}

describe('the setbacks line a plans examiner reads', () => {
  const yards = { front: 6.096, side: 1.524, rear: 4.572 }
  test('defaults are worded from the site’s numbers — never the internal source tag the drop-in stored', () => {
    const old = setbacksWarning({
      setbacks: yards,
      setbacksSource:
        'Planning default — front 20 ft, side 5 ft, rear 15 ft (typical R-1 yards; PlanCrafters SITE.DEFAULT_SETBACKS). DRAFT: confirm with the zoning district.',
    })
    expect(old).toBe(
      'Setbacks: planning defaults (front 20 ft, side 5 ft, rear 15 ft) — confirm with the zoning district.',
    )
    expect(old).not.toMatch(/PlanCrafters|DEFAULT_SETBACKS/)
  })
  test('yards set by hand say so; a cited zoning code prints nothing', () => {
    expect(
      setbacksWarning({
        setbacks: { ...yards, front: 7.62 },
        setbacksSource: 'Planning defaults — front set by hand in the Generate panel',
      }),
    ).toBe(
      'Setbacks: set by hand (front 25 ft, side 5 ft, rear 15 ft) — confirm with the zoning district.',
    )
    expect(
      setbacksWarning({
        setbacks: yards,
        setbacksSource: 'Zoning RSF-1 — Sec. 30-4.12 — via Pascal Map',
      }),
    ).toBeNull()
  })
})

describe('the finish floor elevation', () => {
  test('the driveway and walk (flatwork, no floor tag) never become the FF', () => {
    const nodes = {
      level_0: {
        id: 'level_0',
        type: 'level',
        level: 0,
        children: ['floor', 'garage', 'drive', 'walk'],
      },
      floor: {
        id: 'floor',
        type: 'slab',
        parentId: 'level_0',
        elevation: 0.05,
        metadata: { floor: 'slab-on-grade' },
      },
      garage: {
        id: 'garage',
        type: 'slab',
        parentId: 'level_0',
        elevation: -0.15,
        metadata: { floor: 'garage-slab-at-grade' },
      },
      // paving standing higher than the floor (an uphill lot): still not the floor
      drive: {
        id: 'drive',
        type: 'slab',
        name: 'Driveway',
        parentId: 'level_0',
        elevation: 0.4,
        metadata: { flatwork: 'driveway' },
      },
      walk: {
        id: 'walk',
        type: 'slab',
        name: 'Front walk',
        parentId: 'level_0',
        elevation: 0.3,
        metadata: { flatwork: 'walk' },
      },
    }
    const tops = floorTops({ nodes } as unknown as SceneSnapshot, nodes.level_0 as never)
    expect(tops.floor).toBe(0.05)
    expect(tops.garage).toBe(-0.15)
  })
})
