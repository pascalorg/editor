import { describe, expect, test } from 'bun:test'
import { AGENT_TOOL_CONTRACTS } from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { closedHollows } from '../lib/terrain-hollows'
import { type AnyNode, type BuildingNode, LevelNode, SlabNode } from '../schema'
import { MIN_SLAB_THICKNESS } from '../schema/nodes/slab'
import {
  agentHouse,
  GROUNDS,
  type Ground,
  groundAt,
  runInStore,
  runSettled,
  runTool,
  slopedLot,
} from './__fixtures__/sloped-lots'
import { AGENT_OPERATIONS } from './index'
import { type TerrainFacts, terrainFacts } from './terrain-facts'

/*
 * The shared terraforming set: seat_house, set_terrain_plane, grade_along_line, add_steps_to_ground.
 * Lots and house are those of sloped-lots (floor +0.15 over the building's origin, front door to
 * the street on +z, rear door); the house stands as an agent leaves it, at y = 0, unless seated.
 */

type Nodes = Record<string, AnyNode>
type Result = Record<string, unknown>
const facts = (nodes: Nodes) => terrainFacts(nodes) as TerrainFacts
const refusal = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return undefined
}
const moved = (result: Result) => (result.cutVolumeM3 as number) + (result.fillVolumeM3 as number)
const NAMES = [
  'read_terrain_facts',
  'seat_house',
  'set_terrain_plane',
  'grade_along_line',
  'add_steps_to_ground',
]

test('each tool is one contract and one operation, by name', () => {
  for (const name of NAMES) {
    expect(AGENT_TOOL_CONTRACTS.filter((contract) => contract.name === name)).toHaveLength(1)
    expect((AGENT_OPERATIONS as Record<string, unknown>)[name]).toBeFunction()
  }
})

describe('seat_house: a drawn floor (a slab at its own height) on each lot', () => {
  const lots: [string, Ground | null][] = [
    ['flat', GROUNDS.flat],
    ['falling to the rear', GROUNDS.fallToRear],
    ['rising to the rear', GROUNDS.riseToRear],
    ['cross slope', GROUNDS.cross],
    ['hillside', GROUNDS.steep],
  ]
  for (const [name, ground] of lots)
    for (const strategy of ['balance', 'fill', 'cut', 'keep'] as const)
      test(`${name}, ${strategy}: the ground at every wall is the base of the level, each door a step off it, nothing open`, () => {
        const { nodes, result } = runTool(slopedLot({ ground }), 'seat_house', { strategy })
        const after = result.after as {
          floorOverGroundM: unknown
          doors: { stepM: number }[]
          open: unknown[]
        }
        expect(after.open).toEqual([])
        expect(after.floorOverGroundM).toEqual({ min: 0.15, max: 0.15 })
        for (const door of after.doors) {
          expect(door.stepM).toBeGreaterThan(0)
          expect(door.stepM).toBeLessThanOrEqual(0.2)
        }
        const [house] = facts(nodes).houses
        expect(house?.levelBaseM).toBeCloseTo(result.groundAtWallsM as number, 2)
        expect(facts(nodes).open).toEqual([])
      })

  const sloped = lots.filter(([, ground]) => ground !== null)
  for (const [name, ground] of sloped) {
    test(`${name}: fill cuts nothing to speak of and stands the pad's edge on the highest ground; cut is its mirror`, () => {
      const fill = runTool(slopedLot({ ground }), 'seat_house', { strategy: 'fill' }).result
      const cut = runTool(slopedLot({ ground }), 'seat_house', { strategy: 'cut' }).result
      const under = fill.groundUnderHouseM as { lowest: number; highest: number }
      // Fill cuts its low line round the high side and nothing else.
      expect(fill.cutVolumeM3 as number).toBeLessThan(20)
      expect(cut.fillVolumeM3 as number).toBeLessThan(3)
      expect(fill.padEdgeM).toBeCloseTo(under.highest, 2)
      expect(cut.padEdgeM).toBeCloseTo(under.lowest, 2)
      expect(fill.groundAtWallsM).toBeCloseTo(under.highest + 0.05, 2)
    })

    test(`${name}: balance moves the least earth of the four, its cut and its fill alike`, () => {
      const by = (strategy: string) =>
        runTool(slopedLot({ ground }), 'seat_house', { strategy }).result
      const balance = by('balance')
      const cut = balance.cutVolumeM3 as number
      const fill = balance.fillVolumeM3 as number
      expect(Math.abs(cut - fill)).toBeLessThanOrEqual(Math.max(3, 0.15 * (cut + fill)))
      for (const other of ['fill', 'cut', 'keep'])
        expect(moved(balance)).toBeLessThanOrEqual(moved(by(other)) + 1)
    })
  }

  test('on a flat lot balance stands the pad on the ground: a rise to the walls, no hollow round the house', () => {
    const { nodes, result } = runTool(slopedLot({ ground: GROUNDS.flat }), 'seat_house', {})
    expect(result).toMatchObject({
      strategy: 'balance',
      padEdgeM: 0,
      groundAtWallsM: 0.05,
      cutVolumeM3: 0,
    })
    expect(groundAt(nodes, 0, 5)).toBeCloseTo(0, 2)
    expect(groundAt(nodes, 0, 4)).toBeCloseTo(0.05, 2)
    expect(groundAt(nodes, 0, 8)).toBe(0)
  })

  test('a house built 1 m over a falling lot: keeping it there fills 188 m3, balancing moves 20', () => {
    const lot = () => slopedLot({ ground: GROUNDS.fallToRear })
    const keep = runTool(lot(), 'seat_house', { strategy: 'keep' }).result
    const balance = runTool(lot(), 'seat_house', {}).result
    expect(keep.movedBuildingByM).toBe(0)
    expect(moved(keep)).toBeGreaterThan(150)
    expect(balance.strategy).toBe('balance')
    expect(Math.abs((balance.movedBuildingByM as number) + 1)).toBeLessThan(0.12)
    expect(moved(balance)).toBeLessThan(40)
  })

  test('the building moves in height only, is named as standing on its ground level, in one change set with the ground', () => {
    const before = slopedLot({ ground: GROUNDS.riseToRear, at: [3, 0, -2], turn: Math.PI / 6 })
    const { nodes, result } = runTool(before, 'seat_house', { strategy: 'fill' })
    const building = nodes.building_house as BuildingNode
    expect(building.position[0]).toBe(3)
    expect(building.position[2]).toBe(-2)
    expect(building.position[1]).toBeCloseTo(result.movedBuildingByM as number, 4)
    expect(building.rotation[1]).toBeCloseTo(Math.PI / 6, 9)
    expect(building.groundLevelId).toBe('level_ground')
    expect(Object.values(nodes).some((node) => node.type === 'terrain-tile')).toBe(true)
    expect(facts(nodes).open).toEqual([])
  })

  test('the pad falls away from every wall by the fall asked; 0 is a level pad', () => {
    const falls = (padFallPercent?: number) =>
      facts(
        runTool(slopedLot({ ground: GROUNDS.steep }), 'seat_house', {
          ...(padFallPercent === undefined ? {} : { padFallPercent }),
        }).nodes,
      ).houses[0]?.walls.map((wall) => wall.fallAtWallPercent.min)
    for (const fall of falls() ?? []) expect(fall).toBeCloseTo(5, 0)
    for (const fall of falls(0) ?? []) expect(fall).toBeCloseTo(0, 0)
  })

  test('a stated ground height is the base of the level', () => {
    const { nodes, result } = runTool(slopedLot({ ground: GROUNDS.fallToRear }), 'seat_house', {
      groundM: -0.65,
    })
    expect(result).toMatchObject({ strategy: 'ground', groundAtWallsM: -0.65, floorM: -0.5 })
    expect(facts(nodes).houses[0]).toMatchObject({
      levelBaseM: -0.65,
      floorM: { min: -0.5, max: -0.5 },
    })
  })

  test('an exact wall is a retaining face in the facts', () => {
    const { nodes, result } = runTool(slopedLot({ ground: GROUNDS.steep }), 'seat_house', {
      strategy: 'cut',
      wallM: 1,
      exactWall: true,
    })
    expect(result.wall).toMatchObject({ exact: true, heightM: 1 })
    expect(result.padEdgeM).toBe(result.groundAtWallsM)
    expect(facts(nodes).retaining).toHaveLength(1)
    // Inside an exact wall the pad is level (a break holds one height): on the cut sides the
    // tool's own answer says the water of the bank runs to the wall.
    const open = (result.after as { open: { code: string; id: string }[] }).open
    expect(open.map((finding) => finding.code)).toEqual([
      'ground_falls_to_wall',
      'ground_falls_to_wall',
      'ground_falls_to_wall',
    ])
    expect(open.map((finding) => finding.id).sort()).toEqual([
      'wall_left',
      'wall_rear',
      'wall_right',
    ])
  })

  test('a batter the property line stops is said, with the step it leaves', () => {
    // A house 2 m from the rear property line, the ground 1.7 m over it there: the cut cannot run out.
    const { result } = runTool(
      slopedLot({ ground: GROUNDS.steep, at: [0, 0, -14] }),
      'seat_house',
      {
        strategy: 'cut',
      },
    )
    const unmet = result.unmet as string[]
    expect(unmet).toHaveLength(1)
    expect(unmet[0]).toContain('beyond the property')
    expect((result.daylight as { outsideLotM2: number }).outsideLotM2).toBeGreaterThan(0)
  })

  const upper: AnyNode[] = [
    LevelNode.parse({ id: 'level_upper', parentId: 'building_house', level: 1, height: 2.7 }),
    SlabNode.parse({
      id: 'slab_upper',
      parentId: 'level_upper',
      polygon: [
        [-6, -4],
        [6, -4],
        [6, 4],
        [-6, 4],
      ],
      elevation: 0.05,
    }),
  ]
  const refusals: [string, () => unknown, string][] = [
    [
      'a strategy and a ground height together',
      () =>
        runTool(slopedLot({ ground: GROUNDS.steep }), 'seat_house', {
          strategy: 'cut',
          groundM: 1,
        }),
      'invalid_input',
    ],
    [
      'an upper storey',
      () =>
        runTool(slopedLot({ ground: GROUNDS.steep, extra: upper }), 'seat_house', {
          levelId: 'level_upper',
        }),
      'invalid_input',
    ],
    [
      'a walk-out with no level under the ground level',
      () => runTool(slopedLot({ ground: GROUNDS.steep }), 'seat_house', { strategy: 'walk_out' }),
      'invalid_input',
    ],
    [
      'a house already seated so',
      () => {
        const seated = runTool(slopedLot({ ground: GROUNDS.steep }), 'seat_house', {}).nodes
        return runTool(seated, 'seat_house', { strategy: 'keep' })
      },
      'no_change',
    ],
    ['a scene with no site', () => runTool({}, 'seat_house', {}), 'no_site'],
  ]
  for (const [name, run, code] of refusals)
    test(`refused: ${name} (${code})`, () => {
      expect(refusal(run)).toBe(code)
    })
})

