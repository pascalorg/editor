import { describe, expect, test } from 'bun:test'
import { type AnyNode, type LevelNode, WindowNode } from '../schema'
import {
  agentHouse,
  GROUNDS,
  type Ground,
  runSettled,
  runTool,
  slopedLot,
} from './__fixtures__/sloped-lots'
import { type TerrainFacts, terrainFacts } from './terrain-facts'

/*
 * What stands on the ground, against the ground, as facts. The lots are those of sloped-lots: a
 * 12 x 8 m house whose floor is +0.15 over the building's origin, a front door toward the street
 * (+z) and a rear door, the building as an agent leaves it (y = 0) unless a case seats it.
 */

type Nodes = Record<string, AnyNode>
const facts = (nodes: Nodes, options = {}) => terrainFacts(nodes, options) as TerrainFacts
const codes = (nodes: Nodes) =>
  facts(nodes)
    .open.map((finding) => `${finding.code}:${finding.id}`)
    .sort()
const built = (ground: Ground | null, extra = {}) => slopedLot({ ground, ...extra })
const after = (nodes: Nodes, ...calls: [string, Record<string, unknown>][]) =>
  calls.reduce((scene, [tool, input]) => runTool(scene, tool, input).nodes, nodes)

describe('terrain facts: the house against the ground', () => {
  const cases: { name: string; scene: () => Nodes; open: string[] }[] = [
    { name: 'a flat lot, the house as built', scene: () => built(GROUNDS.flat), open: [] },
    {
      name: 'a flat lot, the house turned and off centre',
      scene: () => built(GROUNDS.flat, { at: [3, 0, -2], turn: Math.PI / 6 }),
      open: [],
    },
    {
      name: 'the ground 1 m under the house: the floor is in the air and both doors open over it',
      scene: () => built(GROUNDS.fallToRear),
      open: [
        'door_above_ground:door_front',
        'door_above_ground:door_rear',
        'floor_in_air:level_ground',
        'ground_falls_to_wall:wall_front',
      ],
    },
    {
      name: 'the ground 1 m over the house: it stands over the floor and over both sills',
      scene: () => built(GROUNDS.riseToRear),
      open: [
        'door_below_ground:door_front',
        'door_below_ground:door_rear',
        'ground_falls_to_wall:wall_rear',
        'ground_over_floor:level_ground',
        'room_light_behind_earth:zone_living',
      ],
    },
    {
      name: 'a hillside through the house: buried behind, in the air in front',
      scene: () => built(GROUNDS.steep),
      open: [
        'door_above_ground:door_front',
        'door_below_ground:door_rear',
        'floor_in_air:level_ground',
        'ground_falls_to_wall:wall_rear',
        'ground_over_floor:level_ground',
      ],
    },
    {
      name: 'seated on the mean ground by set_ground_level: the uphill edge and its door are under it',
      scene: () =>
        after(built(GROUNDS.fallToRear), ['set_ground_level', { levelId: 'level_ground' }]),
      open: [
        'door_above_ground:door_rear',
        'door_below_ground:door_front',
        'ground_falls_to_wall:wall_front',
        'ground_over_floor:level_ground',
      ],
    },
    {
      name: 'the ground brought to the house by grade_around_house: nothing open',
      scene: () => after(built(GROUNDS.fallToRear), ['grade_around_house', {}]),
      open: [],
    },
    {
      name: 'a house cut into rising ground by grade_around_house: the bank runs to every wall',
      scene: () => after(built(GROUNDS.riseToRear), ['grade_around_house', {}]),
      open: [
        'ground_falls_to_wall:wall_front',
        'ground_falls_to_wall:wall_left',
        'ground_falls_to_wall:wall_rear',
        'ground_falls_to_wall:wall_right',
      ],
    },
  ]
  for (const { name, scene, open } of cases)
    test(name, () => {
      expect(codes(scene())).toEqual(open)
    })

  test('the numbers of a house standing 1 m over a falling lot', () => {
    const [house] = facts(built(GROUNDS.fallToRear)).houses
    expect(house?.floorM).toEqual({ min: 0.15, max: 0.15 })
    expect(house?.groundM).toEqual({ lowest: -1.2, highest: -0.8, mean: -1 })
    expect(house?.floorOverGroundM).toEqual({ min: 0.95, max: 1.35 })
    expect(house?.floorInAirShare).toBe(1)
    const front = house?.walls.find((wall) => wall.wallId === 'wall_front')
    expect(front).toMatchObject({ side: 'front', outward: [0, 1], lengthM: 12 })
    expect(front?.fallAwayPercent).toEqual({ min: -5, max: -5 })
    expect(house?.walls.find((wall) => wall.wallId === 'wall_rear')).toMatchObject({
      side: 'rear',
      fallAwayPercent: { min: 5, max: 5 },
      fallsTowardLengthM: 0,
    })
    const door = house?.doors.find((each) => each.doorId === 'door_front')
    expect(door).toMatchObject({ at: [0, 4.65], sillM: 0.15, outside: 'ground' })
    expect(door?.outsideM).toBeCloseTo(-0.77, 1)
    expect(door?.stepM).toBeCloseTo(0.92, 1)
  })

  test('a turned, moved building is read where it stands', () => {
    const [house] = facts(built(GROUNDS.fallToRear, { at: [3, 0, -2], turn: Math.PI / 2 })).houses
    // A quarter turn puts the plate's long side along z: the ground under it runs from z -8 to 4.
    expect(house?.groundM.lowest).toBeCloseTo(-1.4, 2)
    expect(house?.groundM.highest).toBeCloseTo(-0.8, 2)
    // The front door (building-local [0, 4.65]) now looks along +x.
    expect(house?.doors.find((door) => door.doorId === 'door_front')?.at).toEqual([7.65, -2])
  })

  test('a flat site says so and measures against the datum', () => {
    const read = facts(built(GROUNDS.flat))
    expect(read.hasTerrain).toBe(false)
    expect(read.note).toContain('flat datum')
    expect(read.houses[0]?.doors.map((door) => door.stepM)).toEqual([0.15, 0.15])
    expect(read.earthwork).toBeUndefined()
  })
})

