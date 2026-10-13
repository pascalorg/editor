import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, LevelNode, RoofNode, WallNode, ZoneNode } from '../schema'
import { isRoofLevel, planRoofLevel, roofsOver, storeyInsertIndex } from './roof-level'

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

describe('planRoofLevel', () => {
  test('over a bungalow, a new level named Roof on top, declared for the roof', () => {
    const plan = planRoofLevel(house({ id: 'level_g', content: 'walls' }), 'level_g', 3)
    expect(plan.kind).toBe('roof')
    if (plan.kind !== 'roof') return
    expect(plan.create).toMatchObject({ name: 'Roof', level: 1, height: 3, parentId: 'building_h' })
    expect(isRoofLevel(plan.create!)).toBe(true)
    expect(plan.levelId).toBe(plan.create!.id)
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
    expect(planRoofLevel(nodes, 'level_g', 2)).toEqual({ kind: 'storey', levelId: 'level_1' })
  })

  test('the declared roof level above is reused as it is', () => {
    const nodes = house(
      { id: 'level_g', content: 'walls' },
      { id: 'level_r', content: 'roof', metadata: { role: 'roof' } },
    )
    expect(planRoofLevel(nodes, 'level_g', 2)).toEqual({
      kind: 'roof',
      levelId: 'level_r',
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
    expect(planRoofLevel(nodes, 'level_g', 2)).toEqual({ kind: 'storey', levelId: 'level_e' })
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