describe('seat_house: a house an agent made (a floor that rests on the ground and follows it)', () => {
  /*
   * create_room's floor is an automatic plate: it stands 0.05 m over the highest ground at its
   * walls. The storey's top stays on the level's base, so ground over the base takes the storey:
   * on a lot rising 2 m the house is left with 1.45 m of its 2.7 m.
   */
  const lifted: [string, Ground, number][] = [
    ['rising to the rear', GROUNDS.riseToRear, 1.45],
    ['cross slope', GROUNDS.cross, 2.25],
    ['hillside', GROUNDS.steep, 1.85],
  ]
  for (const [name, ground, clear] of lifted) {
    test(`${name}: as built the ground lifts the floor and the storey keeps ${clear} m of 2.7; the facts say so`, () => {
      const read = facts(agentHouse({ ground }))
      expect(read.houses[0]).toMatchObject({
        floorFollowsGround: true,
        clearHeightM: clear,
        storeyHeightM: 2.7,
      })
      expect(read.open.map((finding) => finding.code)).toContain('floor_lifted_by_ground')
    })

    for (const strategy of ['balance', 'fill', 'cut', 'keep'] as const)
      test(`${name}, ${strategy}: seated, the floor is 0.05 m over the base and the ground, the storey whole, nothing open`, () => {
        const { nodes, result } = runSettled(agentHouse({ ground }), 'seat_house', { strategy })
        const [house] = facts(nodes).houses
        expect(house?.clearHeightM).toBe(2.65)
        expect(house?.floorOverGroundM).toEqual({ min: 0.05, max: 0.05 })
        expect(house?.levelBaseM).toBeCloseTo(result.groundAtWallsM as number, 2)
        expect(result.floorM).toBeCloseTo((result.groundAtWallsM as number) + 0.05, 2)
        expect(facts(nodes).open).toEqual([])
        expect((result.after as { open: unknown[]; clearHeightM: number }).open).toEqual([])
        expect((result.after as { clearHeightM: number }).clearHeightM).toBe(2.65)
      })
  }

  test('a pad at the mean ground alone does not give the storey back; seating does', () => {
    // The ground under the house runs 0.8 to 1.2 m over the level's base (mean 1.0).
    const house = agentHouse({ ground: GROUNDS.riseToRear })
    const padded = runSettled(house, 'grade_around_house', { padHeightM: 1 }).nodes
    expect(facts(padded).houses[0]?.clearHeightM).toBeCloseTo(1.65, 2)
    const seated = runSettled(house, 'seat_house', {}).nodes
    expect(facts(seated).houses[0]?.clearHeightM).toBe(2.65)
  })
})