describe('terrain facts: what is laid and built on the ground', () => {
  // Skipped in this cut: it needs add_site_surface (site flatwork, a sibling of terrain), which this PR does not carry.
  test.skip('a flat drive over a hillside hangs in the air; a draped walk follows it too steeply', () => {
    const scene = after(
      built(GROUNDS.steep),
      [
        'add_site_surface',
        {
          kind: 'driveway',
          corners: [
            [8.5, 5],
            [11.5, 20],
          ],
          levelId: 'level_ground',
        },
      ],
      [
        'add_site_surface',
        {
          kind: 'path',
          terrainMode: 'draped',
          corners: [
            [-11, 5],
            [-9.8, 20],
          ],
          levelId: 'level_ground',
        },
      ],
    )
    const read = facts(scene)
    const drive = read.surfaces.find((surface) => surface.kind === 'driveway')
    const walk = read.surfaces.find((surface) => surface.kind === 'walk')
    expect(drive).toMatchObject({ mode: 'flat', overGroundM: { min: 1.05, max: 4.05 } })
    expect(walk).toMatchObject({ mode: 'draped', overGroundM: { min: 0.03, max: 0.03 } })
    expect(walk?.slopePercent.max).toBeCloseTo(20, 0)
    const open = read.open.map((finding) => finding.code)
    expect(open).toContain('surface_off_ground')
    expect(open).toContain('surface_steep')
  })

  // Skipped in this cut: it needs add_steps (outside steps, a sibling of terrain), which this PR does not carry.
  test.skip('steps of the right rise from the right foot serve the door; a wrong rise misses its sill', () => {
    const house = built(GROUNDS.fallToRear)
    const door = facts(house).houses[0]?.doors.find((each) => each.doorId === 'door_front')
    expect(door?.stepM).toBeCloseTo(0.92, 1)
    // Five risers on goings of 0.26: a run of 1.31 m, the foot that far before the wall's face.
    const fitted = after(house, ['add_steps', { x: 0, z: 5.4, rise: 0.92, rotation: 180 }])
    const served = facts(fitted)
    expect(served.steps[0]).toMatchObject({ footOverGroundM: 0, doorId: 'door_front' })
    expect(Math.abs(served.steps[0]?.topOverSillM ?? 1)).toBeLessThanOrEqual(0.05)
    expect(served.open.map((finding) => `${finding.code}:${finding.id}`)).not.toContain(
      'door_above_ground:door_front',
    )
    const short = facts(after(house, ['add_steps', { x: 0, z: 5.4, rise: 0.5, rotation: 180 }]))
    expect(short.open.map((finding) => finding.code)).toContain('steps_miss_door')
  })

  test('a ramp whose start is left at height 0 over ground 4 m lower is off the ground', () => {
    const scene = after(built(GROUNDS.steep), [
      'add_ramp',
      { start: [-3, 20], segments: [{ type: 'line', end: [-3, 6] }], width: 3, endHeight: 0.1 },
    ])
    const read = facts(scene)
    expect(read.ramps[0]?.ends[0]).toMatchObject({ at: [-3, 20], heightM: 0 })
    expect(read.ramps[0]?.ends[0]?.overGroundM).toBeGreaterThan(3.9)
    expect(read.open.map((finding) => finding.code)).toContain('ramp_end_off_ground')
  })

  test('a retained pad states the height it holds; a filled pad left as a lattice step is a bank no face holds', () => {
    const pad = {
      pad: [
        [-7, -5],
        [7, -5],
        [7, 5],
        [-7, 5],
      ],
      padHeightM: 0,
    }
    const held = facts(
      after(built(GROUNDS.riseToRear), ['carve_terrain_pad', { ...pad, edges: 'retaining' }]),
    )
    expect(held.retaining).toEqual([
      expect.objectContaining({
        kind: 'retaining',
        lengthM: 48,
        heightM: { min: 0.75, max: 1.25 },
      }),
    ])
    expect(held.open.map((finding) => finding.code)).not.toContain('steep_bank')
    const loose = facts(
      after(built(GROUNDS.fallToRear), ['carve_terrain_pad', { ...pad, blendM: 3 }]),
    )
    expect(loose.retaining).toEqual([])
    expect(loose.banks.areaM2).toBeGreaterThan(10)
    expect(loose.open.map((finding) => finding.code)).toContain('steep_bank')
  })

  test('the earth a grading moved is stated against the ground before it', () => {
    const graded = runTool(built(GROUNDS.fallToRear), 'grade_around_house', {})
    const read = facts(graded.nodes)
    expect(read.earthwork?.against).toBe('base_field')
    expect(read.earthwork?.cutM3).toBeCloseTo(0, 0)
    expect(read.earthwork?.fillM3).toBeCloseTo(graded.result.fillVolumeM3 as number, -1)
  })
})

