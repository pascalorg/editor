import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { encodeTerrainField } from '../lib/terrain-codec'
import { createTerrainField } from '../lib/terrain-field'
import { BuildingNode, LevelNode, RockNode, SiteNode, SlabNode, WallNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { AGENT_OPERATIONS } from './index'
import { addRock } from './rock'
import type { AgentContext, SceneNodes } from './types'

const context: AgentContext = { activeLevelId: null }
const lot = [
  [-20, -20],
  [20, -20],
  [20, 20],
  [-20, 20],
] as [number, number][]

/** A house on a Site: one floor slab, a wall along the floor's edge, and a curtain wall. */
function house(buildingPlacement: Partial<BuildingNode> = {}) {
  const site = SiteNode.parse({ polygon: { type: 'polygon', points: lot } })
  const building = BuildingNode.parse({ parentId: site.id, ...buildingPlacement })
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const slab = SlabNode.parse({
    parentId: level.id,
    polygon: [
      [-6, -6],
      [10, -6],
      [10, 8],
      [-6, 8],
    ],
    elevation: 0.1,
  })
  const wall = WallNode.parse({ parentId: level.id, start: [-6, 1], end: [10, 1], height: 2.8 })
  const glass = WallNode.parse({
    parentId: level.id,
    start: [-6, 1.8],
    end: [10, 1.8],
    height: 2.8,
    wallType: 'curtain',
  })
  const nodes: SceneNodes = {
    [site.id]: { ...site, children: [building.id] },
    [building.id]: { ...building, children: [level.id] },
    [level.id]: { ...level, children: [slab.id, wall.id, glass.id] },
    [slab.id]: slab,
    [wall.id]: wall,
    [glass.id]: glass,
  }
  return { nodes, site, building, level, slab, wall, glass }
}

const outline = [
  [0, -2],
  [4, -2],
  [4, 3],
  [0, 3],
]
const call = (nodes: SceneNodes, input: Record<string, unknown>) =>
  addRock(nodes, input as never, context) as {
    result: { rockId: string; siteId: string; facts: Record<string, any> }
    changes?: { create?: { node: RockNode }[]; update?: { id: string; data: Partial<RockNode> }[] }
  }

function refusalOf(call: () => unknown): string | null {
  try {
    call()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return null
}

describe('add_rock', () => {
  test('adds a rock to the only Site, with the outline and defaults it was given', () => {
    const { nodes, site } = house()

    const { result, changes } = call(nodes, { outline, height: 3, seed: 5 })

    const [created] = changes?.create ?? []
    expect(created?.node).toMatchObject({ type: 'rock', parentId: site.id, height: 3, seed: 5 })
    expect(result.siteId).toBe(site.id)
    expect(result.rockId).toBe(created?.node.id)
  })

  test('says what it rises through: the slab and its hole, the walls and how much of each', () => {
    const { nodes, slab, wall, glass, level, building } = house()

    const { facts } = call(nodes, { outline, height: 3, seed: 5 }).result

    expect(facts.throughSlabs).toEqual([
      expect.objectContaining({ slabId: slab.id, levelId: level.id, buildingId: building.id }),
    ])
    expect(facts.throughSlabs[0].holeAreaM2).toBeGreaterThan(5)
    expect(facts.throughSlabs[0].holeAreaM2).toBeLessThan(20)
    const walls = Object.fromEntries(facts.meetsWalls.map((entry: any) => [entry.wallId, entry]))
    expect(walls[wall.id]).toMatchObject({ wallType: 'standard' })
    expect(walls[wall.id].insideLengthM).toBeGreaterThan(2)
    expect(walls[glass.id]).toMatchObject({ wallType: 'curtain' })
    expect(facts.footElevationM).toBeLessThan(0)
    expect(facts.topElevationM).toBe(2.95)
    expect(facts.footprintAreaM2).toBe(20)
  })

  test('reports an interior terrain peak as the highest ground under it', () => {
    const { nodes, site } = house()
    const field = createTerrainField({ origin: [-4, -4], cols: 9, rows: 9, spacing: 1 })
    field.heights[4 * 9 + 4] = Math.round(5 / field.step)
    const scene = {
      ...nodes,
      [site.id]: { ...site, children: site.children, terrain: encodeTerrainField(field) },
    }

    const { facts } = call(scene as never, {
      outline: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
      height: 6,
    }).result

    expect(facts.groundM).toEqual({ lowest: 0, highest: 5 })
  })

  test('a rock away from the house passes through nothing', () => {
    const { nodes } = house()
    const far = outline.map(([x, z]) => [(x ?? 0) + 15, z])

    const { facts } = call(nodes, { outline: far, height: 3 }).result

    expect(facts.throughSlabs).toEqual([])
    expect(facts.meetsWalls).toEqual([])
  })

  test('reads an outline in a building’s plan frame and stores it in the Site’s', () => {
    const { nodes, building } = house({ position: [10, 0, 5], rotation: [0, 0, 0] })

    const { changes } = call(nodes, { buildingId: building.id, outline, height: 2 })

    expect(changes?.create?.[0]?.node.polygon[0]).toEqual([10, 3])
  })

  test('changes only the fields given to an existing rock', () => {
    const { nodes, site } = house()
    const rock = RockNode.parse({
      parentId: site.id,
      polygon: outline,
      height: 2,
      seed: 9,
      strata: true,
    })
    const scene = { ...nodes, [rock.id]: rock as never }

    const { result, changes } = call(scene, { rockId: rock.id, height: 4 })

    expect(changes?.update).toEqual([{ id: rock.id, data: { height: 4 } }])
    expect(result.facts.heightM).toBe(4)
    expect(result.facts.topElevationM).toBe(3.95)
  })

  test('applying it leaves the slabs and walls exactly as they were', () => {
    const { nodes, slab, wall } = house()

    const { changes } = call(nodes, { outline, height: 3 })
    const after = applySceneChanges(nodes, changes ?? {})

    expect(after[slab.id]).toBe(nodes[slab.id])
    expect(after[wall.id]).toBe(nodes[wall.id])
  })

  test('refuses what cannot be a rock, with a code', () => {
    const { nodes } = house()
    const bowtie = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ]
    const sliver = [
      [0, 0],
      [4, 0],
      [4, 0.01],
    ]

    expect(refusalOf(() => call(nodes, { outline: bowtie }))).toBe('rock_outline_invalid')
    expect(refusalOf(() => call(nodes, { outline: sliver }))).toBe('rock_outline_invalid')
    expect(refusalOf(() => call(nodes, { height: 2 }))).toBe('outline_required')
    expect(refusalOf(() => call(nodes, { rockId: 'rock_missing', height: 2 }))).toBe(
      'rock_not_found',
    )
    expect(refusalOf(() => call({}, { outline }))).toBe('no_site')
  })
})

describe('which walls a rock meets', () => {
  const square = (half: number): [number, number][] => [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]

  /** A Site and a storey with the given walls (and a slab, to stand them on), no terrain. */
  function withWalls(walls: Parameters<typeof WallNode.parse>[0][], slabElevation = 0.1) {
    const site = SiteNode.parse({ polygon: { type: 'polygon', points: lot } })
    const building = BuildingNode.parse({ parentId: site.id })
    const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
      elevation: slabElevation,
    })
    const built = walls.map((wall) => WallNode.parse({ parentId: level.id, ...wall }))
    const nodes: SceneNodes = {
      [site.id]: { ...site, children: [building.id] },
      [building.id]: { ...building, children: [level.id] },
      [level.id]: { ...level, children: [slab.id, ...built.map((wall) => wall.id)] },
      [slab.id]: slab,
      ...Object.fromEntries(built.map((wall) => [wall.id, wall])),
    }
    return { nodes, slab, walls: built }
  }

  const metWalls = (nodes: SceneNodes, input: Record<string, unknown>) =>
    (call(nodes, input).result.facts.meetsWalls as { wallId: string; insideLengthM: number }[]).map(
      (entry) => entry.wallId,
    )

  test('a long wall that crosses a small rock is met, however far apart its samples are', () => {
    const { nodes, walls } = withWalls([{ start: [-15, 0], end: [15, 0], height: 3 }])

    const { facts } = call(nodes, { outline: square(0.5), height: 3, seed: 2 }).result

    expect(facts.meetsWalls).toEqual([expect.objectContaining({ wallId: walls[0]?.id })])
    expect(facts.meetsWalls[0].insideLengthM).toBeGreaterThan(0.5)
    expect(facts.meetsWalls[0].insideLengthM).toBeLessThanOrEqual(1)
  })

  test('a wall that touches the rock only near the ground, where it is widest, is met', () => {
    const { nodes, walls } = withWalls([{ start: [-5, 1.5], end: [5, 1.5], height: 3 }])

    const met = metWalls(nodes, { outline: square(2), height: 3, seed: 2 })

    expect(met).toEqual([walls[0]?.id])
  })

  test('a wall standing on a floor above the rock’s top is not met, though its own height is low', () => {
    const { nodes, slab, walls } = withWalls([{ start: [-5, 0], end: [5, 0], height: 1 }], 2)
    const [wall] = walls
    const raised = { ...nodes, [wall?.id ?? '']: { ...wall, supportSlabId: slab.id } } as SceneNodes

    const met = metWalls(raised, { outline: square(2), height: 1, seed: 2 })

    expect(met).toEqual([])
  })

  test('the same wall on the ground, under the same rock, is met', () => {
    const { nodes, walls } = withWalls([{ start: [-5, 0], end: [5, 0], height: 1 }], 0)

    expect(metWalls(nodes, { outline: square(2), height: 1, seed: 2 })).toEqual([walls[0]?.id])
  })
})