/*
 * The high side of a seated house. A pad that falls 5 cm to its edge and then meets a bank is a
 * crease one lattice cell cannot hold: read half a metre on, the ground rises to the wall. Seated,
 * the house has a low line between its walls and the ground that rises beyond them: a level
 * bottom, wide enough to survive the lattice, that falls along its length and comes out on lower
 * ground. Stated in ground numbers, read every 0.1 m on transects out of every wall.
 */
describe('seat_house: the high side is drained by a low line', () => {
  type Transect = { foot: number; low: number; wide: number; rises: boolean }
  /** Transects out of the four walls of the fixture house, every half metre, in order round it. */
  function transects(nodes: Nodes): Transect[] {
    const building = nodes.building_house as BuildingNode
    const cos = Math.cos(building.rotation[1])
    const sin = Math.sin(building.rotation[1])
    const at = (x: number, z: number) =>
      groundAt(
        nodes,
        cos * x + sin * z + building.position[0],
        -sin * x + cos * z + building.position[2],
      )
    const read: Transect[] = []
    // The slab reaches 0.05 m past the room's outline: the foot of the wall is 0.1 m past that.
    for (const [x0, z0, dx, dz, length] of [
      [-6.05, -4.05, 1, 0, 12.1],
      [6.05, -4.05, 0, 1, 8.1],
      [6.05, 4.05, -1, 0, 12.1],
      [-6.05, 4.05, 0, -1, 8.1],
    ] as const)
      for (let s = 0.3; s < length; s += 0.5) {
        const heights = Array.from({ length: 35 }, (_, i) =>
          at(x0 + dx * s + dz * (0.1 + 0.1 * i), z0 + dz * s - dx * (0.1 + 0.1 * i)),
        )
        const foot = heights[0] as number
        const near = heights.slice(0, 25)
        read.push({
          foot,
          low: Math.min(...near),
          wide: near.filter((height) => height <= foot - 0.04).length * 0.1,
          rises: Math.max(...heights) > foot + 0.05,
        })
      }
    return read
  }
  /** Each stretch of transects where the ground rises beyond the wall, as its low line's heights. */
  function stretches(read: Transect[]): number[][] {
    const first = read.findIndex((each, i) => each.rises && !read.at(i - 1)?.rises)
    if (first < 0) return read.every((each) => each.rises) ? [read.map((each) => each.low)] : []
    const turned = [...read.slice(first), ...read.slice(0, first)]
    const found: number[][] = []
    let open: number[] | undefined
    for (const each of turned) {
      if (!each.rises) {
        open = undefined
        continue
      }
      if (!open) {
        open = []
        found.push(open)
      }
      open.push(each.low)
    }
    return found
  }
  const lots = [
    ['a 20 % hillside', { ground: GROUNDS.steep }],
    ['a lot rising 2 m to the rear', { ground: GROUNDS.riseToRear }],
    ['a cross slope', { ground: GROUNDS.cross }],
    ['a 20 % hillside, the house off the lattice', { ground: GROUNDS.steep, at: [0.13, 0, 0.21] }],
    [
      'a 12 % hillside with a cross fall, the house turned 20 degrees',
      { ground: ((x, z) => -z * 0.12 + x * 0.03) as Ground, at: [0.4, 0, -0.3], turn: 0.35 },
    ],
  ] as const
  for (const [name, lot] of lots)
    for (const strategy of ['balance', 'fill', 'cut', 'keep'] as const) {
      // Kept where it was drawn on a lot that rises 2 m, the house stands in a pit: next table.
      if (strategy === 'keep' && lot.ground === GROUNDS.riseToRear) continue
      test(`${name}, ${strategy}: under every wall the ground rises beyond, a low line 0.5 m wide stands 4 cm under its foot, falls to its ends and comes out`, () => {
        const built = agentHouse(lot as never)
        const { nodes, result } = runSettled(built, 'seat_house', { strategy })
        const read = transects(nodes)
        const high = read.filter((each) => each.rises)
        expect(high.length).toBeGreaterThan(8)
        for (const each of high) {
          expect(each.foot - each.low).toBeGreaterThanOrEqual(0.04)
          expect(each.wide).toBeGreaterThanOrEqual(0.5)
        }
        // Along each stretch the line falls from one summit to both ends, 1 cm a metre.
        for (const line of stretches(read)) {
          const summit = line.indexOf(Math.max(...line))
          for (let i = 1; i < line.length; i++) {
            const [nearer, farther] =
              i <= summit ? [line[i] as number, line[i - 1] as number] : [line[i - 1], line[i]]
            expect(farther as number).toBeLessThanOrEqual((nearer as number) + 0.011)
          }
          const span = Math.max(summit, line.length - 1 - summit) * 0.5
          expect(Math.max(...line) - Math.min(...line)).toBeGreaterThanOrEqual(0.008 * (span - 1))
        }
        expect((result.lowLine as { outlets: number }).outlets).toBeGreaterThanOrEqual(1)
        expect(result.unmet).toEqual([])
        // Nowhere within 4 m of the house does water stand: no closed hollow 3 cm deep.
        const building = nodes.building_house as BuildingNode
        const [cx, , cz] = building.position
        const hollows = closedHollows((x, z) => groundAt(nodes, x, z), {
          bounds: { minX: -15, minZ: -20, maxX: 15, maxZ: 20 },
          blocked: (x, z) => {
            const dx = x - cx
            const dz = z - cz
            const lx = Math.cos(building.rotation[1]) * dx - Math.sin(building.rotation[1]) * dz
            const lz = Math.sin(building.rotation[1]) * dx + Math.cos(building.rotation[1]) * dz
            return Math.abs(lx) <= 6.05 && Math.abs(lz) <= 4.05
          },
          within: (x, z) => Math.hypot(x - cx, z - cz) < 11,
        })
        expect(hollows).toEqual([])
      })
    }

  for (const [name, lot, strategy] of [
    [
      'a bowl, the house at its bottom',
      { ground: ((x, z) => 0.004 * (x * x + z * z)) as Ground },
      'cut',
    ],
    [
      'a lot rising 2 m, the house kept at the street height',
      { ground: GROUNDS.riseToRear },
      'keep',
    ],
  ] as const)
    test(`${name}: the ground stands over the base on every side, the line has nowhere to run to, and the answer says so`, () => {
      const { result } = runSettled(agentHouse(lot as never), 'seat_house', { strategy })
      expect((result.unmet as string[]).join(' ')).toContain('nowhere to run to')
    })
})

/*
 * A house backed into a slope. Cut back at a batter, a 35 % hill behind a 12 m house costs 970 m3
 * and does not meet the ground within 15 m; held against the house it costs the excavation.
 */
