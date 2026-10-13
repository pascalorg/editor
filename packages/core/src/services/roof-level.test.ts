import { describe, expect, test } from 'bun:test'
import { applySceneChanges } from '../agent-operations/apply-changes'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  getActiveRoofHeight,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { resolveRoofElevation } from '../systems/roof/roof-elevation'
import {
  coveredStoreyId,
  isRoofLevel,
  planRoofLevel,
  roofLevelAbove,
  roofsOver,
  storeyInsertIndex,
} from './roof-level'
import { isRoofOnStoreyWalls, planRoofsOffStorey, roofsKeptOverStorey } from './roof-move'
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

  test('a building with no level starts at the ground floor', () => {
    expect(storeyInsertIndex(house(), 'building_h')).toEqual({ floorIndex: 0, shift: [] })
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
