import { describe, expect, test } from 'bun:test'
import {
  building,
  bungalow,
  bungalow8ft,
  gablePorch,
  level,
  mainRoof,
  portico,
  roof,
  room,
  scene,
  shedPorch,
  TOP,
} from '../agent-operations/__fixtures__/roof-bearing-cases'
import { applySceneChanges, applySceneWrites } from '../agent-operations/apply-changes'
import { verifyScene } from '../agent-operations/verify-scene'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  getActiveRoofHeight,
  LevelNode,
  parseNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { resolveRoofElevation } from '../systems/roof/roof-elevation'
import {
  coveredStoreyId,
  isRoofLevel,
  liftRoofLevels,
  planRoofLevel,
  roofLevelAbove,
  roofLevelOrderBreach,
  roofsOver,
  servesAsRoofLevel,
  storeyInsertIndex,
  storeyOf,
} from './roof-level'
import {
  isRoofOnStoreyWalls,
  planRoofsOffStorey,
  roofsKeptOverStorey,
  seatRoofs,
} from './roof-move'
import { getLevelElevations } from './storey'

// One rule for every roof writer (a roof made on the ground floor's level blocks the exploded
// view): a roof lives on the level directly above the storey whose walls carry it, and over the top
// storey that is the building's roof level.

type Content = 'walls' | 'roof' | 'empty'

function house(...stack: { id: string; content: Content; metadata?: Record<string, unknown> }[]) {
  const nodes: Record<string, AnyNode> = {}
  const building = BuildingNode.parse({ id: 'building_h', children: stack.map(({ id }) => id) })
  nodes[building.id] = building
  stack.forEach(({ id, content, metadata }, index) => {
    const children: AnyNode[] =
      content === 'walls'
        ? [
            WallNode.parse({ id: `wall_${id}`, parentId: id, start: [0, 0], end: [6, 0] }),
            ZoneNode.parse({
              id: `zone_${id}`,
              parentId: id,
              name: 'Room',
              polygon: [
                [0, 0],
                [6, 0],
                [6, 4],
                [0, 4],
              ],
            }),
          ]
        : content === 'roof'
          ? [RoofNode.parse({ id: `roof_${id}`, parentId: id })]
          : []
    nodes[id] = LevelNode.parse({
      id,
      parentId: building.id,
      level: index,
      height: 2.5,
      children: children.map((child) => child.id),
      ...(metadata ? { metadata } : {}),
    })
    for (const child of children) nodes[child.id] = child
  })
  return nodes
}

/**
 * A 12 × 8 m ground floor and a 6 × 8 m first floor over its west half, walls 2.7 m tall on 2.5 m
 * storeys; `roofs` places roofs as `[id, levelId, centre x, y, width]`, 8 m deep, at custom heights.
 */
function wingHouse(roofs: [string, string, number, number, number][]) {
  const nodes: Record<string, AnyNode> = {}
  const rect = (prefix: string, levelId: string, corners: [number, number][]) =>
    corners.map((start, i) =>
      WallNode.parse({
        id: `${prefix}${i}`,
        parentId: levelId,
        start,
        end: corners[(i + 1) % corners.length],
        height: 2.7,
      }),
    )
  const walls = {
    level_g: rect('wall_g', 'level_g', [
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ]),
    level_1: rect('wall_u', 'level_1', [
      [0, 0],
      [6, 0],
      [6, 8],
      [0, 8],
    ]),
  }
  nodes.building_h = BuildingNode.parse({ id: 'building_h', children: ['level_g', 'level_1'] })
  for (const [index, levelId] of (['level_g', 'level_1'] as const).entries()) {
    const held = roofs.filter(([, on]) => on === levelId).map(([id]) => id)
    nodes[levelId] = LevelNode.parse({
      id: levelId,
      parentId: 'building_h',
      level: index,
      height: 2.5,
      children: [...walls[levelId].map((wall) => wall.id), ...held],
    })
    for (const wall of walls[levelId]) nodes[wall.id] = wall
  }
  for (const [id, levelId, x, y, width] of roofs) {
    const segment = RoofSegmentNode.parse({
      id: `rseg_${id}`,
      parentId: id,
      width,
      depth: 8,
      wallHeight: 0,
    })
    nodes[id] = RoofNode.parse({
      id,
      parentId: levelId,
      position: [x, y, 4],
      children: [segment.id],
    })
    nodes[segment.id] = segment
  }
  return nodes
}