describe('seat_house hillside: the ground over the base is held against the house', () => {
  const hill =
    (slope: number): Ground =>
    (_x, z) =>
      -z * slope
  const breaks = (nodes: Nodes) =>
    Object.values(nodes).filter((node) => node.type === 'terrain-break') as (AnyNode & {
      left: number | 'ground'
      kind: string
    })[]
  const cases = [
    { name: 'a 20 % hill', slope: 0.2, input: {}, held: 1.4 },
    { name: 'a 35 % hill', slope: 0.35, input: {}, held: 2.4 },
    { name: 'a 50 % hill, batter 1:1 over the face', slope: 0.5, input: { run: 1 }, held: 2.4 },
    {
      name: 'a 35 % hill, holding 1.5 m, batter 1:1.5 over the face',
      slope: 0.35,
      input: { retainM: 1.5, run: 1.5 },
      held: 1.2,
    },
  ] as const
  for (const { name, slope, input, held } of cases)
    test(`${name}: the base on the low ground, a retaining face on the outline at the base, ${held} m and more of ground against the rear wall, the storey whole, the front door a step off the ground`, () => {
      const built = agentHouse({ ground: hill(slope) })
      const { nodes, result } = runSettled(built, 'seat_house', { strategy: 'hillside', ...input })
      const base = result.groundAtWallsM as number
      expect(base).toBeCloseTo(-4.05 * slope + 0.05, 1)
      const [face] = breaks(nodes)
      expect(breaks(nodes).length).toBe(1)
      expect(face).toMatchObject({ kind: 'retaining', left: base, right: 'ground' })
      expect((result.hillside as { faceBreakId: string }).faceBreakId).toBe(face?.id as string)
      // Just inside the rear wall the ground is the base; just outside it the hill stands held.
      expect(groundAt(nodes, 0, -3.9)).toBeCloseTo(base, 2)
      expect(groundAt(nodes, 0, -4.3) - base).toBeGreaterThanOrEqual(held)
      const retainM = (input as { retainM?: number }).retainM ?? 2.7
      expect(groundAt(nodes, 0, -4.3) - base).toBeLessThanOrEqual(retainM + 0.02)
      const read = facts(nodes)
      expect(read.houses[0]).toMatchObject({ clearHeightM: 2.65, standing: 'at-grade' })
      expect(read.houses[0]?.doors[0]?.stepM).toBeLessThanOrEqual(0.2)
      expect(read.retaining[0]?.heightM.max).toBeGreaterThanOrEqual(held)
      expect(result.unmet).toEqual([])
      // Held, the hill costs a fraction of what cutting it back does.
      const cut = runSettled(built, 'seat_house', {
        strategy: 'cut',
        run: (input as { run?: number }).run,
      }).result
      expect(moved(result)).toBeLessThan(0.6 * moved(cut))
    })

  test('areawayM: a level areaway at the base between the walls and the face', () => {
    const built = agentHouse({ ground: hill(0.35) })
    const { nodes, result } = runSettled(built, 'seat_house', {
      strategy: 'hillside',
      areawayM: 1.2,
    })
    const base = result.groundAtWallsM as number
    for (const z of [-4.3, -4.8, -5.2]) expect(groundAt(nodes, 0, z)).toBeCloseTo(base, 2)
    expect(groundAt(nodes, 0, -5.4) - base).toBeGreaterThan(2.3)
  })

  test('groundM states the base: a house half in the hill, its low side on fill', () => {
    const built = agentHouse({ ground: hill(0.35) })
    const { nodes, result } = runSettled(built, 'seat_house', { strategy: 'hillside', groundM: 0 })
    expect(result.groundAtWallsM).toBe(0)
    expect(groundAt(nodes, 0, -4.3)).toBeGreaterThan(1)
    expect(groundAt(nodes, 0, 4.5)).toBeCloseTo(-0.02, 1)
    expect(result.fillVolumeM3 as number).toBeGreaterThan(40)
  })

  test('seated so again: nothing is written; seated another way: the face is taken away', () => {
    const built = agentHouse({ ground: hill(0.35) })
    const seated = runSettled(built, 'seat_house', { strategy: 'hillside' }).nodes
    expect(refusal(() => runSettled(seated, 'seat_house', { strategy: 'hillside' }))).toBe(
      'no_change',
    )
    const again = runSettled(seated, 'seat_house', { strategy: 'cut', run: 1 }).nodes
    expect(breaks(again)).toEqual([])
    expect(facts(again).retaining).toEqual([])
  })

  test('seated another way first: the base is kept, and the answer says the slope of before is not known', () => {
    const built = agentHouse({ ground: hill(0.35) })
    const balanced = runSettled(built, 'seat_house', {})
    const { result } = runSettled(balanced.nodes, 'seat_house', { strategy: 'hillside' })
    expect(result.groundAtWallsM).toBe(balanced.result.groundAtWallsM)
    expect(result.movedBuildingByM).toBe(0)
    expect((result.unmet as string[]).join(' ')).toContain('an earlier seating')
  })

  for (const [name, input] of [
    ['hillside with a declared wall', { strategy: 'hillside', wallM: 2 }],
    ['retainM without hillside', { strategy: 'cut', retainM: 2 }],
    ['areawayM without hillside', { areawayM: 1 }],
    ['groundM with another strategy', { strategy: 'cut', groundM: 0 }],
  ] as const)
    test(`refused: ${name} (invalid_input)`, () => {
      expect(
        refusal(() => runTool(slopedLot({ ground: GROUNDS.steep }), 'seat_house', input)),
      ).toBe('invalid_input')
    })
})

