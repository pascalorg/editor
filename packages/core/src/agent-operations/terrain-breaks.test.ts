import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  terrainBreaksOf,
} from '@pascal-app/core'
import {
  AGENT_OPERATIONS,
  addTerrainBreak,
  applySceneChanges,
  carveTerrainPad,
} from '@pascal-app/core/agent-operations'
import {
  AGENT_TOOL_CONTRACTS,
  addTerrainBreakTool,
  isAgentRefusal,
} from '@pascal-app/core/agent-tools'
import { type AnyNode, SiteNode, TerrainTileNode } from '@pascal-app/core/schema'

type Nodes = Record<string, AnyNode>
const context = { activeLevelId: null }
const line: [number, number][] = [
  [4, 0],
  [4, 8],
]
const pad: [number, number][] = [
  [2.13, 2.27],
  [5.13, 2.27],
  [5.13, 4.27],
  [2.13, 4.27],
]

function scene(spacing = 0.95): Nodes {
  const field = createTerrainField({ cols: 20, rows: 20, spacing, origin: [-0.13, -0.27] })
  field.heights.fill(125)
  const site = SiteNode.parse({
    id: 'site_breaks',
    terrain: encodeTerrainField(field),
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
    },
  })
  return { [site.id]: site }
}

function fieldOf(nodes: Nodes) {
  const field = persistedTerrainFieldOf(nodes.site_breaks as SiteNode, nodes)
  if (!field) throw new Error('Expected authoritative terrain')
  return field
}

function applied(nodes: Nodes, outcome: ReturnType<typeof addTerrainBreak>): Nodes {
  if (!outcome.changes) throw new Error('Expected terrain operation changes')
  return applySceneChanges(nodes, outcome.changes) as Nodes
}

function refusalCode(call: () => unknown) {
  try {
    call()
  } catch (error) {
    return isAgentRefusal(error) ? error.code : String(error)
  }
  return null
}

// The operation must persist semantic breaks, never approximate a cliff by
// distorting samples or inventing a thick slab. Original scene bytes are a
// read-only oracle, while the target terrace height comes from the request.
describe('add_terrain_break', () => {
  test('a tile-covered keep-ground region with no same-side samples is refused, not replaced by datum', () => {
    const samples = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
    samples.heights.fill(500)
    const tile = TerrainTileNode.parse({
      id: 'terrain-tile_isolated',
      parentId: 'site_breaks',
      ix: 0,
      iz: 0,
      heights: encodeTerrainField(samples).heights,
    })
    const site = SiteNode.parse({ id: 'site_breaks', children: [tile.id] })
    const nodes: Nodes = { [site.id]: site, [tile.id]: tile }
    const frozen = JSON.stringify(nodes)
    expect(heightAt(fieldOf(nodes), 0.25, 0.25)).toBe(5)
    const code = refusalCode(() =>
      addTerrainBreak(
        nodes,
        {
          line: [
            [0.2, 0.2],
            [0.3, 0.2],
            [0.3, 0.3],
            [0.2, 0.3],
            [0.2, 0.2],
          ],
          kind: 'retaining',
          left: 'ground',
          right: 2,
        },
        context,
      ),
    )
    expect(code).toBe('unsupported_geometry')
    expect(JSON.stringify(nodes)).toBe(frozen)
    expect(heightAt(fieldOf(nodes), 0.25, 0.25)).toBe(5)
  })

  test('one public contract creates a site child with exact numeric sides and measured facts', () => {
    expect(AGENT_OPERATIONS.add_terrain_break).toBe(addTerrainBreak)
    expect(AGENT_TOOL_CONTRACTS.filter((tool) => tool.name === 'add_terrain_break')).toHaveLength(1)
    expect(addTerrainBreakTool.name).toBe('add_terrain_break')
    const nodes = scene()
    const frozen = JSON.stringify(nodes)
    const outcome = addTerrainBreak(nodes, { line, kind: 'cliff', left: 5, right: 2 }, context)
    expect(outcome.changes).toBeDefined()
    const after = applied(nodes, outcome)
    const breaks = terrainBreaksOf(after.site_breaks as SiteNode, after)
    expect(breaks).toHaveLength(1)
    const edge = breaks[0]
    if (!edge) throw new Error('Expected the created terrain break')
    expect(edge).toMatchObject({ parentId: 'site_breaks', line, kind: 'cliff', left: 5, right: 2 })
    expect((after.site_breaks as SiteNode).children).toContain(edge.id)
    expect(outcome.result).toMatchObject({
      breakId: edge.id,
      lengthM: 8,
      left: { minM: 5, maxM: 5 },
      right: { minM: 2, maxM: 2 },
      dropMinM: 3,
      dropMaxM: 3,
      faceAreaM2: 24,
    })
    expect(heightAt(fieldOf(after), 4 - 1e-7, 3)).toBe(5)
    expect(heightAt(fieldOf(after), 4 + 1e-7, 3)).toBe(2)
    expect((after.site_breaks as SiteNode).terrain).toEqual((nodes.site_breaks as SiteNode).terrain)
    expect(
      Object.values(after).filter((node) => node.type === 'terrain-tile' || node.type === 'slab'),
    ).toEqual([])
    expect(JSON.stringify(nodes)).toBe(frozen)
  })

  test('refuses unsupported bends and internal endpoints honestly without changing the input', () => {
    for (const unsupported of [
      [
        [0, 2],
        [4, 3],
        [8, 2],
      ],
      [
        [3, 3],
        [5, 5],
      ],
      [
        [1, 1],
        [7, 7],
        [1, 7],
        [7, 1],
        [1, 1],
      ],
    ] satisfies [number, number][][]) {
      const nodes = scene()
      const frozen = JSON.stringify(nodes)
      expect(
        refusalCode(() =>
          addTerrainBreak(
            nodes,
            {
              line: unsupported,
              kind: 'cliff',
              left: 5,
              right: 'ground',
            },
            context,
          ),
        ),
      ).toBe('unsupported_geometry')
      expect(JSON.stringify(nodes)).toBe(frozen)
    }
  })

  test('refuses crossing breaks atomically, rather than guessing their precedence', () => {
    const nodes = scene()
    const first = addTerrainBreak(nodes, { line, kind: 'cliff', left: 5, right: 2 }, context)
    const after = applied(nodes, first)
    const frozen = JSON.stringify(after)
    expect(
      refusalCode(() =>
        addTerrainBreak(
          after,
          {
            line: [
              [0, 4],
              [8, 4],
            ],
            kind: 'retaining',
            left: 3,
            right: 'ground',
          },
          context,
        ),
      ),
    ).toBe('crossing_breaks')
    expect(JSON.stringify(after)).toBe(frozen)
    expect(terrainBreaksOf(after.site_breaks as SiteNode, after)).toHaveLength(1)
  })
})

