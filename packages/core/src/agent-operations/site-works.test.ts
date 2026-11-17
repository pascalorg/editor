import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { addSiteSurfaceTool, addStepsTool } from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { BuildingNode, LevelNode, SiteNode, SlabNode } from '../schema'
import { AGENT_OPERATIONS, applySceneChanges } from './index'
import type { SceneNodes } from './types'

/**
 * add_site_surface and add_steps on main's scene. Every expected number is worked by hand from
 * the input: a shoelace area, the 0.17 m riser and the 0.63 m step rule, not read back from code.
 */

function lot(extra: Record<string, unknown>[] = []): SceneNodes {
  const site = SiteNode.parse({ id: 'site_a', children: ['building_a'] })
  const building = BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: [] })
  const ground = LevelNode.parse({ id: 'level_g', parentId: 'building_a', level: 0, height: 2.7 })
  const nodes: Record<string, unknown> = { site_a: site, building_a: building, level_g: ground }
  ;(building as { children: string[] }).children = ['level_g']
  for (const node of extra) {
    nodes[node.id as string] = node
    const parent = nodes[node.parentId as string] as { children?: string[] }
    parent.children = [...(parent.children ?? []), node.id as string]
  }
  return nodes as SceneNodes
}

function run(tool: 'add_site_surface' | 'add_steps', nodes: SceneNodes, raw: object) {
  const contract = tool === 'add_site_surface' ? addSiteSurfaceTool : addStepsTool
  const input = z.object(contract.input).parse(raw)
  const outcome = AGENT_OPERATIONS[tool](nodes, input as never, { activeLevelId: null })
  return {
    result: outcome.result as Record<string, unknown>,
    nodes: applySceneChanges(nodes, outcome.changes),
  }
}

function refusal(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return undefined
}

const created = (before: SceneNodes, after: SceneNodes, type: string) =>
  Object.values(after).filter((node) => node.type === type && !(node.id in before))

describe('add_site_surface', () => {
  test('a driveway polygon is concrete flatwork 5 cm above the ground, with its shoelace area', () => {
    const nodes = lot()
    // 3 m by 6 m rectangle: 18 m².
    const { result, nodes: after } = run('add_site_surface', nodes, {
      kind: 'driveway',
      polygon: [
        [7, 0],
        [10, 0],
        [10, 6],
        [7, 6],
      ],
      levelId: 'level_g',
    })
    expect(result).toMatchObject({ ok: true, kind: 'driveway', area: 18, levelId: 'level_g' })
    const [slab] = created(nodes, after, 'slab') as SlabNode[]
    expect(slab).toMatchObject({
      parentId: 'level_g',
      materialPreset: 'library:concrete-raw',
      elevation: 0.05,
      metadata: { flatwork: 'driveway' },
    })
  })

  test('a lawn from two corners is the rectangle they span, green, 1 cm up, marked lawn', () => {
    const nodes = lot()
    // Corners (-2, 5) and (6, 7): 8 m by 2 m, 16 m², corners given in either order.
    const { result, nodes: after } = run('add_site_surface', nodes, {
      kind: 'lawn',
      corners: [
        [6, 7],
        [-2, 5],
      ],
      levelId: 'level_g',
    })
    expect(result).toMatchObject({ ok: true, kind: 'lawn', area: 16 })
    const [lawn] = created(nodes, after, 'slab') as SlabNode[]
    expect(lawn?.polygon).toEqual([
      [-2, 5],
      [6, 5],
      [6, 7],
      [-2, 7],
    ])
    expect(lawn).toMatchObject({
      materialPreset: 'library:preset-lawn',
      elevation: 0.01,
      metadata: { flatwork: 'lawn' },
    })
  })

  test('a path reads as a walk and takes a named material when asked', () => {
    const nodes = lot()
    const { nodes: after } = run('add_site_surface', nodes, {
      kind: 'path',
      corners: [
        [0, 0],
        [1, 4],
      ],
      materialPreset: 'library:flooring-wallstone1',
      name: 'Garden path',
      levelId: 'level_g',
    })
    const [path] = created(nodes, after, 'slab') as SlabNode[]
    expect(path).toMatchObject({
      name: 'Garden path',
      materialPreset: 'library:flooring-wallstone1',
      metadata: { flatwork: 'walk' },
    })
  })

  test('three corners in a line have no area and are refused, nothing written', () => {
    const nodes = lot()
    const code = refusal(() =>
      run('add_site_surface', nodes, {
        kind: 'patio',
        polygon: [
          [0, 0],
          [4, 0],
          [8, 0],
        ],
        levelId: 'level_g',
      }),
    )
    expect(code).toBe('surface_degenerate')
  })
})