describe('seat_house: a house with a level under its ground level', () => {
  /** A hillside rising to the rear at 16 %: 1.3 m of fall across the house, a 2.7 m level under it. */
  const hill: Ground = (_x, z) => -0.16 * z
  function withLower(ground: Ground = hill) {
    let house = agentHouse({ ground })
    house = runSettled(house, 'add_level', { position: 'below', name: 'Lower', height: 2.7 }).nodes
    const lower = Object.values(house).find(
      (node): node is LevelNode => node.type === 'level' && node.name === 'Lower',
    ) as LevelNode
    house = runSettled(house, 'create_room', {
      levelId: lower.id,
      name: 'Rumpus',
      polygon: [
        [-6, -4],
        [6, -4],
        [6, 4],
        [-6, 4],
      ],
      doors: [{ wallIndex: 2, t: 0.5 }],
    }).nodes
    return { house, lower }
  }

  test('walk_out on a fall of more than a storey: the high side is cut back to the base, nothing is unmet', () => {
    // 40 %: 3.2 m of fall across the house, over the 2.7 m between the two levels.
    const { house, lower } = withLower((_x, z) => -0.4 * z)
    // A hill of 40 % is held by a batter steeper than itself: 1 to 1.5.
    const { nodes, result } = runSettled(house, 'seat_house', { strategy: 'walk_out', run: 1.5 })
    const walkOut = result.walkOut as { lowerBaseM: number; fallAcrossHouseM: number }
    const base = result.groundAtWallsM as number
    expect(walkOut.fallAcrossHouseM).toBeGreaterThan(2.7)
    expect(base).toBeCloseTo(walkOut.lowerBaseM + 2.7, 2)
    expect(result.unmet).toEqual([])
    // Behind the house the hill stood 0.7 m over the base: cut back to it, then a batter up the hill.
    expect(groundAt(house, 0, -4.5)).toBeGreaterThan(base + 0.6)
    expect(groundAt(nodes, 0, -4.5)).toBeCloseTo(base, 1)
    expect(result.cutVolumeM3 as number).toBeGreaterThan(20)
    // Beside the low half of the house, and up the hill past the batter's daylight, the ground is its own.
    for (const [x, z] of [
      [9.5, 2],
      [-9.5, 3],
      [0, -18.5],
    ] as const)
      expect(groundAt(nodes, x, z)).toBeCloseTo(groundAt(house, x, z), 2)
    const read = facts(nodes)
    const lowerDoor = read.houses[0]?.doors.find((door) => door.levelId === lower.id)
    expect(lowerDoor?.stepM).toBeGreaterThanOrEqual(0)
    expect(lowerDoor?.stepM).toBeLessThanOrEqual(0.2)
    expect(read.houses[0]?.clearHeightM).toBe(2.65)
    expect(read.open.map((finding) => finding.code)).not.toContain('ground_over_floor')
  })

  /*
   * The trial team's stored scene (13 Nov): the main floor plate over a basement, thickness
   * -1.419 m. The store reads a new top on a plate that stands over a level as a thicker or a
   * thinner floor, its underside held: put back 1.47 m lower, the plate came out 1.42 m thinner
   * than nothing.
   */
  for (const [name, slope, input] of [
    ['the default, 16 %', 0.16, {}],
    ['walk_out, 16 %', 0.16, { strategy: 'walk_out' }],
    ['walk_out, 40 %', 0.4, { strategy: 'walk_out' }],
  ] as const)
    test(`${name}, through the store's rules: no floor is stored thinner than a slab can be`, () => {
      const { house } = withLower((_x, z) => -slope * z)
      const { nodes, result } = runInStore(house, 'seat_house', input)
      expect((result.floorsPutBack as string[]).length).toBe(1)
      for (const slab of Object.values(nodes).filter(
        (node): node is SlabNode => node.type === 'slab',
      ))
        expect(slab.thickness).toBeGreaterThanOrEqual(MIN_SLAB_THICKNESS)
      expect(facts(nodes).houses[0]?.clearHeightM).toBe(2.65)
    })

  test('a scene stored with such a floor: the facts say so, and seating the house gives the floor a slab thickness', () => {
    const { house } = withLower()
    const seated = runInStore(house, 'seat_house', { strategy: 'walk_out' }).nodes
    const main = Object.values(seated).find(
      (node): node is SlabNode => node.type === 'slab' && node.parentId === 'level_ground',
    ) as SlabNode
    const stored = { ...seated, [main.id]: { ...main, thickness: -1.4188 } as AnyNode }
    expect(facts(stored).open).toContainEqual(
      expect.objectContaining({ code: 'floor_without_thickness', id: main.id, value: -1.42 }),
    )
    const { nodes, result } = runInStore(stored, 'seat_house', { strategy: 'keep' })
    expect(result.floorsPutBack).toEqual([main.id])
    expect((nodes[main.id] as SlabNode).thickness).toBe(0.05)
    expect(facts(nodes).open.map((finding) => finding.code)).not.toContain(
      'floor_without_thickness',
    )
  })

  test('grade_around_house with no level named takes the lowest and digs the house a pit', () => {
    const { house, lower } = withLower()
    const { result } = runSettled(house, 'grade_around_house', {})
    expect(result.levelId).toBe(lower.id)
    expect(result.padHeightM as number).toBeCloseTo(-2.8, 2)
    expect(result.cutVolumeM3 as number).toBeGreaterThan(1000)
  })

  test('seat_house with no level named seats the ground level, and puts back the floor the ground had lifted', () => {
    const { house } = withLower()
    expect(facts(house).houses[0]?.clearHeightM).toBeCloseTo(2.01, 2)
    const { nodes, result } = runSettled(house, 'seat_house', {})
    expect(result.levelId).toBe('level_ground')
    expect(moved(result)).toBeLessThan(130)
    expect((result.floorsPutBack as string[]).length).toBe(1)
    expect(facts(nodes).houses[0]).toMatchObject({
      clearHeightM: 2.65,
      floorOverGroundM: { min: 0.05, max: 0.05 },
    })
  })

  test('walk_out: the lower level opens on the ground at the low side, the slope beside the house is its own', () => {
    const { house, lower } = withLower()
    const { nodes, result } = runSettled(house, 'seat_house', { strategy: 'walk_out' })
    const walkOut = result.walkOut as {
      lowerLevelId: string
      lowerBaseM: number
      openSide: number[]
      fallAcrossHouseM: number
      storeyBelowM: number
    }
    // Downhill is +z (the street side); the lowest ground along that wall is about -0.7 m.
    expect(walkOut).toMatchObject({ lowerLevelId: lower.id, openSide: [0, 1], storeyBelowM: 2.7 })
    expect(walkOut.lowerBaseM).toBeCloseTo(-0.73, 1)
    expect(result.groundAtWallsM as number).toBeCloseTo(walkOut.lowerBaseM + 2.7, 2)
    // The lower level's door opens a step over the apron; the apron is level at the lower base.
    const read = facts(nodes)
    const lowerDoor = read.houses[0]?.doors.find((door) => door.levelId === lower.id)
    expect(lowerDoor?.stepM).toBeGreaterThanOrEqual(0)
    expect(lowerDoor?.stepM).toBeLessThanOrEqual(0.2)
    expect(groundAt(nodes, 0, 5.5)).toBeCloseTo(walkOut.lowerBaseM, 1)
    // Beside and behind the house the hill keeps its slope: nothing moved 3 m off the side wall or behind.
    for (const [x, z] of [
      [9.5, 0],
      [-9.5, -2],
      [0, -6],
    ] as const)
      expect(groundAt(nodes, x, z)).toBeCloseTo(groundAt(house, x, z), 2)
    expect(moved(result)).toBeLessThan(40)
    // The fall across the house is less than a storey: said, with the height left on the high side.
    expect((result.unmet as string[])[0]).toContain('less than the 2.70 m between the two levels')
    expect(read.houses[0]?.clearHeightM).toBe(2.65)
  })
})