describe('carve_terrain_pad discontinuous edges', () => {
  test('a retaining pool terrace composes over the upper region of an existing cliff', () => {
    const nodes = scene()
    const cliff = addTerrainBreak(nodes, { line, kind: 'cliff', left: 5, right: 2 }, context)
    const withCliff = applied(nodes, cliff)
    const outcome = carveTerrainPad(
      withCliff,
      {
        pad: [
          [1, 2],
          [3, 2],
          [3, 6],
          [1, 6],
        ],
        padHeightM: 7,
        edges: 'retaining',
      },
      context,
    )
    const after = applied(withCliff, outcome)
    expect(terrainBreaksOf(after.site_breaks as SiteNode, after)).toHaveLength(2)
    expect(heightAt(fieldOf(after), 2, 4)).toBe(7)
    expect(heightAt(fieldOf(after), 3 + 1e-7, 4)).toBe(5)
    expect(heightAt(fieldOf(after), 4 + 1e-7, 4)).toBe(2)
    expect(
      Object.values(after).filter((node) => node.type === 'slab' || node.type === 'terrain-tile'),
    ).toEqual([])
    expect((after.site_breaks as SiteNode).terrain).toEqual((nodes.site_breaks as SiteNode).terrain)
  })

  for (const edges of ['retaining', 'cliff'] as const) {
    for (const spacing of [0.5, 0.95]) {
      test(`${edges} on a ${spacing} m legacy field makes an exact pool terrace without terrain deformation`, () => {
        const nodes = scene(spacing)
        const frozen = JSON.stringify(nodes)
        const before = fieldOf(nodes)
        const outcome = carveTerrainPad(nodes, { pad, padHeightM: 4, edges }, context)
        const after = applied(nodes, outcome)
        const breaks = terrainBreaksOf(after.site_breaks as SiteNode, after)
        expect(breaks).toHaveLength(1)
        const edge = breaks[0]
        if (!edge) throw new Error('Expected the retaining or cliff pad boundary')
        expect(edge).toMatchObject({ kind: edges, left: 4, right: 'ground' })
        expect(edge.line[0]).toEqual(edge.line.at(-1))
        let twiceArea = 0
        for (let i = 0; i + 1 < edge.line.length; i++) {
          const a = edge.line[i]
          const b = edge.line[i + 1]
          if (!a || !b) throw new Error('Expected consecutive terrain break vertices')
          twiceArea += a[0] * b[1] - b[0] * a[1]
        }
        expect(twiceArea).toBeCloseTo(12, 8)
        const field = fieldOf(after)
        for (const [x, z] of [
          [3, 3],
          [2.13 + 1e-7, 3],
          [5.13 - 1e-7, 3],
          [4, 2.27 + 1e-7],
          [4, 4.27 - 1e-7],
        ] as const)
          expect(Math.abs(heightAt(field, x, z) - 4)).toBeLessThanOrEqual(0.001)
        for (const [x, z] of [
          [2.13 - 1e-7, 3],
          [5.13 + 1e-7, 3],
          [4, 2.27 - 1e-7],
          [4, 4.27 + 1e-7],
          [7, 7],
        ] as const)
          expect(heightAt(field, x, z)).toBe(heightAt(before, x, z))
        expect(
          Object.values(after).filter(
            (node) => node.type === 'slab' || node.type === 'terrain-tile',
          ),
        ).toEqual([])
        expect((after.site_breaks as SiteNode).terrain).toEqual(
          (nodes.site_breaks as SiteNode).terrain,
        )
        expect(JSON.stringify(nodes)).toBe(frozen)
      })
    }
  }

  test('retaining edges also preserve existing tile payloads byte-for-byte', () => {
    const nodes = scene()
    const field = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
    field.heights.fill(125)
    const tile = TerrainTileNode.parse({
      id: 'terrain-tile_existing',
      parentId: 'site_breaks',
      ix: 0,
      iz: 0,
      heights: encodeTerrainField(field).heights,
    })
    nodes[tile.id] = tile
    nodes.site_breaks = SiteNode.parse({ ...nodes.site_breaks, children: [tile.id] })
    const frozenTile = JSON.stringify(tile)
    const outcome = carveTerrainPad(nodes, { pad, padHeightM: 4, edges: 'retaining' }, context)
    const after = applied(nodes, outcome)
    expect(JSON.stringify(after[tile.id])).toBe(frozenTile)
    expect(Object.values(after).filter((node) => node.type === 'terrain-tile')).toHaveLength(1)
    expect(heightAt(fieldOf(after), 3, 3)).toBe(4)
    expect(heightAt(fieldOf(after), 6, 3)).toBe(1.25)
  })
})