describe('planRoofLevel', () => {
  test('over a bungalow, a new level named Roof on top, declared for the roof', () => {
    const plan = planRoofLevel(house({ id: 'level_g', content: 'walls' }), 'level_g', 3)
    expect(plan.kind).toBe('roof')
    if (plan.kind !== 'roof') return
    expect(plan.create).toMatchObject({ name: 'Roof', level: 1, height: 3, parentId: 'building_h' })
    expect(isRoofLevel(plan.create!)).toBe(true)
    expect(plan.levelId).toBe(plan.create!.id)
    // the new level stands on the storey: its floor is the storey's height up
    expect(plan.storeyOffset).toBe(-2.5)
  })

  test('over the top of two storeys, the roof level goes above the upper one', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_1', content: 'walls' })
    expect(planRoofLevel(nodes, 'level_1', 2)).toMatchObject({
      kind: 'roof',
      create: { level: 2 },
    })
  })

  test('over a storey with a storey above it, that storey: a lower roof covers part of it', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_1', content: 'walls' })
    expect(planRoofLevel(nodes, 'level_g', 2)).toEqual({
      kind: 'storey',
      levelId: 'level_1',
      storeyOffset: -2.5,
    })
  })

  test('the declared roof level above is reused as it is', () => {
    const nodes = house(
      { id: 'level_g', content: 'walls' },
      { id: 'level_r', content: 'roof', metadata: { role: 'roof' } },
    )
    expect(planRoofLevel(nodes, 'level_g', 2)).toEqual({
      kind: 'roof',
      levelId: 'level_r',
      storeyOffset: -2.5,
      create: null,
      update: [],
    })
  })

  test('a level that only holds roofs, never declared, is reused and declared', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_r', content: 'roof' })
    const plan = planRoofLevel(nodes, 'level_g', 2)
    expect(plan).toMatchObject({ kind: 'roof', levelId: 'level_r', create: null })
    if (plan.kind !== 'roof') return
    expect(plan.update).toEqual([
      { id: 'level_r', data: { metadata: { role: 'roof' }, name: 'Roof' } },
    ])
  })

  test('an empty level above becomes the roof level, keeping a name a person gave it', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_e', content: 'empty' })
    nodes.level_e = { ...nodes.level_e!, name: 'Attic' } as AnyNode
    const plan = planRoofLevel(nodes, 'level_g', 2)
    expect(plan).toMatchObject({ kind: 'roof', levelId: 'level_e', create: null })
    if (plan.kind !== 'roof') return
    expect(plan.update[0]?.data).toEqual({ metadata: { role: 'roof' }, name: 'Attic' })
  })

  test('an empty level with a storey above it is a storey not built yet, not a roof level', () => {
    const nodes = house(
      { id: 'level_g', content: 'walls' },
      { id: 'level_e', content: 'empty' },
      { id: 'level_2', content: 'walls' },
    )
    expect(planRoofLevel(nodes, 'level_g', 2)).toEqual({
      kind: 'storey',
      levelId: 'level_e',
      storeyOffset: -2.5,
    })
  })

  test('a support level holding a roof stays a support: the roof level goes above it', () => {
    const nodes = house(
      { id: 'level_g', content: 'walls' },
      { id: 'level_s', content: 'roof', metadata: { role: 'support' } },
    )
    expect(planRoofLevel(nodes, 'level_g', 2)).toMatchObject({
      kind: 'roof',
      create: { level: 2 },
      update: [],
    })
  })

  // Two rules disagreed: list_levels and verify_scene called a walled Roof level the roof level,
  // and this service a storey, so a '+' stacked a floor above it while the agents refused its walls.
  test('a declared roof level someone walled stays the roof level, kept on top', () => {
    const nodes = house(
      { id: 'level_g', content: 'walls' },
      { id: 'level_r', content: 'walls', metadata: { role: 'roof' } },
    )
    expect(planRoofLevel(nodes, 'level_g', 2)).toEqual({
      kind: 'roof',
      levelId: 'level_r',
      storeyOffset: -2.5,
      create: null,
      update: [],
    })
    expect(storeyInsertIndex(nodes, 'building_h')).toEqual({
      floorIndex: 1,
      shift: [{ id: 'level_r', data: { level: 2 } }],
    })
  })
})

describe('roofsOver', () => {
  test('the roofs on the roof level directly above, and any mixed into the storey', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_r', content: 'roof' })
    expect(roofsOver(nodes, 'level_g').map((roof) => roof.id)).toEqual(['roof_level_r'])
    const mixed = RoofNode.parse({ id: 'roof_low', parentId: 'level_g' })
    const level = nodes.level_g as LevelNode
    nodes.level_g = { ...level, children: [...level.children, mixed.id] }
    nodes[mixed.id] = mixed
    expect(
      roofsOver(nodes, 'level_g')
        .map((roof) => roof.id)
        .sort(),
    ).toEqual(['roof_level_r', 'roof_low'])
  })

  test('none on a storey with a storey above it', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_1', content: 'walls' })
    expect(roofsOver(nodes, 'level_g')).toEqual([])
  })

  // A porch roof drawn by hand stands on the upper storey, by the rule, at its floor: it covered
  // the upper storey too, so create_roof refused the house's own roof as roof_exists.
  test("a lower wing's roof on the storey above covers the storey below, not that one", () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_1', content: 'walls' })
    const porch = RoofNode.parse({ id: 'roof_porch', parentId: 'level_1', position: [8, 0, 0] })
    const legacy = RoofNode.parse({ id: 'roof_old', parentId: 'level_1', position: [3, 2.5, 2] })
    const level = nodes.level_1 as LevelNode
    nodes.level_1 = { ...level, children: [...level.children, porch.id, legacy.id] }
    nodes[porch.id] = porch
    nodes[legacy.id] = legacy

    expect(roofsOver(nodes, 'level_g').map((roof) => roof.id)).toEqual(['roof_porch'])
    // On its own walls' level, at their tops: written before roof levels, it covers that storey.
    expect(roofsOver(nodes, 'level_1').map((roof) => roof.id)).toEqual(['roof_old'])
  })
})

describe('storeyInsertIndex', () => {
  test('a new top storey takes the roof level’s place and the roof level moves up one', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_r', content: 'roof' })
    expect(storeyInsertIndex(nodes, 'building_h')).toEqual({
      floorIndex: 1,
      shift: [{ id: 'level_r', data: { level: 2 } }],
    })
  })

  test('with no roof level, above the highest level', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_e', content: 'empty' })
    expect(storeyInsertIndex(nodes, 'building_h')).toEqual({ floorIndex: 2, shift: [] })
  })

  test('a building whose only level holds a roof (a carport) gets its new storey on top', () => {
    expect(storeyInsertIndex(house({ id: 'level_c', content: 'roof' }), 'building_h')).toEqual({
      floorIndex: 1,
      shift: [],
    })
  })

  // Bugbot on #1057: the walk stopped at the lowest level, declared or not, so a storey went on top
  // of a building's only level when that level was its declared roof level.
  test('a building whose only level is its declared roof level gets its new storey under it', () => {
    const nodes = house({ id: 'level_r', content: 'roof', metadata: { role: 'roof' } })
    expect(storeyInsertIndex(nodes, 'building_h')).toEqual({
      floorIndex: 0,
      shift: [{ id: 'level_r', data: { level: 1 } }],
    })
  })

  test('a building with no level starts at the ground floor', () => {
    expect(storeyInsertIndex(house(), 'building_h')).toEqual({ floorIndex: 0, shift: [] })
  })
})

