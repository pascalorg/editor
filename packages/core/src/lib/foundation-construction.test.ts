import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '../schema'
import { planWallInsertion } from '../systems/wall/wall-topology'
import {
  FOUNDATION_BY_REGION_NOTE,
  FOUNDATION_CONSTRUCTIONS,
  type FoundationConstructionId,
  foundationReadingOf,
  foundationRegionOf,
} from './foundation-construction'
import { foundationWallConstruction } from './foundation-wall'
import { genericFoundation } from './generic-foundation'
import { groundSeat } from './ground-seat'

type Nodes = Record<AnyNodeId, AnyNode>
type SitePatch = Partial<Parameters<typeof SiteNode.parse>[0]>

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [8, 0],
  [8, 6],
  [0, 6],
]

const dossier = (formatted?: string, point?: { lat: number; lng: number }) => ({
  provider: 'pascal-map',
  asOf: '2026-10-16',
  ...(formatted ? { address: { formatted } } : {}),
  ...(point ? { point } : {}),
  sections: {},
})

/**
 * A basement under a ground floor, ringed by walls on the ground floor, on a site that says what
 * `site` says.
 */
function house(site: SitePatch | null): Nodes {
  const ring = SQUARE.map((start, index) =>
    WallNode.parse({
      id: `wall_main_${index}`,
      parentId: 'level_main',
      start,
      end: SQUARE[(index + 1) % 4],
      thickness: 0.2,
    }),
  )
  const nodes: AnyNode[] = [
    ...(site ? [SiteNode.parse({ id: 'site_a', children: ['building_a'], ...site })] : []),
    BuildingNode.parse({
      id: 'building_a',
      ...(site ? { parentId: 'site_a' } : {}),
      children: ['level_base', 'level_main'],
    }),
    LevelNode.parse({
      id: 'level_base',
      parentId: 'building_a',
      level: -1,
      baseElevation: -2.5,
      height: 2.5,
      children: ['slab_base'],
    }),
    SlabNode.parse({ id: 'slab_base', parentId: 'level_base', polygon: SQUARE }),
    LevelNode.parse({
      id: 'level_main',
      parentId: 'building_a',
      level: 0,
      height: 2.5,
      children: ['slab_main', ...ring.map((wall) => wall.id)],
    }),
    SlabNode.parse({ id: 'slab_main', parentId: 'level_main', polygon: SQUARE, elevation: 0.05 }),
    ...ring,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Nodes
}

const drawBelow = (
  nodes: Nodes,
  start: [number, number] = [0, 0],
  end: [number, number] = [4, 0],
) => {
  const result = planWallInsertion(nodes, {
    levelId: 'level_base' as AnyNodeId,
    start,
    end,
    joinRadius: 0,
  })
  if (!result.ok) throw Error(result.reason)
  return result.plan.insertedWalls[0]!
}

const PARIS = { lat: 48.8566, lng: 2.3522 }

test('the phrase the tool descriptions use states the thicknesses the data builds', () => {
  for (const construction of Object.values(FOUNDATION_CONSTRUCTIONS)) {
    const { thickness } = foundationWallConstruction(construction)
    expect(FOUNDATION_BY_REGION_NOTE).toContain(
      `(${thickness.toFixed(thickness === 0.5 ? 1 : 3)} m)`,
    )
  }
})

describe('where the scene says the building stands', () => {
  const cases: Array<[string, SitePatch | null, 'us' | 'europe' | 'generic', string]> = [
    [
      'a state set by hand on the site',
      { metadata: { codeOverrides: { state: 'tx' } } },
      'us',
      'TX',
    ],
    ['the site address state, abbreviated', { address: { state: 'FL' } }, 'us', 'FL'],
    ['the site address state, written out', { address: { state: 'New York' } }, 'us', 'NY'],
    ['the parcel state', { parcel: { state: 'WA' } }, 'us', 'WA'],
    [
      'a dossier address in the United States',
      { dossier: dossier('1 Main St, Austin, TX 78701, USA') },
      'us',
      'USA',
    ],
    [
      'a dossier address in France',
      { dossier: dossier('12 Rue de Rivoli, 75004 Paris, France') },
      'europe',
      'France',
    ],
    [
      'a dossier address in Italy, in Italian',
      { dossier: dossier('Via del Corso 1, 00186 Roma RM, Italia') },
      'europe',
      'Italia',
    ],
    [
      'a dossier address in Spain, accented',
      { dossier: dossier('Calle Mayor 1, Madrid, España') },
      'europe',
      'España',
    ],
    [
      'a dossier address in the United Kingdom',
      { dossier: dossier('10 Downing St, London, United Kingdom') },
      'europe',
      'United Kingdom',
    ],
    ['a dossier point over Paris', { dossier: dossier(undefined, PARIS) }, 'europe', 'coordinates'],
    [
      'a parcel origin over Rome',
      { parcel: { originLngLat: [12.4964, 41.9028] } },
      'europe',
      'coordinates',
    ],
    ['a site that says nothing', {}, 'generic', 'does not say'],
    ['no site at all', null, 'generic', 'does not say'],
    ['a Canadian province', { address: { state: 'ON' } }, 'generic', 'does not say'],
    [
      'a point over Toronto (the US/Canada border is no box)',
      { dossier: dossier(undefined, { lat: 43.65, lng: -79.38 }) },
      'generic',
      'does not say',
    ],
    [
      'a point over Marrakech (not Europe)',
      { dossier: dossier(undefined, { lat: 31.63, lng: -8.0 }) },
      'generic',
      'does not say',
    ],
    [
      'a dossier address in a country the table does not know',
      { dossier: dossier('Tokyo, Japan') },
      'generic',
      'does not say',
    ],
  ]
  for (const [name, site, region, basis] of cases) {
    test(name, () => {
      const read = foundationRegionOf(house(site), 'building_a')
      expect(read.region).toBe(region)
      expect(read.basis).toContain(basis)
    })
  }

  test('the state set by hand beats the address, which beats the dossier', () => {
    const byHand = foundationRegionOf(
      house({
        metadata: { codeOverrides: { state: 'WA' } },
        address: { state: 'TX' },
        dossier: dossier('Paris, France'),
      }),
      'building_a',
    )
    expect(byHand.basis).toContain('WA')
    const byAddress = foundationRegionOf(
      house({ address: { state: 'TX' }, dossier: dossier('Paris, France') }),
      'building_a',
    )
    expect(byAddress).toMatchObject({ region: 'us' })
    expect(byAddress.basis).toContain('TX')
  })
})

describe('the construction by region and style', () => {
  const idOf = (
    site: SitePatch | null,
    styles?: Array<{ id?: string; name: string; tags?: string[] }>,
  ) =>
    foundationReadingOf(house(site, styles), 'building_a').construction
      .id as FoundationConstructionId

  test('a US site is block, the ground floor 0.203 m over grade', () => {
    const reading = foundationReadingOf(house({ address: { state: 'TX' } }), 'building_a')
    expect(reading.construction.id).toBe('cmu')
    expect(reading.construction.seatAboveGrade).toBe(0.203)
    expect(foundationWallConstruction(reading.construction).thickness).toBe(0.241)
  })

  test('a French or Italian site is cast concrete: 25 cm insulated and waterproofed outside', () => {
    for (const formatted of ['Paris, France', 'Roma, Italia']) {
      const reading = foundationReadingOf(house({ dossier: dossier(formatted) }), 'building_a')
      expect(reading.construction.id).toBe('cast-concrete')
      const wall = foundationWallConstruction(reading.construction)
      expect(wall.thickness).toBe(0.354)
      expect(wall.assembly.layers.map((layer) => [layer.id, layer.role, layer.thickness])).toEqual([
        ['membrane', 'membrane', 0.004],
        ['insulation', 'insulation', 0.1],
        ['concrete', 'structure', 0.25],
      ])
      expect(wall.assembly.layers[2]).toMatchObject({ core: true, material: 'concrete' })
      expect(wall.assembly.face).toBe('exterior')
      expect(reading.construction.seatAboveGrade).toBe(0.15)
      expect(reading.basis).toContain('Europe')
    }
  })

  test('an unknown site keeps today’s default: block, 0.241 m, 0.203 m over grade', () => {
    for (const site of [null, {}, { address: { state: 'ON' } }]) {
      const reading = foundationReadingOf(house(site), 'building_a')
      expect(reading.construction).toBe(FOUNDATION_CONSTRUCTIONS.cmu)
      expect(reading.region).toBe('generic')
      expect(reading.basis).toContain('generic block foundation')
    }
  })
})

describe('what reads the construction', () => {
  test('the wall the tool plans below grade follows the region', () => {
    const us = drawBelow(house({ address: { state: 'TX' } }))
    expect([us.thickness, us.assembly?.layers.map((layer) => layer.id)]).toEqual([
      0.241,
      ['block', 'furring'],
    ])
    const unknown = drawBelow(house({}))
    expect(unknown.thickness).toBe(0.241)
    const eu = drawBelow(house({ dossier: dossier('Paris, France') }))
    expect([eu.thickness, eu.assembly?.layers.map((layer) => layer.id)]).toEqual([
      0.354,
      ['membrane', 'insulation', 'concrete'],
    ])
  })

  test('a thickness or an assembly the caller gives still wins, and the ground floor is an ordinary wall', () => {
    const nodes = house({ dossier: dossier('Paris, France') })
    const given = planWallInsertion(nodes, {
      levelId: 'level_base' as AnyNodeId,
      start: [0, 0],
      end: [4, 0],
      joinRadius: 0,
      wallDefaults: { thickness: 0.3 },
    })
    if (!given.ok) throw Error(given.reason)
    expect(given.plan.insertedWalls[0]).toMatchObject({ thickness: 0.3 })
    expect(given.plan.insertedWalls[0]?.assembly).toBeUndefined()
    const above = planWallInsertion(nodes, {
      levelId: 'level_main' as AnyNodeId,
      start: [1, 1],
      end: [4, 1],
      joinRadius: 0,
    })
    if (!above.ok) throw Error(above.reason)
    expect(above.plan.insertedWalls[0]?.assembly).toBeUndefined()
  })

  test('existing walls are not rewritten when the scene says where it stands', () => {
    const nodes = house({ dossier: dossier('Paris, France') })
    const old = WallNode.parse({
      id: 'wall_old',
      parentId: 'level_base',
      start: [0, 0],
      end: [8, 0],
      thickness: 0.241,
      assembly: structuredClone(FOUNDATION_CONSTRUCTIONS.cmu.assembly),
    })
    nodes['wall_old' as AnyNodeId] = old
    const before = structuredClone(old)
    const wall = drawBelow(nodes, [8, 0], [8, 6])
    expect(nodes['wall_old' as AnyNodeId]).toEqual(before)
    expect(wall.thickness).toBe(0.354)
  })

  test('the generic foundation draws the stem in the matching material and width', () => {
    const stems = (site: SitePatch | null) =>
      genericFoundation(house(site)).filter((member) => member.kind === 'stem')
    // the basement's own walls are none, so the ground floor ring is the outline: stems only where the floor is above the footing
    const us = stems({ address: { state: 'TX' } })
    const eu = stems({ dossier: dossier('Paris, France') })
    const unknown = stems({})
    expect(unknown.length).toBeGreaterThan(0)
    for (const run of unknown) expect(run.material).toBe('cmu')
    for (const run of us) expect(run.material).toBe('cmu')
    for (const run of eu) expect(run.material).toBe('concrete')
    expect([us.length, eu.length]).toEqual([unknown.length, unknown.length])
    for (const run of us)
      expect(run.width).toBeCloseTo(FOUNDATION_CONSTRUCTIONS.cmu.stemThickness, 9)
    for (const run of eu) expect(run.width).toBeCloseTo(0.25, 9)
    const footings = genericFoundation(house({ dossier: dossier('Paris, France') })).filter(
      (member) => member.kind === 'footing',
    )
    expect(footings.length).toBeGreaterThan(0)
    for (const footing of footings) expect(footing.material).toBe('concrete')
  })

  test('the ground seat reads the construction: a floor 0.15 m over grade is seated in Paris, a floor 0.3 m over it is not', () => {
    const seated = (nodes: Nodes, offset: number) => {
      const raised = {
        ...nodes,
        building_a: { ...nodes.building_a, groundLevelId: 'level_main', position: [0, offset, 0] },
      } as Nodes
      return groundSeat(raised, 'building_a')
    }
    const paris = seated(house({ dossier: dossier('Paris, France') }), 0.15)
    expect(paris).toMatchObject({ aboveGrade: 0.15, atFoundationTop: true, seated: true })
    const us = seated(house({ address: { state: 'TX' } }), 0.203)
    expect(us).toMatchObject({ aboveGrade: 0.203, atFoundationTop: true })
    // a European scene seated at the block's 0.203 m before the region was read is still seated
    const before = seated(house({ dossier: dossier('Paris, France') }), 0.203)
    expect(before).toMatchObject({ seated: true, atFoundationTop: false })
    const tooHigh = seated(house({ dossier: dossier('Paris, France') }), 0.3)
    expect(tooHigh).toMatchObject({ seated: false })
  })
})
