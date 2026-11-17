import { describe, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  type TerrainField,
  terrainBreakFacts,
  useScene,
} from '@pascal-app/core'
import {
  AGENT_OPERATIONS,
  applySceneChanges,
  gradeAroundHouse,
} from '@pascal-app/core/agent-operations'
import {
  AGENT_TOOL_CONTRACTS,
  gradeAroundHouseTool,
  isAgentRefusal,
} from '@pascal-app/core/agent-tools'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  type TerrainBreakNode,
} from '@pascal-app/core/schema'
import type { AgentOperationOutcome } from './types'

/*
 * The ground around a house as a function of the distance to its outline: a pad, then a batter to the
 * ground that was there. Every scene here is a 40 x 40 m lot (−20…20) on a 0.5 m field; the house is
 * the rectangle x −5…5, z 0…6 and its rear (the uphill side where there is one) is toward −z.
 */

type Nodes = Record<string, AnyNode>
type Point = [number, number]
const context = { activeLevelId: null }
const HOUSE: Point[] = [
  [-5, 0],
  [5, 0],
  [5, 6],
  [-5, 6],
]

/** A lot whose natural ground is `ground(x, z)` metres. */
function lot(
  ground: (x: number, z: number) => number,
  extra: AnyNode[] = [],
  siteFields: Record<string, unknown> = {},
): Nodes {
  const field = createTerrainField({ origin: [-20, -20], spacing: 0.5, cols: 81, rows: 81 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      field.heights[row * field.cols + col] = Math.round(
        ground(-20 + col * 0.5, -20 + row * 0.5) / field.step,
      )
  const site = SiteNode.parse({
    id: 'site_grade',
    polygon: {
      type: 'polygon',
      points: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
    },
    terrain: encodeTerrainField(field),
    children: extra.map((node) => node.id),
    ...siteFields,
  })
  return { [site.id]: site, ...Object.fromEntries(extra.map((node) => [node.id, node])) }
}

const grade = (nodes: Nodes, input: Record<string, unknown> = {}) => {
  const outcome = gradeAroundHouse(
    nodes,
    { footprint: HOUSE, padHeightM: 0, scope: 'context', ...input },
    context,
  )
  return { outcome, after: applied(nodes, outcome) }
}

function applied(nodes: Nodes, outcome: AgentOperationOutcome): Nodes {
  return outcome.changes ? (applySceneChanges(nodes, outcome.changes) as Nodes) : nodes
}

function fieldOf(nodes: Nodes): TerrainField {
  const field = persistedTerrainFieldOf(nodes.site_grade as SiteNode, nodes)
  if (!field) throw new Error('expected a persisted field')
  return field
}

const groundAt = (nodes: Nodes, x: number, z: number) => heightAt(fieldOf(nodes), x, z)
const refusalCode = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return undefined
}

/** The lot's street edge is its +z side: the rear is −z, where ground rises. */
const STREET_AT_PLUS_Z = { frontEdge: 2 }

/** Ground that rises toward −z at `slope` metres per metre. */
const risingBehind = (slope: number) => (_x: number, z: number) => Math.max(0, -z) * slope

describe('grade_around_house: the batter', () => {
  test('rises at the stated run from the pad edge, in a cut', () => {
    const { after, outcome } = grade(lot(risingBehind(1)), { run: 2, marginM: 1 })
    // −z is uphill; the pad reaches 1 m beyond the wall (z = −1), then 1 m of height per 2 m of ground.
    for (const [z, rise] of [
      [-1, 0],
      [-3, 1],
      [-5, 2],
      [-7, 3],
    ] as const)
      expect(groundAt(after, 0, z)).toBeCloseTo(rise, 1)
    expect(outcome.result.batterSlopeDeg).toBeCloseTo(26.57, 1)
    expect(outcome.result.cutVolumeM3).toBeGreaterThan(0)
    expect(outcome.result.fillVolumeM3).toBe(0)
  })

  test('falls at the stated run, in a fill, and stops where it meets the ground', () => {
    const { after, outcome } = grade(
      lot(() => -1.5),
      { run: 2, marginM: 1 },
    )
    // The ground is 1.5 m under the pad: the batter falls 1 m per 2 m and daylights 3 m from the pad edge.
    expect(groundAt(after, 0, -3)).toBeCloseTo(-1, 1)
    expect(groundAt(after, 0, -4)).toBeCloseTo(-1.5, 1)
    expect(groundAt(after, 0, -9)).toBeCloseTo(-1.5, 2)
    expect(outcome.result.fillVolumeM3).toBeGreaterThan(0)
    expect(outcome.result.cutVolumeM3).toBe(0)
    expect(outcome.result.daylight).toMatchObject({ reached: true })
  })

  test('a gentler ground than the batter is left as it is, past the daylight line', () => {
    const natural = risingBehind(0.25)
    const { after, outcome } = grade(lot(natural), { run: 2, marginM: 1 })
    // 1:4 ground against a 1:2 batter: the line meets it 2 m behind the wall; beyond that nothing moves.
    expect(groundAt(after, 0, -6)).toBeCloseTo(natural(0, -6), 2)
    expect(groundAt(after, 0, -2)).toBeCloseTo(0.5, 1)
    expect((outcome.result.daylight as { farthestChangeM: number }).farthestChangeM).toBeLessThan(2)
  })

  test('never raises ground on a cut side nor lowers it on a fill side', () => {
    const lowAndHigh = (x: number) => (x < 0 ? 3 : -3)
    const { after } = grade(
      lot((x) => lowAndHigh(x)),
      { run: 2 },
    )
    const before = fieldOf(lot((x) => lowAndHigh(x)))
    for (const x of [-12, -8, 8, 12]) {
      const was = heightAt(before, x, 3)
      const now = groundAt(after, x, 3)
      if (was > 0) expect(now).toBeLessThanOrEqual(was + 1e-9)
      else expect(now).toBeGreaterThanOrEqual(was - 1e-9)
    }
  })
})

describe('grade_around_house: terraces', () => {
  test('the batter is cut into treads run times as wide as the riser, on the lattice', () => {
    const { after, outcome } = grade(lot(risingBehind(2)), {
      run: 2,
      marginM: 1,
      terraceRiserM: 0.5,
    })
    // Tread 1 m: the ground is at 0 up to u = 1 m, 0.5 to 2 m, 1.0 to 3 m … (u from the pad edge, z = −1 − u).
    const heights = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((u) => groundAt(after, 0, -1 - u))
    expect(heights.map((height) => Math.round(height * 100) / 100)).toEqual([
      0, 0.5, 0.5, 1, 1, 1.5, 1.5, 2,
    ])
    for (const z of [-2, -3, -4, -5, -6]) {
      const level = groundAt(after, 0, z) / 0.5
      expect(level).toBeCloseTo(Math.round(level), 1)
    }
    expect(outcome.result.terraces).toEqual({ riserM: 0.5, treadM: 1, resolutionM: 0.5 })
  })
})

describe('grade_around_house: it follows the outline', () => {
  test('equal distances from a convex corner are equal heights: the slope is rounded there', () => {
    const { after } = grade(
      lot(() => 3),
      { run: 2, marginM: 1 },
    )
    // The house's rear-right corner is (5, 0); both points are 2.5 m from it (a 3-4-5 triangle).
    const along = groundAt(after, 7.5, 0)
    const around = groundAt(after, 6.5, -2)
    expect(along).toBeCloseTo((2.5 - 1) / 2, 1)
    expect(around).toBeCloseTo(along, 2)
    // A square offset would put the diagonal point 2.0 m out, not 2.5 m: 0.5 m of batter, not 0.75 m.
    expect(Math.abs(around - 0.5)).toBeGreaterThan(0.2)
  })

  test('a bent outline gives the batter its offset', () => {
    const lShape: Point[] = [
      [-5, 0],
      [5, 0],
      [5, 6],
      [0, 6],
      [0, 3],
      [-5, 3],
    ]
    const { after } = grade(
      lot(() => 3),
      { footprint: lShape, run: 2, marginM: 1 },
    )
    // The inner corner (0, 3): the point 2 m into the notch's corner region is 2 m from both walls.
    const inNotch = groundAt(after, -2, 5)
    expect(inNotch).toBeCloseTo((2 - 1) / 2, 1)
  })
})

describe('grade_around_house: a declared wall', () => {
  test('makes a vertical step at the pad edge where it is declared, and none where it is not', () => {
    const base = lot(risingBehind(2))
    const walled = grade(base, { run: 2, marginM: 1, wallM: 1.3 })
    const plain = grade(base, { run: 2, marginM: 1 })
    const step = (nodes: Nodes) => groundAt(nodes, 0, -1.5) - groundAt(nodes, 0, -1)
    expect(step(walled.after)).toBeGreaterThan(1.3)
    expect(step(plain.after)).toBeLessThan(0.5)
    expect(walled.outcome.result.wall).toMatchObject({
      heightM: 1.3,
      exact: false,
      resolutionM: 0.5,
    })
    expect(plain.outcome.result.wall).toBeUndefined()
  })
})

describe('grade_around_house: where it meets other terrain', () => {
  test('ground an earlier pad leveled is cut where it stands above the batter and left where it is below', () => {
    const early = AGENT_OPERATIONS.carve_terrain_pad!(
      lot(risingBehind(1)),
      {
        pad: [
          [-6, -10],
          [6, -10],
          [6, -4],
          [-6, -4],
        ],
        padHeightM: 2.5,
        blendM: 1,
      },
      context,
    )
    const padded = applied(lot(risingBehind(1)), early)
    const { after } = grade(padded, { run: 2, marginM: 1 })
    // The batter line at z = −5 is 2 m high, at z = −8 it is 3.5 m: the 2.5 m pad is cut at the first, kept at the second.
    expect(groundAt(after, 0, -5)).toBeCloseTo(2, 1)
    expect(groundAt(after, 0, -8)).toBeCloseTo(2.5, 1)
  })

  test('a numeric terrain break sets its heights whatever the batter writes under it', () => {
    const base = lot(risingBehind(0.5))
    const wall = AGENT_OPERATIONS.add_terrain_break!(
      base,
      {
        line: [
          [-20, -10],
          [20, -10],
        ],
        kind: 'retaining',
        left: 'ground',
        right: 4,
      },
      context,
    )
    const walled = applied(base, wall)
    const { after } = grade(walled, { run: 2, reachM: 30 })
    // The ground behind z = −10 is the break's 4 m plane; the batter's own (reaching there) does not change it.
    expect(groundAt(after, 0, -14)).toBeCloseTo(4, 2)
    expect(groundAt(after, 0, -6)).toBeLessThan(4)
  })
})

describe('grade_around_house: the house comes from the scene', () => {
  function withHouse(slabElevation = 0.3): Nodes {
    const building = BuildingNode.parse({
      id: 'building_g',
      parentId: 'site_grade',
      children: ['level_g'],
    })
    const level = LevelNode.parse({
      id: 'level_g',
      parentId: building.id,
      level: 0,
      height: 3,
      children: ['slab_g'],
    })
    const slab = SlabNode.parse({
      id: 'slab_g',
      parentId: level.id,
      boundary: 'auto',
      polygon: HOUSE,
      elevation: slabElevation,
    })
    return lot(risingBehind(1), [building, level, slab])
  }

  test('the lowest slab is the outline and the pad stands under its top', () => {
    const outcome = gradeAroundHouse(withHouse(0.3), {}, context)
    expect(outcome.result).toMatchObject({ levelId: 'level_g', slabId: 'slab_g', slabTopM: 0.3 })
    expect(outcome.result.padHeightM).toBeCloseTo(0.15, 6)
    expect(outcome.result.footprint).toEqual(HOUSE)
  })

  test('is one undo step, and undo restores the ground byte for byte', () => {
    const original = useScene.getState()
    try {
      const before = withHouse()
      const beforeTerrain = JSON.stringify((before.site_grade as SiteNode).terrain)
      useScene.setState({ nodes: before, rootNodeIds: ['site_grade'] } as never)
      clearSceneHistory()
      const outcome = gradeAroundHouse(before, {}, context)
      useScene.setState({ nodes: applied(before, outcome) } as never)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      const restored = useScene.getState().nodes as Nodes
      expect(JSON.stringify((restored.site_grade as SiteNode).terrain)).toBe(beforeTerrain)
    } finally {
      useScene.setState(original)
      clearSceneHistory()
    }
  })

  test('the agent tool contract and the operation are registered under one name', () => {
    expect(AGENT_TOOL_CONTRACTS).toContain(gradeAroundHouseTool)
    expect(AGENT_OPERATIONS.grade_around_house).toBe(gradeAroundHouse)
  })
})

describe('grade_around_house: refusals', () => {
  test.each([
    ['a given footprint needs its pad height', { footprint: HOUSE }, 'invalid_input'],
    [
      'a level and a footprint are not both given',
      { levelId: 'level_x', footprint: HOUSE, padHeightM: 0 },
      'invalid_input',
    ],
    [
      'an outline outside the property',
      {
        footprint: [
          [30, 30],
          [34, 30],
          [34, 34],
          [30, 34],
        ],
        padHeightM: 0,
      },
      'outside_property',
    ],
    [
      'a run flatter than the schema allows',
      { footprint: HOUSE, padHeightM: 0, run: 0.1 },
      'invalid_input',
    ],
    ['a house with no slab', {}, 'footprint_empty'],
  ] as const)('%s', (_name, input, code) => {
    expect(
      refusalCode(() =>
        gradeAroundHouse(
          lot(() => 1),
          input as never,
          context,
        ),
      ),
    ).toBe(code)
  })

  test('grading ground that is already graded writes nothing', () => {
    const first = grade(lot(risingBehind(1)), { run: 2 })
    expect(
      refusalCode(() =>
        gradeAroundHouse(
          first.after,
          { footprint: HOUSE, padHeightM: 0, run: 2, scope: 'context' },
          context,
        ),
      ),
    ).toBe('no_change')
  })
})

const breaksOf = (nodes: Nodes) =>
  Object.values(nodes).filter((node): node is TerrainBreakNode => node.type === 'terrain-break')
const roundedTo = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places

describe('grade_around_house: a lawn after the bank', () => {
  test('raises low ground to the lawn level through a bank at the stated run, and cuts high ground to it', () => {
    for (const natural of [0, 5]) {
      const { after, outcome } = grade(
        lot(() => natural),
        { scope: 'lot', run: 2, marginM: 1, upperLevelM: 2 },
      )
      // The pad edge is 1 m from the wall (z = −1): 1 m of height per 2 m of ground, then 2 m flat, to the lot's edge.
      for (const [z, level] of [
        [-1, 0],
        [-3, 1],
        [-5, 2],
        [-18, 2],
      ] as const)
        expect(groundAt(after, 0, z)).toBeCloseTo(level, 1)
      expect(groundAt(after, 18, 18)).toBeCloseTo(2, 2)
      expect(outcome.result.lawn).toMatchObject({ levelM: 2, bankRunM: 4 })
    }
  })

  test('a lawn below the pad is a fill held up by the wall, and stops at the reach in scope context', () => {
    const { after, outcome } = grade(
      lot(() => 0),
      { scope: 'context', run: 2, marginM: 1, upperLevelM: -1, wallM: 0.5, reachM: 6 },
    )
    // Under the pad by wallM at the edge, then 1 m per 2 m down to the lawn at −1; nothing beyond 6 m from the pad edge.
    expect(groundAt(after, 0, -1.5)).toBeCloseTo(-0.75, 1)
    expect(groundAt(after, 0, -3)).toBeCloseTo(-1, 1)
    expect(groundAt(after, 0, -10)).toBeCloseTo(0, 2)
    expect(outcome.result.lawn).toMatchObject({ levelM: -1, bankRunM: 1 })
  })
})

describe('grade_around_house: a wall on the fill side', () => {
  test('stands below the pad by wallM, as it stands above it on the cut side', () => {
    const { after } = grade(
      lot(() => -3),
      { run: 2, marginM: 1, wallM: 1 },
    )
    // −1 m at the edge (the wall), then 1 m per 2 m down to the ground at −3.
    expect(groundAt(after, 0, -1.5)).toBeCloseTo(-1.25, 1)
    expect(groundAt(after, 0, -4)).toBeCloseTo(-2.5, 1)
    expect(groundAt(after, 0, -6)).toBeCloseTo(-3, 1)
  })
})

describe('grade_around_house: a band across the lot', () => {
  const rising = () => lot(risingBehind(1), [], STREET_AT_PLUS_Z)

  test('grades the rear edge across the whole width of the lot, not around the outline', () => {
    const ring = grade(rising(), { run: 2, marginM: 1 })
    const band = grade(rising(), { run: 2, marginM: 1, edge: { facing: 'rear' } })
    // 2 m behind the pad edge the batter is 1 m up, at the house's width and 15 m to the side of it alike.
    for (const x of [0, 4, 15]) expect(groundAt(band.after, x, -3)).toBeCloseTo(1, 1)
    expect(groundAt(ring.after, 0, -3)).toBeCloseTo(1, 1)
    expect(groundAt(ring.after, 15, -3)).toBeCloseTo(3, 1)
    expect(band.outcome.result.edge).toMatchObject({ role: 'rear', normal: [0, -1] })
  })

  test('the pad is the strip from the front of the outline to the edge, across the lot', () => {
    const sideways = (x: number) => 0.3 * x
    const band = grade(lot(sideways, [], STREET_AT_PLUS_Z), {
      scope: 'lot',
      marginM: 1,
      edge: { facing: 'rear' },
    })
    // Beside the house, inside the strip's depth (z 0…6), the ground is the pad's 0 out to the lot's side; in front of the strip it batters back to the ground.
    expect(groundAt(band.after, 15, 3)).toBeCloseTo(0, 2)
    expect(groundAt(band.after, -15, 3)).toBeCloseTo(0, 2)
    expect(groundAt(band.after, 15, 17)).toBeCloseTo(4.5, 1)
  })

  test('the lawn applies beyond the edge only; the front of the strip meets the ground as a ring does', () => {
    const { after } = grade(
      lot(() => -3, [], STREET_AT_PLUS_Z),
      { scope: 'lot', run: 2, marginM: 1, upperLevelM: 2, edge: { facing: 'rear' } },
    )
    expect(groundAt(after, 0, -18)).toBeCloseTo(2, 2)
    expect(groundAt(after, 15, -18)).toBeCloseTo(2, 2)
    expect(groundAt(after, 0, 18)).toBeCloseTo(-3, 2)
  })

  test('a direction and a line on the outline name the same edge as the lot side facing that way', () => {
    const facing = grade(rising(), { run: 2, edge: { facing: 'rear' } })
    for (const edge of [
      { direction: [0, -3] },
      {
        line: [
          [-20, 0],
          [20, 0],
        ],
      },
    ]) {
      const other = grade(rising(), { run: 2, edge })
      for (const [x, z] of [
        [0, -3],
        [12, -5],
        [-12, 3],
      ] as const)
        expect(groundAt(other.after, x, z)).toBeCloseTo(groundAt(facing.after, x, z), 2)
    }
    // A line beyond the outline moves the edge out with it.
    const beyond = grade(rising(), {
      run: 2,
      marginM: 1,
      edge: {
        line: [
          [-20, -2],
          [20, -2],
        ],
      },
    })
    expect(groundAt(beyond.after, 0, -3)).toBeCloseTo(0, 1)
    expect(groundAt(beyond.after, 0, -5)).toBeCloseTo(1, 1)
  })

  test.each([
    ['none of facing, direction, line', { edge: {} }],
    ['two of them', { edge: { facing: 'rear', direction: [0, -1] } }],
    [
      'a line across the house',
      {
        edge: {
          line: [
            [-20, 3],
            [20, 3],
          ],
        },
      },
    ],
    ['a direction with no length', { edge: { direction: [0, 0] } }],
  ])('an edge with %s is refused', (_name, input) => {
    expect(
      refusalCode(() =>
        gradeAroundHouse(
          rising(),
          { footprint: HOUSE, padHeightM: 0, scope: 'context', ...input } as never,
          context,
        ),
      ),
    ).toBe('invalid_input')
  })
})

describe('grade_around_house: an exact wall', () => {
  const faceOf = (after: Nodes) => {
    const [wall] = breaksOf(after)
    return terrainBreakFacts(wall as TerrainBreakNode, fieldOf(after))
  }

  test('is a retaining terrain-break whose pad side is the numeric plane, as high as declared on the cut side', () => {
    // Ground that climbs to 3 m within a metre behind the house: cut to the pad, then the wall, then a bank back up.
    const base = lot((_x, z) => Math.min(3, Math.max(0, -z * 3)))
    const { after, outcome } = grade(base, { run: 2, marginM: 1, wallM: 1, exactWall: true })
    const [wall] = breaksOf(after)
    expect(breaksOf(after)).toHaveLength(1)
    expect(wall).toMatchObject({ kind: 'retaining', left: 0, right: 'ground' })
    expect(wall?.line[0]).toEqual(wall?.line.at(-1))
    expect(outcome.result.wall).toMatchObject({
      heightM: 1,
      exact: true,
      kind: 'retaining',
      breakId: wall?.id,
    })
    expect(outcome.changes?.create?.some(({ node }) => node.type === 'terrain-break')).toBe(true)
    // The face stands exactly 1 m on the cut (rear) side; no lattice smears it.
    expect(roundedTo(faceOf(after).dropMaxM, 1)).toBe(1)
    expect(groundAt(after, 0, -0.9)).toBeCloseTo(0, 2)
    expect(groundAt(after, 0, -1.1)).toBeCloseTo(1.05, 1)
  })

  test('its face is not counted among the sampled slopes, as a lattice step is', () => {
    const lawn = { scope: 'lot', run: 2, marginM: 1, wallM: 1, upperLevelM: 2 }
    const exact = grade(
      lot(() => 0),
      { ...lawn, exactWall: true },
    )
    const lattice = grade(
      lot(() => 0),
      lawn,
    )
    // The bank is 1:2 (26.6 degrees); a 1 m step on the 0.5 m lattice reads 63 degrees.
    expect(exact.outcome.result.steepestSampledSlopeDeg as number).toBeLessThan(30)
    expect(lattice.outcome.result.steepestSampledSlopeDeg as number).toBeGreaterThan(55)
  })

  test('stands on the fill side too', () => {
    const { after } = grade(
      lot(() => -3),
      { run: 2, marginM: 1, wallM: 1, exactWall: true },
    )
    expect(roundedTo(faceOf(after).dropMaxM, 1)).toBe(1)
    expect(groundAt(after, 0, -0.9)).toBeCloseTo(0, 2)
    expect(groundAt(after, 0, -1.1)).toBeCloseTo(-1.05, 1)
  })

  test('rings the convex hull: a notch in the outline is filled into the pad', () => {
    const lShape: Point[] = [
      [-5, 0],
      [5, 0],
      [5, 6],
      [0, 6],
      [0, 3],
      [-5, 3],
    ]
    const { after } = grade(
      lot(() => 3),
      { footprint: lShape, run: 2, marginM: 1, wallM: 1, exactWall: true },
    )
    expect(groundAt(after, -3, 4.5)).toBeCloseTo(0, 2)
  })

  test('a second call for the same house replaces its wall', () => {
    const first = grade(lot(risingBehind(2)), { run: 2, marginM: 1, wallM: 1, exactWall: true })
    const [old] = breaksOf(first.after)
    const second = grade(first.after, { run: 2, marginM: 1, wallM: 0.5, exactWall: true })
    expect(breaksOf(second.after)).toHaveLength(1)
    expect(breaksOf(second.after)[0]?.id).not.toBe(old?.id)
    expect(roundedTo(faceOf(second.after).dropMaxM, 1)).toBe(0.5)
  })

  test('along a band it is one closed ring around the pad strip, clipped to the property', () => {
    const sideways = (x: number, z: number) => 0.3 * x + Math.max(0, -z)
    const { after, outcome } = grade(lot(sideways, [], STREET_AT_PLUS_Z), {
      scope: 'lot',
      run: 2,
      marginM: 1,
      wallM: 1,
      exactWall: true,
      edge: { facing: 'rear' },
    })
    // The house is z 0…6: the strip runs from 1 m in front of it (z = 7) to 1 m behind it (z = −1), across the lot (x −20…20).
    const [wall] = breaksOf(after)
    expect(breaksOf(after)).toHaveLength(1)
    expect(wall?.line[0]).toEqual(wall?.line.at(-1))
    expect(new Set(wall?.line.map(([x]) => x)).size).toBe(2)
    expect(new Set(wall?.line.map(([, z]) => z))).toEqual(new Set([-1, 7]))
    expect(outcome.result.wall).toMatchObject({ exact: true, lengthM: 2 * (40 + 8) })
    expect(outcome.result.wall).not.toHaveProperty('levelledHouseSide')
    expect(outcome.result.edge).toMatchObject({ padStripM: { fromM: -7, toM: 1 } })
    // Level inside the strip across the lot; beyond it the ground is the lot's own.
    expect(groundAt(after, 15, 3)).toBeCloseTo(0, 2)
    expect(groundAt(after, -15, 3)).toBeCloseTo(0, 2)
    expect(groundAt(after, 15, 15)).toBeCloseTo(4.5, 1)
    expect(groundAt(after, 0, -2.5)).toBeGreaterThan(1)
  })

  test('a lot that falls to the street keeps its fall in front of the strip, with no step at the property line', () => {
    const toTheStreet = (_x: number, z: number) => (z > 6 ? -(z - 6) / 7 : Math.max(0, -z) * 0.5)
    const base = lot(toTheStreet, [], STREET_AT_PLUS_Z)
    const { after } = grade(base, {
      scope: 'lot',
      run: 2,
      marginM: 1,
      wallM: 1,
      exactWall: true,
      edge: { facing: 'rear' },
    })
    // Level to the strip's front (z = 7); beyond it, and at the property line (z = 20), the ground is the lot's own fall.
    expect(groundAt(after, 0, 5)).toBeCloseTo(0, 2)
    for (const z of [10, 15, 19.5, 20])
      expect(groundAt(after, 0, z)).toBeCloseTo(toTheStreet(0, z), 1)
    expect(groundAt(after, 15, 20)).toBeCloseTo(toTheStreet(15, 20), 1)
  })

  test('a lot whose strip is not convex refuses an exact wall, and a lattice wall still grades', () => {
    // A lot with its front right corner cut away (x > 5, z > 2): the strip across z −1…7 has a reflex corner at (5, 2).
    const notched = {
      polygon: {
        type: 'polygon',
        points: [
          [-20, -20],
          [20, -20],
          [20, 2],
          [5, 2],
          [5, 20],
          [-20, 20],
        ],
      },
    }
    const input = {
      footprint: [
        [-5, 0],
        [4, 0],
        [4, 6],
        [-5, 6],
      ],
      padHeightM: 0,
      scope: 'lot',
      marginM: 1,
      wallM: 1,
      edge: { facing: 'rear' },
    }
    const lotWithNotch = lot(risingBehind(1), [], { ...STREET_AT_PLUS_Z, ...notched })
    expect(
      refusalCode(() =>
        gradeAroundHouse(lotWithNotch, { ...input, exactWall: true } as never, context),
      ),
    ).toBe('unsupported_geometry')
    expect(
      refusalCode(() => gradeAroundHouse(lotWithNotch, input as never, context)),
    ).toBeUndefined()
  })

  test.each([
    ['needs wallM', { exactWall: true }, 'invalid_input'],
    [
      'takes one pad',
      {
        pads: [
          { footprint: HOUSE, padHeightM: 0 },
          {
            footprint: [
              [8, 0],
              [12, 0],
              [12, 4],
              [8, 4],
            ],
            padHeightM: 0,
          },
        ],
        wallM: 1,
        exactWall: true,
      },
      'invalid_input',
    ],
    [
      'leaves the property',
      {
        footprint: [
          [14, 0],
          [19.5, 0],
          [19.5, 6],
          [14, 6],
        ],
        scope: 'lot',
        wallM: 1,
        exactWall: true,
      },
      'outside_property',
    ],
  ])('%s', (_name, input, code) => {
    expect(
      refusalCode(() =>
        gradeAroundHouse(
          lot(risingBehind(1)),
          { footprint: HOUSE, padHeightM: 0, scope: 'context', ...input } as never,
          context,
        ),
      ),
    ).toBe(code)
  })

  test('refuses where it would meet another break', () => {
    const across = AGENT_OPERATIONS.add_terrain_break!(
      lot(risingBehind(1)),
      {
        line: [
          [-20, 3],
          [20, 3],
        ],
        kind: 'retaining',
        left: 'ground',
        right: 2,
      },
      context,
    )
    expect(
      refusalCode(() =>
        gradeAroundHouse(
          applied(lot(risingBehind(1)), across),
          { footprint: HOUSE, padHeightM: 0, scope: 'context', wallM: 1, exactWall: true },
          context,
        ),
      ),
    ).toBe('crossing_breaks')
  })
})

describe('grade_around_house: one pad per level', () => {
  const street: Point[] = [
    [-5, 0],
    [5, 0],
    [5, 6],
    [-5, 6],
  ]
  const lower: Point[] = [
    [-5, -6],
    [5, -6],
    [5, 0],
    [-5, 0],
  ]
  const pads = [
    { footprint: street, padHeightM: 0 },
    { footprint: lower, padHeightM: -1.45, marginM: 2 },
  ]
  const twoFloors = () => lot(() => -1.45)

  test('each pad has its height and its margin, and abutting pads meet in a step along their shared edge', () => {
    const { after, outcome } = grade(twoFloors(), {
      pads,
      footprint: undefined,
      padHeightM: undefined,
      marginM: 1,
    })
    expect(groundAt(after, 0, 0.5)).toBeCloseTo(0, 2)
    expect(groundAt(after, 0, -0.5)).toBeCloseTo(-1.45, 2)
    // Beside the street pad (margin 1) the batter falls from 0 at x = 6; beside the lower pad (margin 2) it is level to x = 7.
    expect(groundAt(after, 6.5, 3)).toBeCloseTo(-0.25, 1)
    expect(groundAt(after, 6.5, -3)).toBeCloseTo(-1.45, 2)
    expect(outcome.result.pads).toMatchObject([
      { padHeightM: 0, marginM: 1 },
      { padHeightM: -1.45, marginM: 2 },
    ])
    expect(outcome.result.levelId).toBeUndefined()
  })

  test('each pad batters to the ground on its own', () => {
    const { after } = grade(
      lot(() => -3),
      { pads, footprint: undefined, padHeightM: undefined, run: 2 },
    )
    // 2 m past each pad's edge the fall is 1 m: from the street pad's 0 in front, from the lower pad's −1.45 behind it.
    expect(groundAt(after, 0, 9)).toBeCloseTo(-1, 1)
    expect(groundAt(after, 0, -10)).toBeCloseTo(-2.45, 1)
  })

  test.each([
    ['a top-level level with pads', { levelId: 'level_x' }],
    ['a pad with neither level nor footprint', { pads: [{ padHeightM: 0 }] }],
    ['the same level twice', { pads: [{ levelId: 'level_x' }, { levelId: 'level_x' }] }],
    ['an edge with several pads', { pads, edge: { facing: 'rear' } }],
  ])('%s is refused', (_name, input) => {
    expect(
      refusalCode(() =>
        gradeAroundHouse(twoFloors(), { pads, scope: 'context', ...input } as never, context),
      ),
    ).toBe('invalid_input')
  })
})

describe('grade_around_house: the section of a lot with a rear lawn, from one call', () => {
  // A 8 m deep house whose street is at +z. Behind it: 2.1 m of level yard, a 1.3 m retaining wall, a bank at 1:1.5 and a flat lawn 2.95 m up.
  const REAR_LAWN = {
    footprint: [
      [-5, 0],
      [5, 0],
      [5, 8],
      [-5, 8],
    ],
    padHeightM: 0,
    scope: 'lot',
    edge: { facing: 'rear' },
    marginM: 2.1,
    run: 1.5,
    wallM: 1.3,
    upperLevelM: 2.95,
    exactWall: true,
  }

  test.each([
    ['a hillside', risingBehind(0.25)],
    ['level ground', () => 0],
  ])('on %s it makes the wall, the 33.7 degree bank and the lawn', (_name, natural) => {
    const { after, outcome } = grade(lot(natural, [], STREET_AT_PLUS_Z), REAR_LAWN)
    const behind = (z: number) => groundAt(after, 0, z)
    expect(behind(0.5)).toBeCloseTo(0, 2)
    expect(behind(-2.0)).toBeCloseTo(0, 2)
    // The wall stands at z = −2.1 (2.1 m behind the rear wall) and is 1.3 m high; the bank then climbs 1.65 m over 2.475 m.
    expect(behind(-2.2)).toBeCloseTo(1.3 + 0.1 / 1.5, 1)
    expect(behind(-4)).toBeCloseTo(1.3 + 1.9 / 1.5, 1)
    expect(behind(-4.7)).toBeCloseTo(2.95, 1)
    expect(behind(-18)).toBeCloseTo(2.95, 2)
    for (const x of [-15, 15]) expect(groundAt(after, x, -3)).toBeCloseTo(behind(-3), 2)
    expect(outcome.result.batterSlopeDeg as number).toBeCloseTo(33.69, 1)
    expect(outcome.result.steepestSampledSlopeDeg as number).toBeLessThan(35)
    expect(outcome.result.lawn).toMatchObject({ levelM: 2.95 })
    expect(breaksOf(after)).toHaveLength(1)
  })
})