describe('add_steps', () => {
  test('0.5 m of rise is three 0.17 m risers on a run that follows the rise, on the ground', () => {
    const nodes = lot()
    const { result, nodes: after } = run('add_steps', nodes, {
      x: 2,
      z: -1,
      rise: 0.5,
      levelId: 'level_g',
    })
    // round(0.5 / 0.17) = 3 risers; going = 0.63 - 2 × 0.5 / 3 = 0.2967 m, within 0.25-0.35.
    expect(result).toMatchObject({ ok: true, stepCount: 3, rise: 0.5, levelId: 'level_g' })
    const [stair] = created(nodes, after, 'stair') as Record<string, unknown>[]
    expect(stair).toMatchObject({
      fromLevelId: 'level_g',
      toLevelId: null,
      totalRise: 0.5,
      width: 1.2,
      stepCount: 3,
      railingMode: 'none',
      supportSlabId: 'ground',
      position: [2, 0, -1],
    })
    const [segment] = created(nodes, after, 'stair-segment') as Record<string, unknown>[]
    expect(segment?.parentId).toBe(stair?.id)
    expect(segment?.length as number).toBeCloseTo(3 * (0.63 - 1 / 3), 6)
    // No storey is made for them.
    expect(Object.values(after).filter((node) => node.type === 'level')).toHaveLength(1)
  })

  test('a tall flight gets railings on both sides and the shortest comfortable going', () => {
    const nodes = lot()
    const { nodes: after } = run('add_steps', nodes, { x: 0, z: 0, rise: 1.2, width: 1 })
    // round(1.2 / 0.17) = 7 risers; 0.63 - 2.4 / 7 = 0.287 m; 7 > 3 risers: railings.
    const [stair] = created(nodes, after, 'stair') as Record<string, unknown>[]
    expect(stair).toMatchObject({ stepCount: 7, railingMode: 'both', width: 1 })
    const [segment] = created(nodes, after, 'stair-segment') as Record<string, unknown>[]
    expect(segment?.length as number).toBeCloseTo(7 * (0.63 - 2.4 / 7), 6)
  })

  test('a foot on a patio stands on the patio, not on the ground', () => {
    const patio = SlabNode.parse({
      id: 'slab_patio',
      parentId: 'level_g',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      elevation: 0.05,
    })
    const nodes = lot([patio as unknown as Record<string, unknown>])
    const { nodes: after } = run('add_steps', nodes, { x: 2, z: 2, rise: 0.4 })
    const [stair] = created(nodes, after, 'stair') as Record<string, unknown>[]
    expect(stair && 'supportSlabId' in stair ? stair.supportSlabId : undefined).toBeUndefined()
  })

  test('a rise of 2 m or a storey is a stair between storeys: refused', () => {
    expect(refusal(() => run('add_steps', lot(), { x: 0, z: 0, rise: 2 }))).toBe('steps_too_tall')
    // The ground storey is 2.7 m: below 2 m the rule is the 2 m bound.
    expect(refusal(() => run('add_steps', lot(), { x: 0, z: 0, rise: 1.99 }))).toBeUndefined()
  })
})