// The roof level is the declared one, else the run of roof-only levels topping the stack: a level
// holding only a lower wing's roof under a storey (or beside a declared roof level) is a storey still
// to be built, and the walls redrawn on it are not sent down a floor.
describe('servesAsRoofLevel', () => {
  const W = { content: 'walls' as const }
  const R = { content: 'roof' as const }
  const E = { content: 'empty' as const }
  const ROOF = { role: 'roof' }
  const cases: [string, Parameters<typeof house>, string, boolean][] = [
    [
      'declared, on top',
      [
        { id: 'level_g', ...W },
        { id: 'level_r', ...R, metadata: ROOF },
      ],
      'level_r',
      true,
    ],
    [
      'declared, walled',
      [
        { id: 'level_g', ...W },
        { id: 'level_r', ...W, metadata: ROOF },
      ],
      'level_r',
      true,
    ],
    [
      'roof-only on top, none declared',
      [
        { id: 'level_g', ...W },
        { id: 'level_r', ...R },
      ],
      'level_r',
      true,
    ],
    [
      'roof-only under a roof-only top',
      [
        { id: 'level_g', ...W },
        { id: 'level_1', ...R },
        { id: 'level_r', ...R },
      ],
      'level_1',
      true,
    ],
    [
      'roof-only under a storey',
      [
        { id: 'level_g', ...W },
        { id: 'level_1', ...R },
        { id: 'level_2', ...W },
      ],
      'level_1',
      false,
    ],
    [
      'roof-only under an empty level',
      [
        { id: 'level_g', ...W },
        { id: 'level_1', ...R },
        { id: 'level_2', ...E },
      ],
      'level_1',
      false,
    ],
    [
      'roof-only under a declared roof level',
      [
        { id: 'level_g', ...W },
        { id: 'level_1', ...R },
        { id: 'level_r', ...R, metadata: ROOF },
      ],
      'level_1',
      false,
    ],
    [
      'roof-only and lowest (a carport)',
      [
        { id: 'level_c', ...R },
        { id: 'level_1', ...W },
      ],
      'level_c',
      false,
    ],
    ['roof-only and alone', [{ id: 'level_c', ...R }], 'level_c', false],
    [
      'a support level holding a roof',
      [
        { id: 'level_g', ...W },
        { id: 'level_s', ...R, metadata: { role: 'support' } },
      ],
      'level_s',
      false,
    ],
  ]
  for (const [name, stack, id, serves] of cases)
    test(`${name}: ${serves ? 'the roof level' : 'a storey'}`, () => {
      const nodes = house(...stack)
      expect(servesAsRoofLevel(nodes, nodes[id] as LevelNode)).toBe(serves)
      expect(storeyOf(nodes, id) === id).toBe(!serves)
    })
})

describe('liftRoofLevels', () => {
  test('a storey added at the top run’s floor index lifts the roof level over it', () => {
    const before = house({ id: 'level_g', content: 'walls' }, { id: 'level_r', content: 'roof' })
    const after = applySceneChanges(before, {
      create: [{ node: LevelNode.parse({ id: 'level_1', parentId: 'building_h', level: 1 }) }],
    })
    expect(liftRoofLevels(before, after, 'building_h')).toEqual([
      { id: 'level_r', data: { level: 2 } },
    ])
  })

  test('a basement added under a stack leaves a roof-only level between storeys where it is', () => {
    const before = house(
      { id: 'level_g', content: 'walls' },
      { id: 'level_1', content: 'roof' },
      { id: 'level_2', content: 'walls' },
    )
    const after = applySceneChanges(before, {
      create: [{ node: LevelNode.parse({ id: 'level_b', parentId: 'building_h', level: -1 }) }],
    })
    expect(liftRoofLevels(before, after, 'building_h')).toEqual([])
  })
})

describe('roofLevelOrderBreach', () => {
  const stack = house(
    { id: 'level_c', content: 'roof' },
    { id: 'level_1', content: 'walls' },
    { id: 'level_2', content: 'walls' },
    { id: 'level_r', content: 'roof' },
  )
  test('swapping two storeys over a carport ground passes', () => {
    expect(
      roofLevelOrderBreach(
        stack,
        new Map([
          ['level_1', 2],
          ['level_2', 1],
        ]),
      ),
    ).toBeNull()
  })

  test('the roof level dropped under a storey it stood over is named', () => {
    expect(
      roofLevelOrderBreach(
        stack,
        new Map([
          ['level_r', 2],
          ['level_2', 3],
        ]),
      ),
    ).toEqual({ roofId: 'level_r', storeyId: 'level_2' })
  })

  test('an order a legacy stack already had passes', () => {
    const legacy = house(
      { id: 'level_g', content: 'walls' },
      { id: 'level_r', content: 'roof', metadata: { role: 'roof' } },
      { id: 'level_2', content: 'walls' },
    )
    expect(roofLevelOrderBreach(legacy, new Map([['level_2', 5]]))).toBeNull()
  })
})

describe('roofLevelAbove', () => {
  test('reads where planRoofLevel puts a roof, planning no level', () => {
    const bungalow = house({ id: 'level_g', content: 'walls' })
    expect(roofLevelAbove(bungalow, 'level_g')).toEqual({ kind: 'roof', level: null })
    const two = house({ id: 'level_g', content: 'walls' }, { id: 'level_1', content: 'walls' })
    expect(roofLevelAbove(two, 'level_g')).toMatchObject({
      kind: 'storey',
      level: { id: 'level_1' },
    })
    expect(roofLevelAbove(two, 'level_1')).toEqual({ kind: 'roof', level: null })
    const roofed = house({ id: 'level_g', content: 'walls' }, { id: 'level_r', content: 'roof' })
    expect(roofLevelAbove(roofed, 'level_g')).toMatchObject({
      kind: 'roof',
      level: { id: 'level_r' },
    })
  })
})

describe('isRoofOnStoreyWalls', () => {
  test("a lower wing's roof on the storey above, on the lower walls' tops, covers the lower storey", () => {
    // the upper floor stands 2.5 m up; the ground floor's walls top out 0.2 m over it
    const nodes = wingHouse([['roof_wing', 'level_1', 9, 0.2, 6]])
    expect(coveredStoreyId(nodes, nodes.roof_wing as RoofNode)).toBe('level_g')
    expect(roofsOver(nodes, 'level_g').map((roof) => roof.id)).toEqual(['roof_wing'])
    expect(roofsOver(nodes, 'level_1')).toEqual([])
    expect(isRoofOnStoreyWalls(nodes, 'roof_wing')).toBe(false)
  })

  test('a roof on the walls of the storey holding it stands on its walls', () => {
    const nodes = wingHouse([['roof_up', 'level_1', 3, 2.7, 6]])
    expect(coveredStoreyId(nodes, nodes.roof_up as RoofNode)).toBe('level_1')
    expect(isRoofOnStoreyWalls(nodes, 'roof_up')).toBe(true)
  })

  test("a porch roof on its beam, under the walls' tops, does not", () => {
    expect(
      isRoofOnStoreyWalls(wingHouse([['roof_porch', 'level_g', 9, 2.3, 6]]), 'roof_porch'),
    ).toBe(false)
  })

  test('a roof on the roof level, or with no segments, does not', () => {
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_r', content: 'roof' })
    expect(isRoofOnStoreyWalls(nodes, 'roof_level_r')).toBe(false)
    expect(isRoofOnStoreyWalls(house({ id: 'level_c', content: 'roof' }), 'roof_level_c')).toBe(
      false,
    )
  })
})

