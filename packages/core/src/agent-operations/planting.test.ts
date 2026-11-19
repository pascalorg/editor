import { describe, expect, test } from 'bun:test'
import { AGENT_TOOL_CONTRACTS, BATCHABLE_TOOLS, isAgentRefusal } from '../agent-tools'
import {
  type AnyNode,
  BuildingNode,
  buildPlanting,
  FLAT_GROUND,
  LevelNode,
  type PlantingFacts,
  PlantingNode,
  resolvePlantingAccept,
  SiteNode,
  SlabNode,
  WallNode,
} from '../index'
import { AGENT_OPERATIONS, addPlanting, applySceneChanges, type SceneNodes } from './index'

const outline: [number, number][] = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
]
const site = SiteNode.parse({ id: 'site_garden' })
const context = { activeLevelId: null }
const call = (nodes: SceneNodes, input: Record<string, unknown>) =>
  addPlanting(nodes, input as never, context)
const codeOf = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return null
}
const created = (outcome: ReturnType<typeof call>) =>
  PlantingNode.parse(outcome.changes?.create?.[0]?.node)
const factsOf = (outcome: ReturnType<typeof call>) => outcome.result.facts as PlantingFacts

// Requirements: one semantic node; actual retained quantities, atomic edits, refusals before
// scatter/terrain work. Expected area and transform are analytical, not generator snapshots.
describe('add_planting', () => {
  test('is a shared operation and remains absent from the unchanged batch vocabulary', () => {
    expect(AGENT_OPERATIONS.add_planting).toBe(addPlanting)
    expect(AGENT_TOOL_CONTRACTS.filter((c) => c.name === 'add_planting')).toHaveLength(1)
    expect((BATCHABLE_TOOLS as readonly string[]).includes('add_planting')).toBe(false)
    for (const contract of AGENT_TOOL_CONTRACTS)
      if (contract.name !== 'add_planting')
        expect(contract.description.includes('add_planting')).toBe(false)
  })
  test('creates exactly one compact Site child, and facts match the plants and buffers actually produced', () => {
    const nodes = { [site.id]: site }
    const before = JSON.stringify(nodes)
    const outcome = call(nodes, { outline, seed: 19 })
    const node = created(outcome),
      facts = factsOf(outcome)
    expect(JSON.stringify(nodes)).toBe(before)
    expect(outcome.changes?.create).toHaveLength(1)
    expect(outcome.changes?.update).toBeUndefined()
    expect(node).toMatchObject({ type: 'planting', parentId: site.id, outline, seed: 19 })
    expect(outcome.result.plantingId).toBe(node.id)
    expect(outcome.result.siteId).toBe(site.id)
    expect(facts.areaM2).toBeCloseTo(24, 7)
    expect(facts.plants).toBeGreaterThan(0)
    expect(Object.values(facts.byHabit).reduce((a, b) => a + b, 0)).toBe(facts.plants)
    expect(Object.values(facts.byLayer).reduce((a, b) => a + b, 0)).toBe(facts.plants)
    expect(facts.byLayer.back).toBeGreaterThan(0)
    expect(facts.byLayer.mid).toBeGreaterThan(0)
    expect(facts.byLayer.edge).toBeGreaterThan(0)
    expect(facts.cover).toBeGreaterThan(0)
    expect(facts.cover).toBeLessThanOrEqual(1)
    const built = buildPlanting(node, FLAT_GROUND)
    expect(facts.plants).toBe(built.plan.placements.length)
    expect(facts.triangles).toBe(built.meshes.reduce((sum, m) => sum + m.index.length / 3, 0))
    for (const [habit, count] of Object.entries(facts.byHabit))
      expect(count).toBe(
        built.plan.placements.filter((p) => node.plants[p.species]!.habit === habit).length,
      )
    for (const [layer, count] of Object.entries(facts.byLayer))
      expect(count).toBe(built.plan.placements.filter((p) => p.layer === layer).length)
    const after = applySceneChanges(nodes, outcome.changes!)
    expect(Object.values(after).filter((n) => n.type === 'planting')).toHaveLength(1)
  })
  test('an update preserves unspecified fields, stored generator and node identity', () => {
    const first = call({ [site.id]: site }, { outline, seed: 19, ground: 'soil', gen: 1 })
    const node = created(first),
      scene = applySceneChanges({ [site.id]: site }, first.changes!)
    const changed = call(scene, { plantingId: node.id, seed: 20 })
    expect(changed.changes?.create).toBeUndefined()
    expect(changed.changes?.update).toEqual([{ id: node.id, data: { seed: 20 } }])
    const after = applySceneChanges(scene, changed.changes!)
    expect(after[node.id]).toEqual({ ...node, seed: 20 })
    expect(factsOf(changed).gen).toBe(1)
  })
  test('area and explicit outline can replace one another without leaving both representations', () => {
    const first = call({ [site.id]: site }, { outline })
    const node = created(first),
      scene = applySceneChanges({ [site.id]: site }, first.changes!)
    const island = call(scene, { plantingId: node.id, area: 12, center: [4, 3] })
    const areaScene = applySceneChanges(scene, island.changes!)
    const islandNode = PlantingNode.parse(areaScene[node.id])
    expect(islandNode).toMatchObject({ area: 12, center: [4, 3] })
    expect(islandNode.outline).toBeUndefined()
    const drawn = call(areaScene, { plantingId: node.id, outline })
    const drawnNode = PlantingNode.parse(applySceneChanges(areaScene, drawn.changes!)[node.id])
    expect(drawnNode).toMatchObject({ outline })
    expect(drawnNode.area).toBeUndefined()
  })
  test('a building frame converts XZ before storing, without confusing its vertical offset', () => {
    const building = BuildingNode.parse({
      id: 'building_frame',
      parentId: site.id,
      position: [10, 5, -3],
      rotation: [0, Math.PI / 2, 0],
    })
    const node = created(
      call(
        { [site.id]: site, [building.id]: building },
        {
          buildingId: building.id,
          outline: [
            [0, 0],
            [4, 0],
            [4, 2],
            [0, 2],
          ],
        },
      ),
    )
    const expected = [
      [10, -3],
      [10, -7],
      [12, -7],
      [12, -3],
    ]
    node.outline!.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i]![0]!, 8)
      expect(p[1]).toBeCloseTo(expected[i]![1]!, 8)
    })
  })
  test('resizing an area bed with a building frame preserves an omitted stored Site-space center', () => {
    const building = BuildingNode.parse({
      id: 'building_resize',
      parentId: site.id,
      position: [10, 0, -3],
      rotation: [0, Math.PI / 2, 0],
    })
    const node = PlantingNode.parse({
      id: 'planting_resize',
      parentId: site.id,
      area: 12,
      center: [20, 8],
      seed: 19,
    })
    const nodes = {
      [site.id]: { ...site, children: [building.id, node.id] },
      [building.id]: building,
      [node.id]: node,
    }
    const resized = call(nodes, { plantingId: node.id, area: 18, buildingId: building.id })
    const after = PlantingNode.parse(applySceneChanges(nodes, resized.changes!)[node.id])
    expect(after).toMatchObject({ area: 18, center: [20, 8], seed: 19 })
    expect(node).toMatchObject({ area: 12, center: [20, 8] })
    // Supplying a center is different: it is intentionally interpreted in the given frame.
    const moved = call(nodes, {
      plantingId: node.id,
      area: 18,
      center: [2, 1],
      buildingId: building.id,
    })
    const explicit = PlantingNode.parse(applySceneChanges(nodes, moved.changes!)[node.id])
    expect(explicit.center[0]).toBeCloseTo(11, 8)
    expect(explicit.center[1]).toBeCloseTo(-5, 8)
  })
  test.each([
    [{}, 'planting_outline_required'],
    [{ outline, area: 24 }, 'planting_outline_required'],
    [
      {
        outline: [
          [0, 0],
          [4, 4],
          [0, 4],
          [4, 0],
        ],
      },
      'planting_invalid_outline',
    ],
    [
      {
        outline: [
          [0, 0],
          [10, 0],
          [10, 0.01],
          [0, 0.01],
        ],
      },
      'planting_invalid_outline',
    ],
    [
      {
        outline: [
          [0, 0],
          [201, 0],
          [201, 1],
          [0, 1],
        ],
      },
      'planting_invalid_outline',
    ],
    [{ area: 2500, plants: [{ spacing: 0.12 }] }, 'planting_budget_exceeded'],
    [{ area: 12, plants: [] }, 'invalid_input'],
    [{ area: 12, plants: [{ habit: 'tree' }] }, 'invalid_input'],
    [{ area: 12, style: 'cottage' }, 'invalid_input'],
    [{ area: 0 }, 'invalid_input'],
    [{ plantingId: 'planting_missing', seed: 2 }, 'planting_not_found'],
  ] as [Record<string, unknown>, string][])(
    'refuses %j as %s without touching ground or mutating nodes',
    (input, code) => {
      let groundReads = 0
      const guarded = {
        ...site,
        get terrain() {
          groundReads++
          throw new Error('Ground must not be read on this refusal')
        },
      }
      const nodes = { [site.id]: guarded }
      expect(codeOf(() => call(nodes, input))).toBe(code)
      expect(groundReads).toBe(0)
      expect(Object.keys(nodes)).toEqual([site.id])
    },
  )
  test('refuses missing, ambiguous and mismatched sites and unsupported tilted frames', () => {
    expect(codeOf(() => call({}, { outline }))).toBe('no_site')
    const other = SiteNode.parse({ id: 'site_other' })
    expect(codeOf(() => call({ [site.id]: site, [other.id]: other }, { outline }))).toBe(
      'ambiguous_site',
    )
    expect(
      codeOf(() => call({ [site.id]: site }, { outline, buildingId: 'building_missing' })),
    ).toBe('building_not_found')
    const wrong = BuildingNode.parse({ id: 'building_wrong', parentId: other.id })
    expect(
      codeOf(() =>
        call(
          { [site.id]: site, [wrong.id]: wrong },
          { outline, siteId: site.id, buildingId: wrong.id },
        ),
      ),
    ).toBe('building_site_mismatch')
    const tilted = BuildingNode.parse({
      id: 'building_tilted',
      parentId: site.id,
      rotation: [0.1, 0, 0],
    })
    expect(
      codeOf(() =>
        call({ [site.id]: site, [tilted.id]: tilted }, { outline, buildingId: tilted.id }),
      ),
    ).toBe('planting_transform_unsupported')
  })
  test('a paved-over bed is refused instead of reporting plants that were never retained', () => {
    const paving = SlabNode.parse({
      id: 'slab_paving',
      parentId: site.id,
      polygon: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
      metadata: { flatwork: 'walk' },
    })
    const nodes = { [site.id]: site, [paving.id]: paving }
    const before = JSON.stringify(nodes)
    expect(codeOf(() => call(nodes, { outline }))).toBe('planting_empty')
    expect(JSON.stringify(nodes)).toBe(before)
  })
})

