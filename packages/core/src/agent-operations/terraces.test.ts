import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { closedHollows } from '../lib/terrain-hollows'
import type { AnyNode, StairNode } from '../schema'
import { type Ground, groundAt, runTool, slopedLot } from './__fixtures__/sloped-lots'
import { type TerrainFacts, terrainFacts } from './terrain-facts'

/*
 * Terraces that touch. Two closed terrain breaks may not touch, so two retaining pads side by
 * side left a strip of the natural slope between them: a trench 0.5 m deep and more between two
 * terraces (the trial team's D14). add_terraces alternates a break and level lattice ground, so
 * each face between two neighbours is one edge of one break. The lot falls toward +x at 20 %.
 */

type Nodes = Record<string, AnyNode>
const slope: Ground = (x) => -0.2 * x
const lot = (house = false) => slopedLot({ ground: slope, house })
const refusal = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return undefined
}
/** The ground along the middle of the terraces, every 0.1 m. */
const profile = (nodes: Nodes, from: number, to: number, z = 0) =>
  Array.from({ length: Math.round((to - from) / 0.1) + 1 }, (_, i) =>
    groundAt(nodes, from + 0.1 * i, z),
  )

describe('add_terraces', () => {
  const cases = [
    {
      name: 'three terraces, each at the mean of its ground',
      input: { count: 3 },
      levels: [-0.6, -1.4, -2.2],
    },
    {
      name: 'four terraces between two stated heights',
      input: { count: 4, topM: -0.3, bottomM: -2.1 },
      levels: [-0.3, -0.9, -1.5, -2.1],
    },
    { name: 'two terraces from a stated top', input: { count: 2, topM: 0 }, levels: [0, -1.2] },
  ] as const
  for (const { name, input, levels } of cases)
    test(`${name}: level treads that touch, one vertical face between each two, no trench, no hollow`, () => {
      const { nodes, result } = runTool(lot(), 'add_terraces', {
        line: [
          [1, 0],
          [13, 0],
        ],
        widthM: 8,
        ...input,
      })
      const terraces = result.terraces as { levelM: number; heldAs: string; breakId?: string }[]
      expect(terraces.map((terrace) => terrace.levelM)).toEqual(levels as unknown as number[])
      expect(terraces.map((terrace) => terrace.heldAs)).toEqual(
        levels.map((_, index) => (index % 2 === 0 ? 'break' : 'lattice')),
      )
      const tread = 12 / levels.length
      const ground = profile(nodes, 1, 13)
      // Every point of the section stands at its terrace's level: nothing lies between two terraces.
      ground.forEach((height, i) => {
        const x = 0.1 * i
        const index = Math.min(levels.length - 1, Math.floor((x + 1e-6) / tread))
        const onFace = Math.abs(x / tread - Math.round(x / tread)) < 1e-6
        if (!onFace) expect(height).toBeCloseTo(levels[index] as number, 2)
      })
      // And across each face the ground steps by the whole riser within 0.1 m.
      for (let index = 1; index < levels.length; index++) {
        const x = 1 + index * tread
        expect(groundAt(nodes, x - 0.05, 0) - groundAt(nodes, x + 0.05, 0)).toBeCloseTo(
          (levels[index - 1] as number) - (levels[index] as number),
          2,
        )
      }
      const read = terrainFacts(nodes) as TerrainFacts
      expect(read.retaining.length).toBe(Math.ceil(levels.length / 2))
      expect(read.open.filter((finding) => finding.code === 'steep_bank')).toEqual([])
      const edges = result.edges as { at: string; heldBy: string }[]
      expect(edges.at(-1)?.heldBy).toBe(levels.length % 2 === 1 ? 'wall' : 'bank')
      expect(
        closedHollows((x, z) => groundAt(nodes, x, z), {
          bounds: { minX: -2, minZ: -7, maxX: 15, maxZ: 7 },
          minDepthM: 0.05,
        }),
      ).toEqual([])
    })

  test('cut and fill of a terrace at the mean of its ground are alike', () => {
    const { result } = runTool(lot(), 'add_terraces', {
      line: [
        [1, 0],
        [13, 0],
      ],
      widthM: 8,
      count: 3,
    })
    const cut = result.cutVolumeM3 as number
    const fill = result.fillVolumeM3 as number
    expect(cut).toBeGreaterThan(5)
    expect(Math.abs(cut - fill)).toBeLessThan(0.25 * (cut + fill))
  })

  test('stepsAt: a flight from each terrace to the one above, its foot on the lower, its top at the upper', () => {
    const { nodes, result } = runTool(lot(true), 'add_terraces', {
      line: [
        [7, 12],
        [14, 12],
      ],
      widthM: 6,
      count: 3,
      stepsAt: 0.5,
    })
    const steps = result.steps as { stairId: string; riseM: number; stepCount: number }[]
    expect(steps.length).toBe(2)
    for (const flight of steps) {
      expect(flight.riseM / flight.stepCount).toBeLessThanOrEqual(0.19)
      expect((nodes[flight.stairId] as StairNode).totalRise).toBeCloseTo(flight.riseM, 3)
    }
    const read = terrainFacts(nodes) as TerrainFacts
    for (const flight of read.steps)
      expect(Math.abs(flight.footOverGroundM)).toBeLessThanOrEqual(0.05)
    const levels = (result.terraces as { levelM: number }[]).map((terrace) => terrace.levelM)
    expect(read.steps.map((flight) => flight.topM).sort()).toEqual(
      [levels[0], levels[1]].map((level) => Math.round((level as number) * 100) / 100).sort(),
    )
  })

  test('with no building to hold a flight, none is made and the answer says so', () => {
    const { result } = runTool(lot(), 'add_terraces', {
      line: [
        [1, 0],
        [13, 0],
      ],
      widthM: 8,
      count: 3,
      stepsAt: 0.5,
    })
    expect(result.steps).toBeUndefined()
    expect(result.stepsNote as string).toContain('No flight was made')
  })

  const refusals: [string, Record<string, unknown>, string][] = [
    [
      'terraces under 1.5 m deep',
      {
        line: [
          [1, 0],
          [13, 0],
        ],
        widthM: 8,
        count: 12,
      },
      'invalid_input',
    ],
    [
      'a line under 3 m',
      {
        line: [
          [1, 0],
          [2, 0],
        ],
        widthM: 8,
        count: 2,
      },
      'invalid_input',
    ],
    [
      'a line over 200 m',
      {
        scope: 'context',
        line: [
          [-150, 0],
          [150, 0],
        ],
        widthM: 8,
        count: 2,
      },
      'invalid_input',
    ],
    [
      'a point 10 km away',
      {
        scope: 'context',
        line: [
          [1, 0],
          [10_000, 0],
        ],
        widthM: 8,
        count: 2,
      },
      'invalid_input',
    ],
    [
      'a point that is not finite',
      {
        line: [
          [1, 0],
          [Number.NaN, 0],
        ],
        widthM: 8,
        count: 2,
      },
      'invalid_input',
    ],
    [
      'terraces that leave the lot',
      {
        line: [
          [1, 0],
          [13, 0],
        ],
        widthM: 60,
        count: 3,
      },
      'outside_property',
    ],
    [
      'a count of 13',
      {
        line: [
          [1, 0],
          [13, 0],
        ],
        widthM: 8,
        count: 13,
      },
      'invalid_input',
    ],
    [
      'a width of 1 km',
      {
        scope: 'context',
        line: [
          [1, 0],
          [13, 0],
        ],
        widthM: 1000,
        count: 3,
      },
      'invalid_input',
    ],
  ]
  for (const [name, input, code] of refusals)
    test(`refused, at once: ${name} (${code})`, () => {
      const started = performance.now()
      expect(refusal(() => runTool(lot(), 'add_terraces', input))).toBe(code)
      expect(performance.now() - started).toBeLessThan(1000)
    })

  test('terraces laid over a break that is there are refused, nothing written', () => {
    const first = runTool(lot(), 'add_terraces', {
      line: [
        [1, 0],
        [13, 0],
      ],
      widthM: 8,
      count: 3,
    }).nodes
    expect(
      refusal(() =>
        runTool(first, 'add_terraces', {
          line: [
            [3, 2],
            [12, 2],
          ],
          widthM: 8,
          count: 3,
        }),
      ),
    ).toBe('crossing_breaks')
  })
})