// Projects built before the rule hold their roofs on the ground floor: the roof's panel and
// move_roofs_to_roof_level move them to the roof level, standing exactly where they stood.
/** An 8 × 6 m room of walls 2.7 m tall on 2.5 m storeys, its gable roof `support` on `on`. */
function roofedHouse(
  on: string,
  support: 'walls' | 'level',
  stack: { id: string; content: Content; metadata?: Record<string, unknown> }[] = [
    { id: 'level_g', content: 'walls' },
  ],
) {
  const nodes = house(...stack)
  const corners: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ]
  const ground = nodes.level_g as LevelNode
  const walls = corners.map((start, i) =>
    WallNode.parse({
      id: `wall_g${i}`,
      parentId: 'level_g',
      start,
      end: corners[(i + 1) % 4],
      height: 2.7,
    }),
  )
  const segment = RoofSegmentNode.parse({ id: 'rseg_main', width: 8, depth: 6, wallHeight: 0 })
  const roof = RoofNode.parse({
    id: 'roof_main',
    parentId: on,
    position: [4, 2.7, 3],
    support: { kind: support },
    children: [segment.id],
  })
  nodes.level_g = { ...ground, children: walls.map((wall) => wall.id) }
  for (const node of [...walls, roof, { ...segment, parentId: roof.id }]) nodes[node.id] = node
  const level = nodes[on] as LevelNode
  nodes[on] = { ...level, children: [...level.children, roof.id] }
  return nodes
}

const worldEave = (nodes: Record<string, AnyNode>, roofId: string) => {
  const roof = nodes[roofId] as RoofNode
  const base = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(roof.parentId!)?.baseY
  return (base ?? 0) + roof.position[1]
}

/** Where a roof stands in the world: a roof following walls at the height its follow gives it. */
const standing = (nodes: Record<string, AnyNode>, roofId: string) =>
  worldEave(nodes, roofId) -
  (nodes[roofId] as RoofNode).position[1] +
  resolveRoofElevation(nodes[roofId] as RoofNode, nodes)

describe('planRoofsOffStorey', () => {
  test('a bungalow roof on its walls’ level goes up to a new roof level, the eave where it was', () => {
    const nodes = roofedHouse('level_g', 'walls')
    const move = planRoofsOffStorey(nodes, 'level_g')
    expect(move?.plan.kind).toBe('roof')
    if (move?.plan.kind !== 'roof') return
    expect(move.plan.create).toMatchObject({ name: 'Roof', level: 1 })
    const moved = applySceneChanges(nodes, move.changes)
    const roof = moved.roof_main as RoofNode
    expect(roof.parentId).toBe(move.plan.levelId)
    expect((moved[move.plan.levelId] as LevelNode).children).toEqual(['roof_main'])
    expect((moved.level_g as LevelNode).children).not.toContain('roof_main')
    expect(worldEave(moved, 'roof_main')).toBeCloseTo(2.7, 6)
    // still following the walls, and they seat it where it stands
    expect(roof.support.kind).toBe('walls')
    expect(resolveRoofElevation(roof, moved)).toBeCloseTo(roof.position[1], 6)
    // the new level is as tall as the roof rises over its floor: the 0.2 m the walls stand above
    // the storey, then the roof's own rise, as create_roof sizes one
    const rise = getActiveRoofHeight(moved.rseg_main as RoofSegmentNode)
    expect((moved[move.plan.levelId] as LevelNode).height).toBeCloseTo(0.2 + rise, 6)
    expect(move.plan.create).toMatchObject({
      height: (moved[move.plan.levelId] as LevelNode).height,
    })
  })

  test('a roof at a height of its own keeps it, measured from the roof level', () => {
    const nodes = roofedHouse('level_g', 'level')
    const move = planRoofsOffStorey(nodes, 'level_g')!
    const moved = applySceneChanges(nodes, move.changes)
    expect((moved.roof_main as RoofNode).support.kind).toBe('level')
    expect(worldEave(moved, 'roof_main')).toBeCloseTo(2.7, 6)
  })

  test('the roof level already there takes it', () => {
    const nodes = roofedHouse('level_g', 'walls', [
      { id: 'level_g', content: 'walls' },
      { id: 'level_r', content: 'roof', metadata: { role: 'roof' } },
    ])
    const move = planRoofsOffStorey(nodes, 'level_g')!
    expect(move.plan).toMatchObject({ kind: 'roof', levelId: 'level_r', create: null })
    expect(move.changes.create).toEqual([])
  })

  test('under an upper storey, onto it, standing where it stood', () => {
    const nodes = roofedHouse('level_g', 'walls', [
      { id: 'level_g', content: 'walls' },
      { id: 'level_1', content: 'walls' },
    ])
    const move = planRoofsOffStorey(nodes, 'level_g')!
    expect(move.plan).toMatchObject({ kind: 'storey', levelId: 'level_1' })
    const moved = applySceneChanges(nodes, move.changes)
    expect(moved.roof_main?.parentId).toBe('level_1')
    expect(worldEave(moved, 'roof_main')).toBeCloseTo(2.7, 6)
    expect(resolveRoofElevation(moved.roof_main as RoofNode, moved)).toBeCloseTo(
      (moved.roof_main as RoofNode).position[1],
      6,
    )
  })

  test("a second move leaves the wing roof the first put on the storey above: it is the lower storey's", () => {
    const nodes = wingHouse([
      ['roof_wing', 'level_g', 9, 2.7, 6],
      ['roof_up', 'level_1', 3, 2.7, 6],
    ])
    const first = planRoofsOffStorey(nodes, 'level_g')!
    expect(first.plan).toMatchObject({ kind: 'storey', levelId: 'level_1' })
    const once = applySceneChanges(nodes, first.changes)
    expect(once.roof_wing?.parentId).toBe('level_1')
    expect(coveredStoreyId(once, once.roof_wing as RoofNode)).toBe('level_g')
    const second = planRoofsOffStorey(once, 'level_1')!
    expect(second.plan.kind).toBe('roof')
    expect(second.changes.update.map(({ id }) => id)).not.toContain('roof_wing')
    const twice = applySceneChanges(once, second.changes)
    expect(twice.roof_wing?.parentId).toBe('level_1')
    expect(twice.roof_up?.parentId).toBe(second.plan.levelId)
    expect(roofsOver(twice, 'level_g').map((roof) => roof.id)).toEqual(['roof_wing'])
    expect(roofsOver(twice, 'level_1').map((roof) => roof.id)).toEqual(['roof_up'])
  })

  test("a porch roof on its beam, under the walls' tops, is not moved", () => {
    expect(
      planRoofsOffStorey(wingHouse([['roof_porch', 'level_g', 9, 2.3, 6]]), 'level_g'),
    ).toBeNull()
  })

  test('nothing to move on a storey without roofs, or on the roof level', () => {
    expect(planRoofsOffStorey(house({ id: 'level_g', content: 'walls' }), 'level_g')).toBeNull()
    const nodes = house({ id: 'level_g', content: 'walls' }, { id: 'level_r', content: 'roof' })
    expect(planRoofsOffStorey(nodes, 'level_r')).toBeNull()
  })
})