describe('terrain facts: a section through the house and the ground', () => {
  test('a plane is two breakpoints, the floor a span with its clearance', () => {
    const read = facts(built(GROUNDS.fallToRear), { section: { from: [0, -20], to: [0, 20] } })
    expect(read.section?.ground).toEqual([
      { sM: 0, groundM: -2 },
      { sM: 40, groundM: 0 },
    ])
    expect(read.section?.floors).toEqual([
      {
        slabId: 'slab_floor',
        fromM: 16,
        toM: 24,
        topM: 0.15,
        overGroundM: { min: 0.95, max: 1.35 },
      },
    ])
  })

  test('a graded section keeps the pad, the batter and the daylight line as breakpoints', () => {
    const graded = after(built(GROUNDS.fallToRear), ['grade_around_house', {}])
    const section = facts(graded, { section: { from: [0, -20], to: [0, 20] } }).section
    const at = (sM: number) => section?.ground.find((point) => point.sM === sM)?.groundM
    // The pad: 1 m beyond the walls (z -5 to 5 is 15 to 25 m along), level at 0.
    expect(at(15)).toBe(0)
    expect(at(25)).toBe(0)
    expect(section?.ground.length).toBeLessThan(12)
    expect(section?.floors[0]?.overGroundM).toEqual({ min: 0.15, max: 0.15 })
  })
})

/*
 * Earth against a house: a house backed into a slope holds ground on its walls. The facts say how
 * much on each wall, what its windows and rooms keep, and whether water runs to the wall; none of
 * it is a finding by itself.
 */
