import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  AGENT_OPERATIONS,
  describeTerrainUnderHouse,
  readSiteTerrain,
  readTerrainContours,
  sampleTerrainLine,
} from '../agent-operations'
import { isAgentRefusal } from '../agent-tools'
import { siteTerrainOutput } from '../agent-tools/terrain'
import { type AnyNode, BuildingNode, LevelNode, SiteNode, SlabNode } from '../schema'
import { terrainHouseScene, terrainRampScene } from './__fixtures__/terrain-cases'

type Nodes = Record<string, AnyNode>
const context = { activeLevelId: null }

// A site nobody has shaped keeps `terrain` absent: its ground is the flat datum plane, y = 0.
const lot: [number, number][] = [
  [0, 0],
  [20, 0],
  [20, 10],
  [0, 10],
]
const flatSite = (id = 'site_flat') =>
  SiteNode.parse({ id, polygon: { type: 'polygon', points: lot } })
const flat = (): Nodes => ({ site_flat: flatSite() })

/** A house slab at 0.4 m on the flat lot: the ground under it is the datum. */
function flatHouse(): Nodes {
  const site = flatSite()
  const building = BuildingNode.parse({ id: 'building_house', parentId: site.id })
  const level = LevelNode.parse({ id: 'level_house', parentId: building.id, level: 0, height: 3 })
  const slab = SlabNode.parse({
    id: 'slab_house',
    parentId: level.id,
    boundary: 'auto',
    polygon: [
      [4, 2],
      [12, 2],
      [12, 8],
      [4, 8],
    ],
    elevation: 0.4,
  })
  return {
    [site.id]: { ...site, children: [building.id] },
    [building.id]: { ...building, children: [level.id] },
    [level.id]: { ...level, children: [slab.id] },
    [slab.id]: slab,
  }
}

function refusalCode(call: () => unknown): string | null {
  try {
    call()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return null
}

describe('read_site_terrain on a site with no shaped ground', () => {
  test('answers with the flat datum facts, not an error', () => {
    const { result } = readSiteTerrain(flat(), {}, context)

    expect(result).toMatchObject({
      hasTerrain: false,
      flat: true,
      reliefM: 0,
      minM: 0,
      maxM: 0,
      datumM: 0,
      slopeMeanDeg: 0,
      slopeMaxDeg: 0,
      areaAboveGradeM2: 0,
      areaBelowGradeM2: 0,
    })
  })

  test('gives every corner of the footprint a level normal and every edge no drop', () => {
    const { result } = readSiteTerrain(flat(), {}, context)

    expect(result.slopeAtCorners).toEqual(
      lot.map(([x, z]) => ({ x, z, slopeDeg: 0, normal: [0, 1, 0] })),
    )
    expect(result.edgeDrops).toHaveLength(4)
    for (const edge of result.edgeDrops as { dropM: number; maxSlopeDeg: number }[])
      expect(edge).toMatchObject({ dropM: 0, maxSlopeDeg: 0 })
  })

  test('says that no relief is shaped and that the ground is the datum plane', () => {
    const { result } = readSiteTerrain(flat(), {}, context)

    expect(result.note).toBe(
      'No relief is shaped on this site: the ground is the flat datum plane at y = 0. Relief is shaped with shape_site_terrain and carve_terrain_pad.',
    )
  })

  test('reads the footprint it is given', () => {
    const footprint = [
      [2, 2],
      [6, 2],
      [6, 5],
    ]

    const { result } = readSiteTerrain(flat(), { footprint }, context)

    expect(result.slopeAtCorners).toHaveLength(3)
    expect(result.hasTerrain).toBe(false)
  })

  test('is valid output of the contract, as a shaped site is', () => {
    const output = z.object(siteTerrainOutput)

    expect(output.safeParse(readSiteTerrain(flat(), {}, context).result).success).toBe(true)
    const shaped = readSiteTerrain(terrainRampScene().nodes as Nodes, {}, context).result
    expect(output.safeParse(shaped).success).toBe(true)
    expect(shaped.hasTerrain).toBe(true)
  })

  test('a shaped site has no note', () => {
    const { result } = readSiteTerrain(terrainRampScene().nodes as Nodes, {}, context)

    expect(result.note).toBeUndefined()
  })
})

describe('the other reads on a site with no shaped ground', () => {
  test('sample_terrain_line is level ground along the segment', () => {
    const { result } = sampleTerrainLine(flat(), { from: [1, 1], to: [3, 1] }, context)

    const points = result.points as { yM: number; slopeDeg: number }[]
    expect(points.length).toBeGreaterThan(2)
    expect(points.every((point) => point.yM === 0 && point.slopeDeg === 0)).toBe(true)
    expect(result.note).toContain('flat datum plane')
  })

  test('read_terrain_contours has no contour lines to report', () => {
    const { result } = readTerrainContours(flat(), {}, context)

    expect(result).toMatchObject({ datum: 0, lines: [] })
    expect(result.note).toContain('flat datum plane')
  })

  test('describe_terrain_under_house puts the datum under the slab', () => {
    const { result } = describeTerrainUnderHouse(flatHouse(), {}, context)

    expect(result).toMatchObject({
      slabId: 'slab_house',
      slabTopM: 0.4,
      highestM: 0,
      lowestM: 0,
      reliefM: 0,
      clearanceUnderSlabM: 0.4,
    })
    expect((result.dropAtEdges as { dropM: number }[]).every((edge) => edge.dropM === 0.4)).toBe(
      true,
    )
    expect(result.needsGuardAt).toEqual([])
    expect(result.note).toContain('flat datum plane')
  })

  test('the shaped house read is unchanged', () => {
    const { result } = describeTerrainUnderHouse(terrainHouseScene().nodes as Nodes, {}, context)

    expect(result.note).toBeUndefined()
    expect(result.reliefM).toBeGreaterThan(0)
  })
})

describe('the refusals that are real still refuse', () => {
  const reads = {
    read_site_terrain: {},
    sample_terrain_line: { from: [1, 1], to: [2, 1] },
    read_terrain_contours: {},
  } as const

  test('no site', () => {
    for (const [tool, input] of Object.entries(reads)) {
      const operation = AGENT_OPERATIONS[tool as keyof typeof reads]
      expect(refusalCode(() => operation({}, input as never, context))).toBe('no_site')
    }
  })

  test('several sites', () => {
    const nodes = { ...flat(), site_other: flatSite('site_other') }

    expect(refusalCode(() => readSiteTerrain(nodes, {}, context))).toBe('ambiguous_site')
  })

  test('a persisted field that cannot be read is not flat ground', () => {
    const nodes = terrainRampScene().nodes as Nodes
    const site = nodes.site_terrain as SiteNode
    const broken = { ...site, terrain: { ...site.terrain, heights: 'broken' } } as SiteNode

    expect(refusalCode(() => readSiteTerrain({ site_terrain: broken }, {}, context))).toBe(
      'no_terrain',
    )
  })

  test('an empty or self-crossing footprint', () => {
    expect(refusalCode(() => readSiteTerrain(flat(), { footprint: [] }, context))).toBe(
      'footprint_empty',
    )
    const bowtie = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ]
    expect(refusalCode(() => readSiteTerrain(flat(), { footprint: bowtie }, context))).toBe(
      'invalid_polygon',
    )
  })

  test('a house read still needs a slab to stand on', () => {
    expect(refusalCode(() => describeTerrainUnderHouse(flat(), {}, context))).toBe(
      'footprint_empty',
    )
  })
})