describe('roofsKeptOverStorey', () => {
  const resized = (nodes: Record<string, AnyNode>, levelId: string, height: number) => ({
    ...nodes,
    [levelId]: { ...(nodes[levelId] as LevelNode), height },
  })
  const kept = (before: Record<string, AnyNode>, after: Record<string, AnyNode>) =>
    applySceneChanges(after, { update: roofsKeptOverStorey(before, after) })
  /** The bungalow's roof, at a height of its own, moved off its storey under `above`. */
  function movedUnder(
    above: { id: string; content: Content; metadata?: Record<string, unknown> }[],
  ) {
    const nodes = roofedHouse('level_g', 'level', [{ id: 'level_g', content: 'walls' }, ...above])
    return applySceneChanges(nodes, planRoofsOffStorey(nodes, 'level_g')!.changes)
  }

  test('a moved roof stays on its walls as the storey under its roof level grows', () => {
    const moved = movedUnder([{ id: 'level_r', content: 'empty', metadata: { role: 'roof' } }])
    expect(worldEave(kept(moved, resized(moved, 'level_g', 3)), 'roof_main')).toBeCloseTo(2.7, 6)
  })

  test('with a support level between, it stays on the walls of the storey it covers', () => {
    const moved = movedUnder([{ id: 'level_s', content: 'empty', metadata: { role: 'support' } }])
    expect(worldEave(moved, 'roof_main')).toBeCloseTo(2.7, 6)
    expect(worldEave(kept(moved, resized(moved, 'level_g', 3)), 'roof_main')).toBeCloseTo(2.7, 6)
    expect(worldEave(kept(moved, resized(moved, 'level_s', 3)), 'roof_main')).toBeCloseTo(2.7, 6)
  })

  test('with a level still to be built between, it stays on the walls as either grows', () => {
    const moved = movedUnder([
      { id: 'level_1', content: 'empty' },
      { id: 'level_r', content: 'empty', metadata: { role: 'roof' } },
    ])
    expect(moved.roof_main?.parentId).toBe('level_r')
    expect(worldEave(kept(moved, resized(moved, 'level_g', 3)), 'roof_main')).toBeCloseTo(2.7, 6)
    expect(worldEave(kept(moved, resized(moved, 'level_1', 3)), 'roof_main')).toBeCloseTo(2.7, 6)
  })

  test('a roof that followed walls, moved over a level between, keeps its height and its walls', () => {
    for (const between of [
      [{ id: 'level_s', content: 'empty' as const, metadata: { role: 'support' } }],
      [
        { id: 'level_1', content: 'empty' as const },
        { id: 'level_r', content: 'empty' as const, metadata: { role: 'roof' } },
      ],
    ]) {
      const nodes = roofedHouse('level_g', 'walls', [
        { id: 'level_g', content: 'walls' },
        ...between,
      ])
      const moved = applySceneChanges(nodes, planRoofsOffStorey(nodes, 'level_g')!.changes)
      // the follow reads only the roof level's walls and those directly under it: not the storey's
      expect((moved.roof_main as RoofNode).support.kind).toBe('level')
      expect(worldEave(moved, 'roof_main')).toBeCloseTo(2.7, 6)
      expect(worldEave(kept(moved, resized(moved, 'level_g', 3)), 'roof_main')).toBeCloseTo(2.7, 6)
    }
  })

  test('a storey put in under the roof level lifts the roof with it, and it stays on top of it', () => {
    const moved = movedUnder([{ id: 'level_r', content: 'empty', metadata: { role: 'roof' } }])
    const building = moved.building_h as BuildingNode
    // "+ level": the new storey takes the roof level's place and the roof level moves up one
    const added: Record<string, AnyNode> = {
      ...moved,
      building_h: { ...building, children: [...building.children, 'level_1'] },
      level_r: { ...(moved.level_r as LevelNode), level: 2 },
      level_1: LevelNode.parse({ id: 'level_1', parentId: 'building_h', level: 1, height: 2.5 }),
    }
    expect(roofsKeptOverStorey(moved, added)).toEqual([])
    expect(worldEave(added, 'roof_main')).toBeCloseTo(5.2, 6)
    expect(roofsKeptOverStorey(added, resized(added, 'level_1', 3))).toEqual([])
  })
})

// The bearing test: a roof stands on its storey's walls when walls run along a segment's edges with
// open air past them and it sits at the eave they need, or follows them. A porch or a portico bears
// on beams and posts, a lower wing's roof on the walls below. The repair moves exactly the roofs
// on their walls, and verify_scene reports exactly those.