describe('terrain facts: a house that holds earth', () => {
  const hill: Ground = (_x, z) => -z * 0.35
  /** The fixture house with a window in its rear wall, sill 0.9 m over the floor, 1.2 m high. */
  const withRearWindow = () =>
    slopedLot({
      ground: hill,
      extra: [
        WindowNode.parse({
          id: 'window_rear',
          parentId: 'wall_rear',
          wallId: 'wall_rear',
          position: [3, 1.5, 0],
          height: 1.2,
          width: 1.2,
        }),
      ],
    })
  const wallOf = (read: TerrainFacts, id: string) =>
    read.houses[0]?.walls.find((wall) => wall.wallId === id)

  test('backed into a 35 % hill: 2.3 m of earth on the rear wall, the side walls from that to none, a low line 0.04 m and more under each foot, no water to a wall', () => {
    const read = facts(runTool(built(hill), 'seat_house', { strategy: 'hillside' }).nodes)
    const rear = wallOf(read, 'wall_rear')
    expect(rear?.earthAgainstM.max).toBeGreaterThanOrEqual(2.3)
    expect(rear?.earthLengthM).toBeCloseTo(12, 0)
    expect(rear?.buriedShare).toBeGreaterThan(0.8)
    expect(rear?.lowLineUnderFootM.min).toBeGreaterThanOrEqual(0.04)
    expect(rear?.fallsTowardLengthM).toBe(0)
    const side = wallOf(read, 'wall_left')
    expect(side?.earthAgainstM.max).toBeGreaterThan(2)
    expect(side?.earthAgainstM.mean).toBeLessThan(side?.earthAgainstM.max as number)
    expect(wallOf(read, 'wall_front')?.earthAgainstM.max).toBe(0)
    // The rear door of the fixture house is in the wall that holds the earth.
    expect(read.open.map((finding) => `${finding.code}:${finding.id}`)).toEqual([
      'door_below_ground:door_rear',
    ])
  })

  test('across an areaway the wall holds none: the face stands 1.2 m before it, 2.3 m and more high, and the ground over the face does not run to the wall', () => {
    const read = facts(
      runTool(built(hill, { doors: false }), 'seat_house', { strategy: 'hillside', areawayM: 1.2 })
        .nodes,
    )
    const rear = wallOf(read, 'wall_rear')
    expect(rear?.earthAgainstM.max).toBe(0)
    expect(rear?.faceBefore?.distanceM).toBeGreaterThanOrEqual(1)
    expect(rear?.faceBefore?.distanceM).toBeLessThanOrEqual(1.4)
    expect(rear?.faceBefore?.heightM).toBeGreaterThanOrEqual(2.3)
    expect(read.open.map((finding) => finding.code)).toEqual([])
  })

  for (const [name, input, under] of [
    ['held to the storey: the ground stands over the sill of the rear window', {}, true],
    ['held 0.8 m: the window is clear', { retainM: 0.8, run: 1 }, false],
  ] as const)
    test(`a window in the wall that holds the earth, ${name}`, () => {
      const read = facts(
        runTool(withRearWindow(), 'seat_house', { strategy: 'hillside', ...input }).nodes,
      )
      const window = wallOf(read, 'wall_rear')?.windows[0]
      expect(window?.windowId).toBe('window_rear')
      expect((window?.underGroundM as number) > 0).toBe(under)
      expect(read.open.some((finding) => finding.code === 'window_below_ground')).toBe(under)
      // The room keeps its front door on the open side: it is not a room behind earth.
      expect(read.houses[0]?.roomsAgainstEarth[0]).toMatchObject({
        zoneId: 'zone_living',
        declared: false,
      })
      expect(read.open.some((finding) => finding.code === 'room_light_behind_earth')).toBe(false)
    })
})

describe('terrain facts: one floor, read one way', () => {
  test('a seat read before the scene settles and after: the same door steps', () => {
    const house = agentHouse({ ground: GROUNDS.fallToRear })
    const steps = (nodes: Nodes) => facts(nodes).houses[0]?.doors.map((door) => door.stepM)
    const unsettled = runTool(house, 'seat_house', {}).nodes
    const settled = runSettled(house, 'seat_house', {}).nodes
    expect(steps(unsettled)).toEqual(steps(settled))
    expect(Math.max(...(steps(settled) as number[]))).toBeLessThanOrEqual(0.2)
  })
})

describe('terrain facts: a drive is read the way it is travelled', () => {
  // Skipped in this cut: it needs add_site_surface (site flatwork, a sibling of terrain), which this PR does not carry.
  test.skip('a bed graded to 18 %, a driveway draped on its outline: no steeper than the bed along it, the batter at its edges apart', () => {
    const lot = slopedLot({ ground: GROUNDS.steep })
    const bed = runTool(lot, 'grade_along_line', {
      line: [
        [-13, 18],
        [-7, 6],
        [-13, -6],
      ],
      widthM: 3,
      maxSlopePercent: 18,
    })
    expect(bed.result.steepestPercent as number).toBeLessThanOrEqual(18)
    const paved = runTool(bed.nodes, 'add_site_surface', {
      kind: 'driveway',
      terrainMode: 'draped',
      polygon: (bed.result.outline as number[][]).map(([x, z]) => [x, z]),
    }).nodes
    const drive = facts(paved).surfaces.find((surface) => surface.kind === 'driveway')
    expect(drive?.slopePercent.max).toBeLessThanOrEqual(18.6)
    expect(drive?.crossFallPercent?.mean).toBeLessThan(3)
    expect(drive?.steepestGroundPercent).toBeGreaterThanOrEqual(drive?.slopePercent.max as number)
    expect(codes(paved).filter((code) => code.startsWith('surface_steep'))).toEqual([])
  })
})