describe('set_terrain_plane', () => {
  const LOT_AREA = [
    [-15, -20],
    [15, -20],
    [15, 20],
    [-15, 20],
  ]
  test('two points make a lot that falls from one to the other, level across', () => {
    const { nodes, result } = runTool(slopedLot({ house: false }), 'set_terrain_plane', {
      area: LOT_AREA,
      through: [
        { at: [0, 20], heightM: 0 },
        { at: [0, -20], heightM: -2 },
      ],
    })
    expect(result).toMatchObject({ slopePercent: 5, fallDirection: [0, -1], minM: -2, maxM: 0 })
    for (const [x, z, height] of [
      [0, 0, -1],
      [-10, 0, -1],
      [10, 10, -0.5],
      [0, -19, -1.95],
    ] as const)
      expect(groundAt(nodes, x, z)).toBeCloseTo(height, 2)
  })

  test('three points fix a plane with a cross fall; one point is a level bench', () => {
    const tilted = runTool(slopedLot({ house: false }), 'set_terrain_plane', {
      area: LOT_AREA,
      through: [
        { at: [-15, -20], heightM: 0 },
        { at: [15, -20], heightM: 3 },
        { at: [-15, 20], heightM: 2 },
      ],
    })
    expect(groundAt(tilted.nodes, 0, 0)).toBeCloseTo(2.5, 2)
    expect(tilted.result.slopePercent as number).toBeCloseTo(Math.hypot(10, 5), 1)
    const bench = runTool(slopedLot({ ground: GROUNDS.steep, house: false }), 'set_terrain_plane', {
      area: { center: [0, 0], radiusM: 4 },
      through: [{ at: [0, 0], heightM: 0.5 }],
    })
    expect(bench.result).toMatchObject({
      slopePercent: 0,
      fallDirection: [0, 0],
      minM: 0.5,
      maxM: 0.5,
    })
    expect(groundAt(bench.nodes, 2, 2)).toBeCloseTo(0.5, 2)
    expect(groundAt(bench.nodes, 0, 8)).toBeCloseTo(-1.6, 2)
  })

  test('outside the area the ground blends back over blendM', () => {
    const { nodes } = runTool(slopedLot({ house: false }), 'set_terrain_plane', {
      area: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
      through: [{ at: [0, 0], heightM: 1 }],
      blendM: 4,
    })
    expect(groundAt(nodes, 0, 0)).toBeCloseTo(1, 2)
    expect(groundAt(nodes, 7, 0)).toBeCloseTo(0.5, 2)
    expect(groundAt(nodes, 9, 0)).toBeCloseTo(0, 2)
  })

  const refusals: [string, Record<string, unknown>, string][] = [
    [
      'two points that coincide',
      {
        area: LOT_AREA,
        through: [
          { at: [0, 0], heightM: 0 },
          { at: [0, 0], heightM: 1 },
        ],
      },
      'invalid_input',
    ],
    [
      'three points in a line',
      {
        area: LOT_AREA,
        through: [
          { at: [0, 0], heightM: 0 },
          { at: [1, 1], heightM: 1 },
          { at: [2, 2], heightM: 3 },
        ],
      },
      'invalid_input',
    ],
    [
      'an area past the property',
      {
        area: [
          [-20, -20],
          [15, -20],
          [15, 20],
          [-20, 20],
        ],
        through: [{ at: [0, 0], heightM: 0 }],
      },
      'outside_property',
    ],
    [
      'a plane the ground already lies on',
      { area: LOT_AREA, through: [{ at: [0, 0], heightM: 0 }] },
      'no_change',
    ],
  ]
  for (const [name, input, code] of refusals)
    test(`refused: ${name} (${code})`, () => {
      expect(refusal(() => runTool(slopedLot({ house: false }), 'set_terrain_plane', input))).toBe(
        code,
      )
    })
})

describe('grade_along_line', () => {
  /** A lot that undulates along z: humps of 0.6 m every 19 m. */
  const humps: Ground = (_x, z) => 0.6 * Math.sin(z / 3)
  const lot = (ground: Ground | null) => slopedLot({ ground, house: false })

  test('with a slope limit the strip is no steeper, keeps the ground at both ends, cuts the humps and fills the dips', () => {
    const before = lot(humps)
    const { nodes, result } = runTool(before, 'grade_along_line', {
      line: [
        [0, -18],
        [0, 18],
      ],
      widthM: 3,
      maxSlopePercent: 8,
    })
    expect(result.groundSteepestPercent as number).toBeGreaterThan(18)
    expect(result.steepestPercent as number).toBeLessThanOrEqual(8)
    expect(result.startM).toBeCloseTo(groundAt(before, 0, -18), 2)
    expect(result.endM).toBeCloseTo(groundAt(before, 0, 18), 2)
    expect(result.deepestCutM as number).toBeGreaterThan(0.2)
    expect(result.highestFillM as number).toBeGreaterThan(0.2)
    // Level across the strip, and no steeper along it than the limit, as the ground now lies.
    for (const z of [-12, -6, 0, 6, 12]) {
      expect(groundAt(nodes, 1, z)).toBeCloseTo(groundAt(nodes, -1, z), 2)
      expect(Math.abs(groundAt(nodes, 0, z + 1) - groundAt(nodes, 0, z))).toBeLessThanOrEqual(
        0.08 + 0.011,
      )
    }
  })

  test('ends that the limit cannot join over the line are refused, with the length that would', () => {
    let message = ''
    try {
      runTool(lot(GROUNDS.steep), 'grade_along_line', {
        line: [
          [10, 20],
          [10, 5],
        ],
        maxSlopePercent: 12,
      })
    } catch (error) {
      if (!isAgentRefusal(error)) throw error
      expect(error.code).toBe('slope_limit_unreachable')
      message = error.message
    }
    // 3 m of rise over 15 m: 12 % needs 25 m.
    expect(message).toContain('25.0 m')
  })

  const strips: [string, number, (height: number) => void][] = [
    ['a swale', -0.3, (height) => expect(height).toBeCloseTo(-0.3, 2)],
    ['a berm', 0.5, (height) => expect(height).toBeCloseTo(0.5, 2)],
  ]
  for (const [name, offsetM, onStrip] of strips)
    test(`${name}: the strip stands ${offsetM} m off the ground, battered at 1:2 beside it, and stops at its ends`, () => {
      const { nodes, result } = runTool(lot(GROUNDS.flat), 'grade_along_line', {
        line: [
          [-10, 0],
          [10, 0],
        ],
        widthM: 1,
        offsetM,
      })
      onStrip(groundAt(nodes, 0, 0))
      onStrip(groundAt(nodes, 5, 0.5))
      // Half a metre beyond the strip's edge the batter has made up 0.25 m of the offset.
      expect(groundAt(nodes, 0, 1)).toBeCloseTo(offsetM - Math.sign(offsetM) * 0.25, 2)
      expect(groundAt(nodes, 0, 3)).toBe(0)
      expect(groundAt(nodes, 11, 0)).toBe(0)
      expect(result.outline).toEqual([
        [-10, 0.5],
        [10, 0.5],
        [10, -0.5],
        [-10, -0.5],
      ])
    })

  const refusals: [string, Record<string, unknown>, string][] = [
    [
      'a line past the property',
      {
        line: [
          [0, 0],
          [0, 30],
        ],
      },
      'outside_property',
    ],
    [
      'an end height with no slope limit',
      {
        line: [
          [0, 0],
          [0, 10],
        ],
        startHeightM: 1,
      },
      'invalid_input',
    ],
    [
      'a strip on the ground of a flat lot',
      {
        line: [
          [0, 0],
          [0, 10],
        ],
      },
      'no_change',
    ],
  ]
  for (const [name, input, code] of refusals)
    test(`refused: ${name} (${code})`, () => {
      expect(refusal(() => runTool(lot(GROUNDS.flat), 'grade_along_line', input))).toBe(code)
    })
})