/** A garage beside the house, its walls 0.3 m lower; an auto roof's masses over both. */
const withGarage = () =>
  bungalow(
    ...room('level_g', 'k', [10, 0, 16, 6], 2.4),
    ...roof(
      'roof_auto',
      'level_g',
      { position: [0, TOP, 0] },
      { id: 'rseg_house', roofType: 'hip', position: [5, 0, 4], width: 10, depth: 8 },
      { id: 'rseg_garage', roofType: 'hip', position: [13, -0.3, 3], width: 6, depth: 6 },
    ),
  )

/** An L-shaped room, its front wall one run of 12 m, under a cross gable of two masses. */
function crossGable() {
  const corners: [number, number][] = [
    [0, 0],
    [12, 0],
    [12, 4],
    [6, 4],
    [6, 8],
    [0, 8],
  ]
  return scene(
    building(),
    level('level_g', 0),
    ...corners.map((start, i) =>
      WallNode.parse({
        id: `wall_l${i}`,
        parentId: 'level_g',
        start,
        end: corners[(i + 1) % corners.length],
        height: 2.7,
      }),
    ),
    ZoneNode.parse({ id: 'zone_l', parentId: 'level_g', name: 'Room', polygon: corners }),
    SlabNode.parse({ id: 'slab_l', parentId: 'level_g', polygon: corners, elevation: 0.05 }),
    ...roof(
      'roof_cross',
      'level_g',
      { position: [0, TOP, 0] },
      { id: 'rseg_a', position: [3, 0, 4], width: 6, depth: 8 },
      { id: 'rseg_b', position: [9, 0, 2], width: 6, depth: 4 },
    ),
  )
}

/** A round tower's curved wall bulging to -z (`bulge` 2) or +z (-2), under a half cone over -z. */
const coneOver = (bulge: number) =>
  scene(
    building(),
    level('level_g', 0),
    WallNode.parse({
      id: 'wall_round',
      parentId: 'level_g',
      start: [3, 4],
      end: [7, 4],
      curveOffset: bulge,
      height: 2.7,
    }),
    ...roof(
      'roof_cone',
      'level_g',
      { position: [5, 2.7, 4] },
      {
        id: 'rseg_cone',
        roofType: 'conical',
        width: 4,
        depth: 4,
        conicalStartAngle: 0,
        conicalSweepAngle: -Math.PI,
      },
    ),
  )

/** Two storeys: a 16 m ground floor and a 10 m first floor over its west part. */
const wingStoreys = (...extra: AnyNode[]) =>
  scene(
    building(),
    level('level_g', 0),
    level('level_1', 1),
    ...room('level_g', 'g', [0, 0, 16, 8]),
    ...room('level_1', 'u', [0, 0, 10, 8]),
    ...extra,
  )

const ON_STOREY_WALLS: [string, () => Record<string, AnyNode>, string, boolean][] = [
  [
    'its container at the wall tops, the segment at 0, over the house’s walls',
    () => bungalow(...mainRoof()),
    'roof_main',
    true,
  ],
  [
    'its container at 0, the segment at the wall tops',
    () =>
      bungalow(
        ...roof(
          'roof_main',
          'level_g',
          { position: [5, 0, 4] },
          { id: 'rseg_main', position: [0, TOP, 0], width: 10, depth: 8 },
        ),
      ),
    'roof_main',
    true,
  ],
  [
    'its own walls rising from the floor to the eave',
    () =>
      bungalow(
        ...roof(
          'roof_main',
          'level_g',
          { position: [5, 0, 4] },
          { id: 'rseg_main', width: 10, depth: 8, wallHeight: TOP },
        ),
      ),
    'roof_main',
    true,
  ],
  [
    'on the floor, with no walls of its own',
    () => bungalow(...mainRoof('level_g', 0)),
    'roof_main',
    false,
  ],
  [
    'following the walls, stored at y 0',
    () => bungalow(...mainRoof('level_g', 0, 'walls')),
    'roof_main',
    true,
  ],
  [
    'a generated gable porch on an 8 ft house, its band on the plate and its box in the front wall',
    () => bungalow8ft(...gablePorch('level_g', [3.5, 6.5], 0.3)),
    'roof_porch',
    false,
  ],
  ['a shed porch on its ledger', () => bungalow(...shedPorch('level_g')), 'roof_porch', false],
  [
    'a full-width gable porch flush with the side walls, its box 0.35 m into the house',
    () => bungalow8ft(...gablePorch('level_g', [0, 10], 0.35)),
    'roof_porch',
    false,
  ],
  [
    'a portico from the front wall’s centre line, its eave at the plate',
    () => bungalow(...portico('level_g')),
    'roof_porch',
    false,
  ],
  [
    'an auto roof: the house mass on the house walls, the garage mass on its walls 0.3 m lower',
    withGarage,
    'roof_auto',
    true,
  ],
  [
    'a cross gable over an L-shaped room, the front wall running on past one mass',
    crossGable,
    'roof_cross',
    true,
  ],
  [
    'over an interior partition only, its eave at the partition’s top',
    () =>
      bungalow(
        WallNode.parse({
          id: 'wall_part',
          parentId: 'level_g',
          start: [5, 0],
          end: [5, 8],
          height: 2.7,
        }),
        ...roof(
          'roof_inner',
          'level_g',
          { position: [7, TOP, 4] },
          { id: 'rseg_inner', width: 4, depth: 4 },
        ),
      ),
    'roof_inner',
    false,
  ],
  ['a cone sector over its curved wall', () => coneOver(2), 'roof_cone', true],
  ['a cone sector whose curved wall is on the other side', () => coneOver(-2), 'roof_cone', false],
  [
    'on a declared roof level',
    () => bungalow(level('level_r', 1, { role: 'roof' }), ...mainRoof('level_r', TOP - 3)),
    'roof_main',
    false,
  ],
  [
    'on a level holding only roofs',
    () => bungalow(level('level_r', 1), ...mainRoof('level_r', TOP - 3)),
    'roof_main',
    false,
  ],
  [
    'a lower wing’s roof on the storey above, at its floor',
    () =>
      wingStoreys(
        ...roof(
          'roof_wing',
          'level_1',
          { position: [13, 0, 4] },
          {
            id: 'rseg_wing',
            width: 6,
            depth: 8,
          },
        ),
      ),
    'roof_wing',
    false,
  ],
  [
    'with no segments',
    () => bungalow(RoofNode.parse({ id: 'roof_bare', parentId: 'level_g', position: [5, TOP, 4] })),
    'roof_bare',
    false,
  ],
]

