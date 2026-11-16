import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  persistedTerrainFieldOf,
  useLiveTerrain,
} from '@pascal-app/core'
import {
  AGENT_OPERATIONS,
  readSiteTerrain,
  readTerrainContours,
  sampleTerrainLine,
} from '@pascal-app/core/agent-operations'
import {
  AGENT_TOOL_CONTRACTS,
  isAgentRefusal,
  readSiteTerrainTool,
  readTerrainContoursTool,
  sampleTerrainLineTool,
} from '@pascal-app/core/agent-tools'
import { type AnyNode, SiteNode, TerrainTileNode } from '@pascal-app/core/schema'
import { TERRAIN_CASES, terrainRampScene } from './__fixtures__/terrain-cases'

type Nodes = Record<string, AnyNode>
const context = { activeLevelId: null }
const square: [number, number][] = [
  [1, 1],
  [5, 1],
  [5, 5],
  [1, 5],
]

function ramp(scale = 1): Nodes {
  return terrainRampScene(scale).nodes as Nodes
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

for (const entry of TERRAIN_CASES) {
  test(`${entry.tool}: ${entry.name}`, () => {
    const operation = AGENT_OPERATIONS[entry.tool as keyof typeof AGENT_OPERATIONS]
    const nodes = entry.scene().nodes as Nodes
    if ('refusal' in entry.expect) {
      expect(refusalCode(() => operation(nodes, entry.input as never, context))).toBe(
        entry.expect.refusal,
      )
    } else {
      const before = structuredClone(nodes)
      const outcome = operation(nodes, entry.input as never, context)
      expect(outcome.result).toMatchObject(entry.expect.result)
      expect(entry.expect.check?.(outcome.result, nodes) ?? []).toEqual([])
      expect(Object.keys(outcome)).toEqual(['result'])
      expect(nodes).toEqual(before)
    }
  })
}

describe('persisted terrain facts', () => {
  for (const extent of ['large lot', 'distant tiles'] as const) {
    test(`contours refuse an oversized ${extent} before sampling its union`, () => {
      const base = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
      base.heights[0] = 100
      const encoded = encodeTerrainField(base)
      const site = SiteNode.parse({
        id: 'site_contour_budget',
        ...(extent === 'large lot'
          ? {
              terrain: encoded,
              polygon: {
                type: 'polygon',
                points: [
                  [0, 0],
                  [10_000, 0],
                  [10_000, 10_000],
                  [0, 10_000],
                ],
              },
            }
          : {}),
      })
      const nodes: Nodes = { [site.id]: site }
      if (extent === 'distant tiles') {
        for (const ix of [0, 100_000]) {
          const tile = TerrainTileNode.parse({
            id: `terrain-tile_budget_${ix}`,
            parentId: site.id,
            level: 0,
            ix,
            iz: 0,
            step: 0.01,
            heights: encoded.heights,
          })
          nodes[tile.id] = tile
        }
      }
      const field = persistedTerrainFieldOf(site, nodes)
      if (!field) throw new Error('Missing virtual terrain')
      const descriptor = Object.getOwnPropertyDescriptor(field, 'readHeightAt')
      if (!descriptor) throw new Error('Missing virtual sampling seam')
      let samples = 0
      // A sentinel makes a misplaced guard fail immediately instead of hanging the runner.
      Object.defineProperty(field, 'readHeightAt', {
        ...descriptor,
        value: () => {
          samples++
          throw new Error('Oversized contour union sampled before refusal')
        },
      })
      const before = structuredClone(nodes)
      try {
        expect(refusalCode(() => readTerrainContours(nodes, { intervalM: 1 }, context))).toBe(
          'contour_limit',
        )
        expect(samples).toBe(0)
        expect(nodes).toEqual(before)
      } finally {
        Object.defineProperty(field, 'readHeightAt', descriptor)
      }
    })
  }

  test('exports one read-only contract and operation per tool', () => {
    for (const contract of [readSiteTerrainTool, sampleTerrainLineTool, readTerrainContoursTool]) {
      expect(AGENT_TOOL_CONTRACTS).toContain(contract)
      expect(contract.annotations.readOnlyHint).toBe(true)
      expect(AGENT_OPERATIONS).toHaveProperty(contract.name)
    }
  })

  test('ramp corners have unit normals and signed endpoint edge drops', () => {
    const result = readSiteTerrain(ramp(), { footprint: square, cellM: 1 }, context).result
    const corners = result.slopeAtCorners as { slopeDeg: number; normal: number[] }[]
    expect(corners).toHaveLength(4)
    for (const corner of corners) {
      expect(corner.slopeDeg).toBeCloseTo(45)
      expect(corner.normal[0]).toBeCloseTo(-Math.SQRT1_2)
      expect(corner.normal[1]).toBeCloseTo(Math.SQRT1_2)
      expect(corner.normal[2]).toBeCloseTo(0)
    }
    expect((result.edgeDrops as { dropM: number }[]).map((edge) => edge.dropM)).toEqual([
      -4, 0, 4, 0,
    ])
    expect(result.edgeDrops).toEqual(
      expect.arrayContaining([expect.objectContaining({ maxSlopeDeg: 45 })]),
    )
  })

  test('field-border slopes continue the ramp instead of halving it through clamping', () => {
    const result = sampleTerrainLine(ramp(), { from: [0, 2], to: [8, 2], stepM: 8 }, context).result
    const points = result.points as { slopeDeg: number }[]
    // A one-metre finite difference spans the start of the 64 m decay band.
    for (const point of points) {
      expect(point.slopeDeg).toBeGreaterThan(44)
      expect(point.slopeDeg).toBeLessThan(46)
    }
  })

  test('finite large areas keep the mean slope finite', () => {
    const spacing = 1e153
    const field = createTerrainField({ cols: 9, rows: 9, spacing, step: spacing })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++) field.heights[row * field.cols + col] = col - 3
    const site = SiteNode.parse({
      id: 'site_large',
      polygon: {
        type: 'polygon',
        points: square.map(([x, z]) => [x * spacing, z * spacing]),
      },
      terrain: encodeTerrainField(field),
    })
    const result = readSiteTerrain({ [site.id]: site }, { cellM: spacing }, context).result
    expect(result.slopeMeanDeg).toBeCloseTo(45)
  })

  test('a wedge reports its interior peak rather than only its corners', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++)
        field.heights[row * field.cols + col] = (2 - Math.abs(col - 3)) * 100
    const footprint = [
      [1, 1],
      [5, 1],
      [5, 5],
      [1, 5],
    ]
    const site = SiteNode.parse({
      id: 'site_wedge',
      polygon: { type: 'polygon', points: footprint },
      terrain: encodeTerrainField(field),
    })
    const result = readSiteTerrain({ [site.id]: site }, { cellM: 0.4 }, context).result
    expect(result.minM).toBe(0)
    // Ten edge intervals land on x=3, the peak; the four corners alone are all at zero.
    expect(result.maxM).toBeCloseTo(2)
    expect(result.reliefM).toBeCloseTo(2)
    expect(result.slopeMaxDeg).toBeCloseTo(45)
    expect(result.slopeMeanDeg as number).toBeGreaterThan(0)
    expect(result.slopeMeanDeg as number).toBeLessThan(45)
  })

  test('changing only persisted terrain changes facts and emits no changes', () => {
    const before = ramp()
    const after = ramp(2)
    const first = readSiteTerrain(before, {}, context)
    const second = readSiteTerrain(after, {}, context)
    expect(first.result.reliefM).toBe(4)
    expect(second.result.reliefM).toBe(8)
    expect(Object.keys(first)).toEqual(['result'])
    expect(Object.keys(second)).toEqual(['result'])
    expect(before).toEqual(ramp())
    expect(after).toEqual(ramp(2))
  })

  test('reads persisted terrain even during a different live stroke', () => {
    const nodes = ramp()
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    useLiveTerrain.getState().begin('site_terrain', field)
    try {
      expect(readSiteTerrain(nodes, {}, context).result.reliefM).toBe(4)
    } finally {
      useLiveTerrain.getState().end('site_terrain')
    }
  })

  test('two segment calls form a polyline without duplicate joints', () => {
    const first = sampleTerrainLine(ramp(), { from: [1, 2], to: [3, 2], stepM: 1 }, context).result
      .points as { x: number; z: number; yM: number }[]
    const second = sampleTerrainLine(ramp(), { from: [3, 2], to: [3, 4], stepM: 1 }, context).result
      .points as { x: number; z: number; yM: number }[]
    expect([...first, ...second.slice(1)].map(({ x, z, yM }) => [x, z, yM])).toEqual([
      [1, 2, -2],
      [2, 2, -1],
      [3, 2, 0],
      [3, 3, 0],
      [3, 4, 0],
    ])
  })

  test('ramp contours have equal height with labelled marching-squares approximation', () => {
    const result = readTerrainContours(ramp(), { intervalM: 1 }, context).result
    const lines = result.lines as { levelM: number; points: number[][] }[]
    expect(lines.map((line) => line.levelM)).toContain(0)
    for (const line of lines)
      for (const point of line.points) expect((point[0] ?? NaN) - 3).toBeCloseTo(line.levelM)
    expect(result.sampling).toMatchObject({
      approximate: true,
      method: 'marching_squares_midpoint_mask',
      intervalM: 1,
    })
  })

  test('an encoded flat field is measured flat, unlike an absent field', () => {
    const site = SiteNode.parse({
      id: 'site_flat',
      polygon: { type: 'polygon', points: square },
      terrain: encodeTerrainField(createTerrainField({ cols: 9, rows: 9, spacing: 1 })),
    })
    const nodes = { [site.id]: site }
    expect(readSiteTerrain(nodes, {}, context).result).toMatchObject({
      hasTerrain: true,
      flat: true,
      reliefM: 0,
      slopeMeanDeg: 0,
      areaAboveGradeM2: 0,
      areaBelowGradeM2: 0,
    })
    expect(readTerrainContours(nodes, {}, context).result.lines).toEqual([])
  })

  test('a footprint whose grid misses its interior refuses unknown areas', () => {
    expect(
      refusalCode(() =>
        readSiteTerrain(
          ramp(),
          {
            footprint: [
              [1, 1],
              [5, 5],
              [5, 5.01],
            ],
            cellM: 4,
          },
          context,
        ),
      ),
    ).toBe('sampling_insufficient')
  })

  test('self-crossing footprints are refused', () => {
    expect(
      refusalCode(() =>
        readSiteTerrain(
          ramp(),
          {
            footprint: [
              [1, 1],
              [5, 5],
              [1, 5],
              [5, 1],
            ],
          },
          context,
        ),
      ),
    ).toBe('invalid_polygon')
  })

  test('multiple sites do not silently select one', () => {
    const nodes = ramp()
    const site = SiteNode.parse({ id: 'site_other' })
    expect(refusalCode(() => readSiteTerrain({ ...nodes, [site.id]: site }, {}, context))).toBe(
      'ambiguous_site',
    )
  })

  test('bad fields refuse no_terrain instead of measuring zero', () => {
    const nodes = ramp()
    const site = nodes.site_terrain as SiteNode
    expect(
      refusalCode(() =>
        readSiteTerrain(
          {
            ...nodes,
            [site.id]: { ...site, terrain: { ...site.terrain, heights: 'broken' } } as SiteNode,
          },
          {},
          context,
        ),
      ),
    ).toBe('no_terrain')
  })

  for (const input of [
    { cellM: 0 },
    { cellM: -1 },
    { cellM: Infinity },
    { footprint: [[1, NaN]] },
    { invented: true },
  ])
    test(`invalid terrain input refuses with a code: ${JSON.stringify(input)}`, () => {
      expect(refusalCode(() => readSiteTerrain(ramp(), input as never, context))).toBe(
        'invalid_input',
      )
    })
})