// Analytical clearance probes separate the scene adapter from scatter randomness.
describe('planting scene clearance', () => {
  const node = PlantingNode.parse({ area: 24, parentId: site.id })
  const building = BuildingNode.parse({
    id: 'building_house',
    parentId: site.id,
    children: ['level_ground', 'level_basement', 'level_upper'],
  })
  const ground = LevelNode.parse({ id: 'level_ground', parentId: building.id, level: 0, height: 3 })
  // Ordinal -1 orders the storey; the offset actually puts its plane below grade.
  const basement = LevelNode.parse({
    id: 'level_basement',
    parentId: building.id,
    level: -1,
    height: 3,
    baseElevation: -3,
  })
  const upper = LevelNode.parse({ id: 'level_upper', parentId: building.id, level: 1, height: 3 })
  const scene = (...extra: AnyNode[]) => {
    const nodes = [site, building, ground, basement, upper, ...extra]
    return Object.fromEntries(
      nodes.map((n) => [
        n.id,
        'children' in n
          ? {
              ...n,
              children: nodes.filter((child) => child.parentId === n.id).map((child) => child.id),
            }
          : n,
      ]),
    ) as Record<string, AnyNode>
  }
  test('paving excludes its whole crown disk, lawns do not, and another Site does not leak into it', () => {
    const path = SlabNode.parse({
      id: 'slab_path',
      parentId: site.id,
      polygon: [
        [0, -4],
        [0.1, -4],
        [0.1, 4],
        [0, 4],
      ],
      metadata: { flatwork: 'walk' },
    })
    const accept = resolvePlantingAccept(node, scene(path), FLAT_GROUND)
    expect(accept(-0.1, 0, 0.3)).toBe(false)
    expect(accept(-1, 0, 0.3)).toBe(true)
    expect(
      resolvePlantingAccept(node, scene({ ...path, metadata: { flatwork: 'lawn' } }), FLAT_GROUND)(
        0.05,
        0,
        0.3,
      ),
    ).toBe(true)
    expect(
      resolvePlantingAccept(node, scene({ ...path, parentId: 'site_other' }), FLAT_GROUND)(
        0.05,
        0,
        0.3,
      ),
    ).toBe(true)
  })
  test('the ground-storey floor excludes plants, not a differently shaped basement or upper flat paving', () => {
    const floor = SlabNode.parse({
      id: 'slab_ground',
      parentId: ground.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const cellar = SlabNode.parse({
      id: 'slab_basement',
      parentId: basement.id,
      polygon: [
        [-6, 0],
        [-2, 0],
        [-2, 4],
        [-6, 4],
      ],
    })
    const terrace = SlabNode.parse({
      id: 'slab_upper',
      parentId: upper.id,
      polygon: [
        [6, 0],
        [10, 0],
        [10, 4],
        [6, 4],
      ],
      metadata: { flatwork: 'walk' },
    })
    const accept = resolvePlantingAccept(node, scene(floor, cellar, terrace), FLAT_GROUND)
    expect(accept(2, 2, 0.3)).toBe(false)
    expect(accept(-4, 2, 0.3)).toBe(true)
    expect(accept(8, 2, 0.3)).toBe(true)
  })
  test('an authored courtyard remains plantable despite surrounding walls, but its edges have clearance', () => {
    const polygon: [number, number][] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ]
    const floor = SlabNode.parse({
      id: 'slab_courtyard',
      parentId: ground.id,
      polygon,
      holes: [
        [
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
        ],
      ],
    })
    const walls = polygon.map((start, i) =>
      WallNode.parse({ id: `wall_${i}`, parentId: ground.id, start, end: polygon[(i + 1) % 4] }),
    )
    const accept = resolvePlantingAccept(node, scene(floor, ...walls), FLAT_GROUND)
    expect(accept(0, 0, 0.4)).toBe(true)
    expect(accept(1.9, 0, 0.4)).toBe(false)
    expect(accept(3, 0, 0.4)).toBe(false)
  })
  test('a slab in one enclosed shell never makes a second wall-only shell plantable', () => {
    const courtyardShell: [number, number][] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ]
    const bareShell: [number, number][] = [
      [10, -2],
      [14, -2],
      [14, 2],
      [10, 2],
    ]
    const walls = [courtyardShell, bareShell].flatMap((ring, shell) =>
      ring.map((start, i) =>
        WallNode.parse({
          id: `wall_shell${shell}_${i}`,
          parentId: ground.id,
          start,
          end: ring[(i + 1) % ring.length],
        }),
      ),
    )
    const floor = SlabNode.parse({
      id: 'slab_one_shell',
      parentId: ground.id,
      polygon: courtyardShell,
      holes: [
        [
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
        ],
      ],
    })
    const accept = resolvePlantingAccept(node, scene(floor, ...walls), FLAT_GROUND)
    expect(accept(12, 0, 0.4)).toBe(false) // Enclosed wall-only interior.
    expect(accept(3, 0, 0.4)).toBe(false) // Solid part of the first floor.
    expect(accept(0, 0, 0.4)).toBe(true) // Its explicitly authored courtyard.
    expect(accept(1.9, 0, 0.4)).toBe(false) // Crown cannot cross the courtyard edge.
    expect(accept(7.5, 0, 0.4)).toBe(true) // Open ground between independent shells.
    // An unrelated floor elsewhere on the level must not open either shell.
    const outsideFloor = SlabNode.parse({
      id: 'slab_outside_shells',
      parentId: ground.id,
      polygon: [
        [20, -2],
        [24, -2],
        [24, 2],
        [20, 2],
      ],
    })
    const separate = resolvePlantingAccept(node, scene(outsideFloor, ...walls), FLAT_GROUND)
    expect(separate(0, 0, 0.4)).toBe(false)
    expect(separate(12, 0, 0.4)).toBe(false)
    expect(separate(22, 0, 0.4)).toBe(false)
    expect(separate(7.5, 0, 0.4)).toBe(true)
  })
})