describe('a roof on the walls of the storey holding it', () => {
  for (const [name, build, roofId, onWalls] of ON_STOREY_WALLS)
    test(`${name}: ${onWalls ? 'on them, moved and reported' : 'not, left and unreported'}`, () => {
      const nodes = build()
      const holder = nodes[roofId]!.parentId!
      expect(isRoofOnStoreyWalls(nodes, roofId)).toBe(onWalls)
      const move = planRoofsOffStorey(nodes, holder)
      expect(move?.changes.update.some(({ id }) => id === roofId) ?? false).toBe(onWalls)
      const { issues } = verifyScene(nodes, undefined, { activeLevelId: null }).result as {
        issues: { type: string }[]
      }
      expect(issues.some((issue) => issue.type === 'roof_mixed_in_storey')).toBe(onWalls)
      if (!move) return
      // moved standing where it stood, in exactly one parent's children
      const moved = applySceneChanges(nodes, move.changes)
      expect(moved[roofId]!.parentId).toBe(move.plan.levelId)
      expect((moved[move.plan.levelId] as LevelNode).children).toContain(roofId)
      expect((moved[holder] as LevelNode).children).not.toContain(roofId)
      expect(standing(moved, roofId)).toBeCloseTo(standing(nodes, roofId), 6)
    })
})

// The seat: each writer passes its own changes through seatRoofs before its one store call, so a
// roof it puts on its walls' storey lands on the level above, and remote clients and undo see the
// write as made.

type CreateEntry = { node: AnyNode; parentId?: string; collectionIds?: string[] }
const created = (...nodes: AnyNode[]): CreateEntry[] =>
  nodes.map((node) => ({ node, parentId: node.parentId ?? undefined }))
type Changes = {
  create?: CreateEntry[]
  update?: { id: string; data: Partial<AnyNode> }[]
  delete?: string[]
}

/** The store's two orders: updates before creates (applyNodeChanges), and creates in order then updates. */
function landed(nodes: Record<string, AnyNode>, changes: Changes) {
  const create = (changes.create ?? []).map(({ node, parentId }) => {
    const parsed = parseNode(node)
    return { node: parsed.success ? parsed.data : node, parentId }
  })
  return [
    applySceneChanges(nodes, { ...changes, create }),
    applySceneWrites(nodes, [
      ...create.map((entry) => ({ op: 'create' as const, ...entry })),
      ...(changes.update ?? []).map(({ id, data }) => ({ op: 'update' as const, id, data })),
      ...(changes.delete ?? []).map((id) => ({ op: 'delete' as const, id })),
    ]),
  ]
}

const roofLevelOf = (nodes: Record<string, AnyNode>, roofId: string) => {
  const holder = nodes[nodes[roofId]!.parentId!] as LevelNode
  return { holder, serves: isRoofLevel(holder) }
}