describe('grade_along_line: a swale says where it leads', () => {
  const cases: [string, Ground | null, Record<string, unknown>, string, boolean][] = [
    [
      'down a slope, stopped 0.4 m under the ground at its lower end: water stands there',
      GROUNDS.steep,
      {
        line: [
          [10, -10],
          [10, 10],
        ],
      },
      'end',
      true,
    ],
    [
      'down a slope, falling a little less than the ground so that its lower end meets it: it comes out',
      GROUNDS.steep,
      {
        line: [
          [10, -10],
          [10, 10],
        ],
        maxSlopePercent: 18,
        startHeightM: 1.6,
        endHeightM: -2,
      },
      'end',
      false,
    ],
    [
      'along the contour of a slope: a trough that holds what runs into it',
      GROUNDS.steep,
      {
        line: [
          [-10, 0],
          [10, 0],
        ],
      },
      'start',
      true,
    ],
    [
      'on level ground: a trough with no way out',
      GROUNDS.flat,
      {
        line: [
          [-10, 0],
          [10, 0],
        ],
      },
      'start',
      true,
    ],
  ]
  for (const [name, ground, input, lowestAt, stands] of cases)
    test(name, () => {
      const lot = slopedLot({ ground: ground ?? (() => 0), house: false })
      const { result } = runTool(lot, 'grade_along_line', { widthM: 1, offsetM: -0.4, ...input })
      const drains = result.drains as { lowestAt: string; standingWaterM: number }
      expect(drains.lowestAt).toBe(lowestAt)
      expect(drains.standingWaterM > 0.1).toBe(stands)
    })

  test('a strip that is not lowered answers no drains', () => {
    const lot = slopedLot({ ground: GROUNDS.steep, house: false })
    const { result } = runTool(lot, 'grade_along_line', {
      line: [
        [10, -10],
        [10, 10],
      ],
      offsetM: 0.3,
    })
    expect(result.drains).toBeUndefined()
  })
})

describe('add_steps_to_ground', () => {
  const cases: { name: string; scene: () => Nodes; door: string; steps: number }[] = [
    {
      name: 'a floor 1 m over a falling lot, the front door',
      scene: () => slopedLot({ ground: GROUNDS.fallToRear }),
      door: 'door_front',
      steps: 5,
    },
    {
      name: 'the same house, its rear door over lower ground',
      scene: () => slopedLot({ ground: GROUNDS.fallToRear }),
      door: 'door_rear',
      steps: 8,
    },
    {
      name: 'a hillside, the front door',
      scene: () => slopedLot({ ground: GROUNDS.steep }),
      door: 'door_front',
      steps: 7,
    },
    {
      name: 'a turned, moved house on a falling lot',
      scene: () => slopedLot({ ground: GROUNDS.fallToRear, at: [2, 0, 1], turn: Math.PI / 3 }),
      door: 'door_front',
      steps: 6,
    },
    {
      name: 'a seated house: one step',
      scene: () => runTool(slopedLot({ ground: GROUNDS.steep }), 'seat_house', {}).nodes,
      door: 'door_front',
      steps: 1,
    },
  ]
  for (const { name, scene, door, steps } of cases)
    test(`${name}: the foot is on the ground, the top at the sill, the door served`, () => {
      const { nodes, result } = runTool(scene(), 'add_steps_to_ground', { doorId: door })
      expect(result.stepCount).toBe(steps)
      const read = facts(nodes)
      const flight = read.steps.find((each) => each.stairId === result.stairId)
      expect(flight?.footOverGroundM).toBeCloseTo(0, 2)
      expect(flight?.doorId).toBe(door)
      expect(Math.abs(flight?.topOverSillM ?? 1)).toBeLessThanOrEqual(0.02)
      const served = read.houses[0]?.doors.find((each) => each.doorId === door)
      expect(served?.servedBy).toBe(result.stairId as string)
      const codes = read.open.filter(
        (finding) => finding.id === door || finding.id === result.stairId,
      )
      expect(codes).toEqual([])
    })

  const refusals: [string, () => unknown, string][] = [
    [
      'the ground over the sill',
      () =>
        runTool(slopedLot({ ground: GROUNDS.riseToRear }), 'add_steps_to_ground', {
          doorId: 'door_front',
        }),
      'door_below_ground',
    ],
    [
      'a node that is not a door',
      () => runTool(slopedLot(), 'add_steps_to_ground', { doorId: 'wall_front' }),
      'not_a_door',
    ],
    [
      'a door that is not there',
      () => runTool(slopedLot(), 'add_steps_to_ground', { doorId: 'door_missing' }),
      'node_not_found',
    ],
    [
      'a rise of 2 m or more',
      () =>
        runTool(
          slopedLot({ ground: GROUNDS.fallToRear, slabElevation: 1.4 }),
          'add_steps_to_ground',
          { doorId: 'door_rear' },
        ),
      'steps_too_tall',
    ],
  ]
  for (const [name, run, code] of refusals)
    test(`refused: ${name} (${code})`, () => {
      expect(refusal(run)).toBe(code)
    })
})

/*
 * Steps and the seat. Steps made before a house was seated climbed to where its sill was; a house
 * lifted by hand on a site with no relief is not carried by the ground, and its steps stood at the
 * house's height (the trial team's n2e and n2d, 13 Nov).
 */
describe('steps to the ground and the seat of the house', () => {
  const stepFindings = (nodes: Nodes) =>
    facts(nodes)
      .open.map((finding) => finding.code)
      .filter((code) => code.startsWith('steps_'))

  test('steps made before the house is seated are solved again from the new sill and ground', () => {
    const built = agentHouse({ ground: GROUNDS.fallToRear })
    const door = facts(built).houses[0]?.doors.find((each) => each.stepM > 0.3)
    const stepped = runSettled(built, 'add_steps_to_ground', { doorId: door?.doorId }).nodes
    expect(stepFindings(stepped)).toEqual([])
    const before = facts(stepped).steps[0]
    const { nodes, result } = runSettled(stepped, 'seat_house', {})
    const [resolved] = result.stepsResolved as { stairId: string; doorId: string; riseM?: number }[]
    expect(resolved).toMatchObject({ stairId: before?.stairId, doorId: door?.doorId })
    expect(stepFindings(nodes)).toEqual([])
    const after = facts(nodes).steps[0]
    if (resolved?.riseM === undefined) expect(after).toBeUndefined()
    else {
      expect(after?.topOverSillM).toBeCloseTo(0, 1)
      expect(after?.footOverGroundM).toBeCloseTo(0, 1)
      expect(resolved.riseM).toBeLessThan((before?.topM as number) - (before?.footM as number))
    }
  })

  test('a house lifted 0.9 m by hand on a site with no relief: its steps stand on the ground, their top at the sill', () => {
    const lifted = slopedLot({ ground: GROUNDS.flat, at: [0, 0.9, 0] })
    const { nodes, result } = runTool(lifted, 'add_steps_to_ground', { doorId: 'door_front' })
    expect(result).toMatchObject({ groundAtFootM: 0, sillM: 1.05 })
    expect(stepFindings(nodes)).toEqual([])
    expect(facts(nodes).steps[0]).toMatchObject({ footM: 0, footOverGroundM: 0 })
  })
})