describe('a rock in a house, for verify_scene', () => {
  const issuesOf = (nodes: SceneNodes) =>
    (
      AGENT_OPERATIONS.verify_scene(nodes, {}, context).result as {
        issues: { type: string; message: string; severity?: string }[]
      }
    ).issues

  test('is stated as a fact, not a collision', () => {
    const { nodes, site } = house()
    const rock = RockNode.parse({
      parentId: site.id,
      polygon: outline,
      height: 3,
      seed: 5,
      name: 'Boulder',
    })
    const scene = { ...nodes, [rock.id]: rock as never }

    const issues = issuesOf(scene)

    const facts = issues.filter((issue) => issue.type === 'rock_through_building')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.severity).toBe('info')
    expect(facts[0]?.message).toContain('Boulder')
    expect(facts[0]?.message).toMatch(/rises through 1 floor/)
    expect(facts[0]?.message).toContain('not a collision')
    expect(issues.filter((issue) => /collid|overlap/i.test(issue.type))).toEqual([])
  })

  test('a rock clear of the building says nothing', () => {
    const { nodes, site } = house()
    const far = outline.map(([x, z]) => [(x ?? 0) + 15, z]) as [number, number][]
    const rock = RockNode.parse({ parentId: site.id, polygon: far, height: 3 })

    const issues = issuesOf({ ...nodes, [rock.id]: rock as never })

    expect(issues.filter((issue) => issue.type === 'rock_through_building')).toEqual([])
  })
})