describe('terrain facts and verify_scene on a house that walks out', () => {
  const lower = (house: Nodes) =>
    Object.values(house).find(
      (node): node is LevelNode => node.type === 'level' && node.name === 'Lower',
    ) as LevelNode
  function withLower() {
    let house = agentHouse({ ground: (_x, z) => -0.16 * z })
    house = runSettled(house, 'add_level', { position: 'below', name: 'Lower', height: 2.7 }).nodes
    return runSettled(house, 'create_room', {
      levelId: lower(house).id,
      name: 'Rumpus',
      polygon: [
        [-6, -4],
        [6, -4],
        [6, 4],
        [-6, 4],
      ],
      doors: [{ wallIndex: 2, t: 0.5 }],
    }).nodes
  }
  const issues = (nodes: Nodes) =>
    (runTool(nodes, 'verify_scene', {}).result.issues as { type: string; message: string }[]).map(
      (issue) => issue.type,
    )

  test('walked out: the ground level stands over the low ground on purpose; verify_scene does not call it unseated, the facts do not call its floor in the air', () => {
    const { nodes } = runSettled(withLower(), 'seat_house', { strategy: 'walk_out' })
    expect(issues(nodes)).not.toContain('ground_level_unseated')
    expect(codes(nodes).filter((code) => code.startsWith('floor_in_air'))).toEqual([])
  })

  test('seated by its ground level alone: the door of the level under it stays in the ground, and the answer says which strategy opens it', () => {
    const { result } = runSettled(withLower(), 'seat_house', {})
    expect((result.unmet as string[]).join(' ')).toContain('walk_out stands that level')
  })
})

describe('terrain facts: faces and drops', () => {
  /** A 6 m cliff across a level lot at z = -6: the plateau behind it, the low ground before it. */
  const cliffed = (at: [number, number, number]) =>
    runTool(slopedLot({ ground: () => 0, at }), 'add_terrain_break', {
      line: [
        [-15, -6],
        [15, -6],
      ],
      kind: 'cliff',
      left: 0,
      right: 6,
    }).nodes
  for (const [name, at, stands, finding] of [
    [
      'a house on the plateau, its front wall 1 m from the edge',
      [0, 6, -11],
      { standsAt: 'top', distanceM: 1 },
      true,
    ],
    [
      'the same house 4 m back from the edge',
      [0, 6, -14],
      { standsAt: 'top', distanceM: 4 },
      false,
    ],
    [
      'a house at the foot, its rear wall 1 m from the face',
      [0, 0, -1],
      { standsAt: 'foot', distanceM: 1 },
      false,
    ],
  ] as const)
    test(`${name}: the face names the house, where it stands and how far${finding ? ', and it stands at the edge of a drop' : ''}`, () => {
      const read = facts(cliffed(at as [number, number, number]))
      expect(read.retaining[0]).toMatchObject({ kind: 'cliff', heightM: { min: 6, max: 6 } })
      expect(read.retaining[0]?.houses).toEqual([{ buildingId: 'building_house', ...stands }])
      expect(read.open.some((each) => each.code === 'house_at_drop_edge')).toBe(finding)
    })

  test('the face that holds the ground against a house backed into a slope is not a drop the house stands at', () => {
    const read = facts(
      runTool(
        built((_x, z) => -z * 0.35, { doors: false }),
        'seat_house',
        { strategy: 'hillside' },
      ).nodes,
    )
    expect(read.retaining[0]?.houses).toEqual([])
  })

  for (const [name, retainingHeight, unheld] of [
    ['with no retaining sides, the faces beside it stand unheld', undefined, true],
    ['with retaining sides of 1.2 m, they are held', 1.2, false],
  ] as const)
    test(`a ramp cut into a 20 % slope, ${name}`, () => {
      const lot = slopedLot({ ground: GROUNDS.steep, house: false })
      const { nodes } = runTool(lot, 'add_ramp', {
        start: [10, 19],
        segments: [{ type: 'line', end: [10, 4] }],
        width: 3,
        startHeight: -3.8,
        endHeight: -1.8,
        use: 'vehicle',
        ...(retainingHeight ? { retainingHeight } : {}),
      })
      const [ramp] = facts(nodes).ramps
      expect(ramp?.sides.cutMaxM).toBeGreaterThan(0.8)
      expect(ramp?.sides.cutMaxM).toBeLessThan(1.2)
      expect((ramp?.sides.unheldLengthM as number) > 1).toBe(unheld)
      expect(codes(nodes).some((code) => code.startsWith('ramp_side_unheld'))).toBe(unheld)
    })
})