describe('limits are checked before anything is sampled', () => {
  /*
   * These operations are reached from model-written input and from the MCP. Each bound is stated
   * in the tool's text and refused before a station, a sample or a field is made: every case
   * below answers in well under a second.
   */
  const far = 1e9
  const many = Array.from({ length: 65 }, (_, i) => [i * 0.1, 0])
  const cases: [string, string, Record<string, unknown>, string][] = [
    [
      'grade_along_line: a line of a million kilometres',
      'grade_along_line',
      {
        scope: 'context',
        line: [
          [0, 0],
          [far, 0],
        ],
      },
      'invalid_input',
    ],
    [
      'grade_along_line: a line of 2.4 km inside its 500 m of the lot',
      'grade_along_line',
      {
        scope: 'context',
        line: [
          [-500, -500],
          [500, -500],
          [500, 500],
          [-500, 500],
        ],
      },
      'sampling_limit',
    ],
    ['grade_along_line: 65 points', 'grade_along_line', { line: many }, 'invalid_input'],
    [
      'grade_along_line: a point that is not finite',
      'grade_along_line',
      {
        line: [
          [0, 0],
          [Number.POSITIVE_INFINITY, 0],
        ],
      },
      'invalid_input',
    ],
    [
      'grade_along_line: a point that is not a number',
      'grade_along_line',
      {
        line: [
          [0, 0],
          [Number.NaN, 5],
        ],
      },
      'invalid_input',
    ],
    [
      'grade_along_line: an end height of a million metres',
      'grade_along_line',
      {
        line: [
          [0, 0],
          [0, 10],
        ],
        maxSlopePercent: 10,
        endHeightM: 1e6,
      },
      'invalid_input',
    ],
    [
      'grade_along_line: end heights whose batters would run 40 m out',
      'grade_along_line',
      {
        line: [
          [0, -15],
          [0, 15],
        ],
        maxSlopePercent: 100,
        startHeightM: 25,
        endHeightM: 25,
        run: 20,
      },
      'invalid_input',
    ],
    [
      'grade_along_line: a 20 m strip along a 1.9 km line',
      'grade_along_line',
      {
        scope: 'context',
        line: [
          [-480, -480],
          [480, -480],
          [480, 480],
        ],
        widthM: 20,
      },
      'sampling_limit',
    ],
    [
      'set_terrain_plane: a circle of a million metres',
      'set_terrain_plane',
      {
        scope: 'context',
        area: { center: [0, 0], radiusM: 1e6 },
        through: [{ at: [0, 0], heightM: 1 }],
      },
      'invalid_input',
    ],
    [
      'set_terrain_plane: a circle of 900 m',
      'set_terrain_plane',
      {
        scope: 'context',
        area: { center: [0, 0], radiusM: 900 },
        through: [{ at: [0, 0], heightM: 1 }],
      },
      'sampling_limit',
    ],
    [
      'set_terrain_plane: a corner a million kilometres away',
      'set_terrain_plane',
      {
        scope: 'context',
        area: [
          [0, 0],
          [far, 0],
          [0, far],
        ],
        through: [{ at: [0, 0], heightM: 1 }],
      },
      'invalid_input',
    ],
    [
      'set_terrain_plane: a plane a million metres high',
      'set_terrain_plane',
      { area: { center: [0, 0], radiusM: 3 }, through: [{ at: [0, 0], heightM: 1e6 }] },
      'invalid_input',
    ],
    [
      'set_terrain_plane: a plane through a point a million kilometres away',
      'set_terrain_plane',
      {
        area: { center: [0, 0], radiusM: 3 },
        through: [
          { at: [0, 0], heightM: 0 },
          { at: [far, 0], heightM: 1 },
        ],
      },
      'invalid_input',
    ],
    ['seat_house: ground a million metres up', 'seat_house', { groundM: 1e6 }, 'invalid_input'],
    ['seat_house: a pad margin of a kilometre', 'seat_house', { marginM: 1000 }, 'invalid_input'],
    ['seat_house: a reach of a kilometre', 'seat_house', { reachM: 1000 }, 'invalid_input'],
    [
      'seat_house hillside: holding a kilometre of ground',
      'seat_house',
      { strategy: 'hillside', retainM: 1000 },
      'invalid_input',
    ],
    [
      'seat_house hillside: an areaway of a kilometre',
      'seat_house',
      { strategy: 'hillside', areawayM: 1000 },
      'invalid_input',
    ],
    [
      'read_terrain_facts: a section to a point that is not finite',
      'read_terrain_facts',
      { section: { from: [0, 0], to: [Number.POSITIVE_INFINITY, 0] } },
      'invalid_input',
    ],
  ]
  for (const [name, tool, input, code] of cases)
    test(`${name}: ${code}, at once`, () => {
      const started = performance.now()
      expect(refusal(() => runTool(slopedLot({ ground: GROUNDS.steep }), tool, input))).toBe(code)
      expect(performance.now() - started).toBeLessThan(1000)
    })

  /*
   * The outline of the house is the scene's own slab, and a scene is model-written: every terrain
   * sample is measured against every side of it, and the low line walks it station by station.
   */
  const ringOf = (corners: number): [number, number][] =>
    Array.from({ length: corners }, (_, i) => [
      5 * Math.cos((2 * Math.PI * i) / corners),
      3.5 * Math.sin((2 * Math.PI * i) / corners),
    ])
  const houseWithOutline = (corners: number) => {
    const house = slopedLot({ ground: GROUNDS.steep })
    return { ...house, slab_floor: { ...house.slab_floor, polygon: ringOf(corners) } as AnyNode }
  }
  test('seat_house: a floor outline of 20,000 corners is refused before it is graded against, at once', () => {
    const started = performance.now()
    expect(refusal(() => runTool(houseWithOutline(20_000), 'seat_house', {}))).toBe(
      'sampling_limit',
    )
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('seat_house: a floor outline of 300 corners is seated, with no low line round it, and the answer says so', () => {
    const started = performance.now()
    const { result } = runTool(houseWithOutline(300), 'seat_house', { strategy: 'cut', reachM: 3 })
    expect(result.lowLine).toBeUndefined()
    expect((result.unmet as string[]).join(' ')).toContain('300 corners')
    expect(performance.now() - started).toBeLessThan(5000)
  })

  test('read_terrain_facts: a section of a million kilometres is cut at 2,000 stations and answers', () => {
    const started = performance.now()
    const { result } = runTool(slopedLot({ ground: GROUNDS.steep }), 'read_terrain_facts', {
      section: { from: [0, 0], to: [far, 0] },
    })
    expect((result.section as { ground: unknown[] }).ground.length).toBeLessThanOrEqual(2001)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})