describe('seatRoofs', () => {
  test('a roof made on the top storey’s walls goes onto a new Roof level, standing where it was made', () => {
    const nodes = bungalow()
    const { changes, notes } = seatRoofs(nodes, { create: created(...mainRoof()) })
    const made = changes.create[0]!.node as LevelNode
    expect(made).toMatchObject({
      type: 'level',
      name: 'Roof',
      level: 1,
      metadata: { role: 'roof' },
    })
    expect(made.children).toEqual(['roof_main'])
    expect(changes.create.find(({ node }) => node.id === 'roof_main')?.parentId).toBe(made.id)
    for (const after of landed(nodes, changes)) {
      expect(after.roof_main!.parentId).toBe(made.id)
      expect((after[made.id] as LevelNode).children).toEqual(['roof_main'])
      expect((after.level_g as LevelNode).children).not.toContain('roof_main')
      expect((after.building_h as BuildingNode).children).toContain(made.id)
      expect(worldEave(after, 'roof_main')).toBeCloseTo(TOP, 6)
    }
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain(`(${made.id}, a new Roof level)`)
  })

  test('a whole house made in one write, its levels written without children, gets its Roof level after the building', () => {
    const { children: _children, ...storey } = level('level_g', 0)
    const house = [building(), storey as AnyNode, ...room('level_g', 'g'), ...mainRoof()]
    const { changes } = seatRoofs({}, { create: created(...house) })
    const made = changes.create[1]!.node as LevelNode
    expect(changes.create[0]!.node.id).toBe('building_h')
    expect(made).toMatchObject({
      type: 'level',
      parentId: 'building_h',
      metadata: { role: 'roof' },
    })
    for (const after of landed({}, changes)) {
      expect((after.building_h as BuildingNode).children.toSorted()).toEqual(
        ['level_g', made.id].toSorted(),
      )
      expect(after.roof_main!.parentId).toBe(made.id)
      expect((after.level_g as LevelNode).children).not.toContain('roof_main')
      expect(worldEave(after, 'roof_main')).toBeCloseTo(TOP, 6)
    }
  })

  test('with a storey above, onto that storey', () => {
    const nodes = wingStoreys()
    const wing = roof(
      'roof_wing',
      'level_g',
      { position: [13, TOP, 4] },
      {
        id: 'rseg_wing',
        width: 6,
        depth: 8,
      },
    )
    const { changes, notes } = seatRoofs(nodes, { create: created(...wing) })
    expect(changes.create).toHaveLength(2)
    for (const after of landed(nodes, changes)) {
      expect(after.roof_wing!.parentId).toBe('level_1')
      expect(worldEave(after, 'roof_wing')).toBeCloseTo(TOP, 6)
    }
    expect(notes).toEqual([
      "roof roof_wing stands on Ground floor's walls, so it is on Floor 1 (level_1) at y -0.25: a roof lives on the level above the walls that carry it.",
    ])
  })

  test('the declared roof level above takes it', () => {
    const nodes = bungalow(level('level_r', 1, { role: 'roof' }))
    const { changes } = seatRoofs(nodes, { create: created(...mainRoof()) })
    expect(changes.create.map(({ node }) => node.id)).toEqual(['roof_main', 'rseg_main'])
    for (const after of landed(nodes, changes)) expect(after.roof_main!.parentId).toBe('level_r')
  })

  test('the one empty level above is declared the roof level, and the note says so', () => {
    const nodes = bungalow(level('level_1', 1))
    const { changes, notes } = seatRoofs(nodes, { create: created(...mainRoof()) })
    for (const after of landed(nodes, changes)) {
      expect(after.roof_main!.parentId).toBe('level_1')
      expect(after.level_1).toMatchObject({ name: 'Roof', metadata: { role: 'roof' } })
    }
    expect(notes[0]).toContain('declared the roof level')
  })

  test('a banded porch cover stays on its storey, the write untouched', () => {
    const nodes = bungalow8ft()
    const write = { create: created(...gablePorch('level_g', [3.5, 6.5], 0.3)) }
    expect(seatRoofs(nodes, write)).toEqual({ changes: write, notes: [] })
  })

  test('a roof following the walls, written at y 0, lands on them from the roof level', () => {
    const nodes = bungalow()
    const write = { create: created(...mainRoof('level_g', 0, 'walls')) }
    // where its follow stands it on the storey's walls
    const onTops = standing(applySceneChanges(nodes, write), 'roof_main')
    expect(onTops).toBeGreaterThan(2.6)
    const { changes } = seatRoofs(nodes, write)
    for (const after of landed(nodes, changes)) {
      const placed = after.roof_main as RoofNode
      expect(roofLevelOf(after, 'roof_main').serves).toBe(true)
      expect(placed.support.kind).toBe('walls')
      expect(worldEave(after, 'roof_main')).toBeCloseTo(onTops, 6)
      expect(resolveRoofElevation(placed, after)).toBeCloseTo(placed.position[1], 6)
    }
  })

  test('roofs on two storeys in one write: the wing’s onto the storey above, the main one onto one Roof level', () => {
    const nodes = wingStoreys()
    const { changes } = seatRoofs(nodes, {
      create: created(
        ...roof(
          'roof_wing',
          'level_g',
          { position: [13, TOP, 4] },
          {
            id: 'rseg_wing',
            width: 6,
            depth: 8,
          },
        ),
        ...roof(
          'roof_up',
          'level_1',
          { position: [5, TOP, 4] },
          {
            id: 'rseg_up',
            width: 10,
            depth: 8,
          },
        ),
      ),
    })
    const levels = changes.create.filter(({ node }) => node.type === 'level')
    expect(levels).toHaveLength(1)
    for (const after of landed(nodes, changes)) {
      expect(after.roof_wing!.parentId).toBe('level_1')
      expect(after.roof_up!.parentId).toBe(levels[0]!.node.id)
    }
  })

  test('a roof moved off the roof level onto its walls’ storey goes back, its height kept', () => {
    const nodes = bungalow(level('level_r', 1, { role: 'roof' }), ...mainRoof('level_r', TOP - 3))
    const { changes, notes } = seatRoofs(nodes, {
      update: [{ id: 'roof_main', data: { parentId: 'level_g', position: [5, TOP, 4] } }],
    })
    expect(notes).toHaveLength(1)
    for (const after of landed(nodes, changes)) {
      expect(after.roof_main!.parentId).toBe('level_r')
      expect((after.level_g as LevelNode).children).not.toContain('roof_main')
      expect(worldEave(after, 'roof_main')).toBeCloseTo(TOP, 6)
    }
  })

  test('an edit of a legacy roof on its walls’ storey leaves it there: no write migrates one', () => {
    const nodes = bungalow(...mainRoof())
    const write = { update: [{ id: 'roof_main', data: { materialPreset: 'slate' } }] }
    expect(seatRoofs(nodes, write)).toEqual({ changes: write, notes: [] })
  })

  test('a roof on its storey turned onto its walls is seated', () => {
    const nodes = bungalow(
      ...roof(
        'roof_main',
        'level_g',
        { position: [5, TOP, 4], rotation: Math.PI / 2 },
        {
          id: 'rseg_main',
          width: 10,
          depth: 8,
        },
      ),
    )
    expect(isRoofOnStoreyWalls(nodes, 'roof_main')).toBe(false)
    const { changes } = seatRoofs(nodes, { update: [{ id: 'roof_main', data: { rotation: 0 } }] })
    for (const after of landed(nodes, changes))
      expect(roofLevelOf(after, 'roof_main').serves).toBe(true)
  })

  test('a created roof keeps every field of its entry and leaves the created storey listing it', () => {
    const nodes = scene(building())
    const [roofNode, segment] = mainRoof()
    const { changes } = seatRoofs(nodes, {
      create: [
        {
          node: { ...level('level_g', 0), children: ['roof_main'] } as AnyNode,
          parentId: 'building_h',
        },
        ...created(...room('level_g', 'g')),
        { node: roofNode!, parentId: 'level_g', collectionIds: ['collection_a'] },
        { node: segment!, parentId: 'roof_main' },
      ],
    })
    const made = changes.create.find(({ node }) => node.type === 'level' && node.id !== 'level_g')!
    expect(changes.create.find(({ node }) => node.id === 'roof_main')).toMatchObject({
      parentId: made.node.id,
      collectionIds: ['collection_a'],
    })
    expect(
      (changes.create.find(({ node }) => node.id === 'level_g')!.node as LevelNode).children,
    ).not.toContain('roof_main')
  })

  test('a write that deletes is seated on the scene its deletes leave', () => {
    // the storey above goes, its walls and rooms with it: the roof goes onto a Roof level instead
    const nodes = wingStoreys()
    const wing = roof(
      'roof_wing',
      'level_g',
      { position: [13, TOP, 4] },
      {
        id: 'rseg_wing',
        width: 6,
        depth: 8,
      },
    )
    const { changes } = seatRoofs(nodes, { create: created(...wing), delete: ['level_1'] })
    for (const after of landed(nodes, changes)) {
      expect(after.wall_u0).toBeUndefined()
      expect(roofLevelOf(after, 'roof_wing')).toMatchObject({ serves: true, holder: { level: 1 } })
    }
  })
})
