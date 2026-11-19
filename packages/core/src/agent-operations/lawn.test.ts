import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { addSiteSurfaceTool } from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import {
  AnyNode,
  BuildingNode,
  LAWN_LIMITS,
  LawnNode,
  LevelNode,
  SiteNode,
  SlabNode,
} from '../schema'
import { AGENT_OPERATIONS, applySceneChanges, honestNodePatch, lawnPatchFacts } from './index'
import type { SceneNodes } from './types'

function scene(): Record<string, AnyNode> {
  const site = SiteNode.parse({
    id: 'site_a',
    children: ['building_a'],
    polygon: {
      type: 'polygon',
      points: [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
      ],
    },
  })
  const building = BuildingNode.parse({
    id: 'building_a',
    parentId: site.id,
    children: ['level_g'],
    position: [10, 0, 20],
    rotation: [0, Math.PI / 2, 0],
  })
  const level = LevelNode.parse({ id: 'level_g', parentId: building.id, level: 0 })
  return { [site.id]: site, [building.id]: building, [level.id]: level }
}

function run(nodes: SceneNodes, raw: object) {
  const input = z.object(addSiteSurfaceTool.input).parse(raw)
  const outcome = AGENT_OPERATIONS.add_site_surface(nodes, input, { activeLevelId: null })
  return {
    result: outcome.result as Record<string, unknown>,
    nodes: applySceneChanges(nodes, outcome.changes),
  }
}

function refusal(action: () => unknown) {
  try {
    action()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  throw new Error('Expected a refusal')
}

function lawn(nodes: SceneNodes): LawnNode {
  const found = Object.values(nodes).find((node) => node.type === 'lawn')
  if (found?.type !== 'lawn') throw new Error('Expected a lawn')
  return found
}

const strokes = [
  {
    points: [
      [1, 1],
      [2, 1],
    ],
    radiusM: 0.5,
    effect: 'bare',
    strength: 1,
  },
]
const corners = [
  [0, 0],
  [4, 3],
]

describe('lawn through the existing site-surface operation', () => {
  test('creates one compact Site child in an explicit Site frame, with factual counts and no slab ID', () => {
    const nodes = scene()
    const { result, nodes: after } = run(nodes, {
      kind: 'lawn',
      siteId: 'site_a',
      corners,
      strokes,
    })
    const created = lawn(after)
    expect(created).toMatchObject({ parentId: 'site_a', strokes, height: 0.06, gen: 1 })
    expect(result).toMatchObject({
      ok: true,
      kind: 'lawn',
      lawnId: created.id,
      siteId: 'site_a',
      requestedAreaM2: 12,
      retainedAreaM2: 12,
      coverageFraction: 1,
      gen: 1,
      flowerCount: 0,
    })
    expect(result).not.toHaveProperty('slabId')
    expect(typeof result.bladeCount).toBe('number')
    expect(result.strokeAreas).toMatchObject({
      estimated: true,
      byEffect: { bare: expect.any(Number) },
    })
    expect(Object.values(after).filter((node) => node.type === 'slab')).toHaveLength(0)
    expect(AnyNode.parse(JSON.parse(JSON.stringify(created)))).toEqual(created)
  })

  test('converts both the outline and stroke points exactly once from a rotated level frame', () => {
    const { nodes } = run(scene(), { kind: 'lawn', levelId: 'level_g', corners, strokes })
    const created = lawn(nodes)
    for (const [index, expected] of [
      [10, 20],
      [10, 16],
      [13, 16],
      [13, 20],
    ].entries()) {
      expect(created.outline[index]?.[0]).toBeCloseTo(expected[0] as number, 10)
      expect(created.outline[index]?.[1]).toBeCloseTo(expected[1] as number, 10)
    }
    expect(created.strokes[0]?.points[0]?.[0]).toBeCloseTo(11, 10)
    expect(created.strokes[0]?.points[0]?.[1]).toBeCloseTo(19, 10)
    expect(created.strokes[0]?.points[1]?.[0]).toBeCloseTo(11, 10)
    expect(created.strokes[0]?.points[1]?.[1]).toBeCloseTo(18, 10)
    expect(created.strokes[0]?.radiusM).toBe(0.5)
  })

  test('creates a lawn on a Site with no building or level', () => {
    const site = SiteNode.parse({ id: 'site_a' })
    expect(run({ [site.id]: site }, { kind: 'lawn', siteId: site.id, corners }).result.siteId).toBe(
      site.id,
    )
  })

  test('accepts unit-bearing lawn dimensions and brush sizes in the shared contract', () => {
    const { nodes } = run(scene(), {
      kind: 'lawn',
      siteId: 'site_a',
      corners,
      height: '6 cm',
      bladeWidth: '8 mm',
      strokes: [
        {
          points: [
            ['1 m', '1 m'],
            ['2 m', '1 m'],
          ],
          radiusM: '50 cm',
          effect: 'bare',
          strength: 1,
        },
      ],
    })
    expect(lawn(nodes)).toMatchObject({ height: 0.06, bladeWidth: 0.008, strokes })
  })

  test.each([
    [{ siteId: 'site_missing' }, 'no_site'],
    [{ siteId: 'site_a', levelId: 'level_g' }, 'lawn_target_conflict'],
    [{ siteId: 'site_a', materialPreset: 'library:preset-lawn' }, 'lawn_material_unsupported'],
    [
      {
        siteId: 'site_a',
        polygon: [
          [0, 0],
          [4, 0],
          [8, 0],
        ],
        corners: undefined,
      },
      'surface_degenerate',
    ],
    [
      {
        siteId: 'site_a',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
        ],
        corners,
      },
      'lawn_outline_required',
    ],
  ] as const)('refuses before writes: %j', (fields, code) => {
    const nodes = scene()
    const before = JSON.stringify(nodes)
    expect(refusal(() => run(nodes, { kind: 'lawn', corners, ...fields }))).toBe(code)
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('refuses a tipped building before writes', () => {
    const nodes = scene()
    const building = nodes.building_a
    if (building?.type !== 'building') throw new Error('Expected building')
    nodes.building_a = { ...building, rotation: [0.1, 0, 0] }
    expect(refusal(() => run(nodes, { kind: 'lawn', levelId: 'level_g', corners }))).toBe(
      'lawn_transform_unsupported',
    )
  })

  test('does not guess a Site from the lowest floor when several Sites exist', () => {
    const nodes = scene()
    nodes.site_b = SiteNode.parse({ id: 'site_b' })
    const before = JSON.stringify(nodes)
    expect(refusal(() => run(nodes, { kind: 'lawn', corners }))).toBe('ambiguous_site')
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('rejects malformed strokes even when a caller bypasses contract parsing', () => {
    const nodes = scene()
    const before = JSON.stringify(nodes)
    const input = {
      kind: 'lawn',
      siteId: 'site_a',
      corners,
      strokes: [{ points: [[Infinity, 0]], radiusM: 1, effect: 'bare', strength: 1 }],
    }
    expect(
      refusal(() =>
        AGENT_OPERATIONS.add_site_surface(nodes, input as never, { activeLevelId: null }),
      ),
    ).toBe('invalid_input')
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('preflights work caps on existing lawn edits before changing anything', () => {
    const nodes = scene()
    const current = LawnNode.parse({
      parentId: 'site_a',
      outline: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const before = JSON.stringify(current)
    const outline = [
      [-49, -49],
      [49, -49],
      [49, -48.9],
      [-48.9, -48.9],
      [-48.9, 49],
      [-49, 49],
    ]
    expect(refusal(() => lawnPatchFacts(current, { outline }, nodes))).toBe('lawn_work_budget')
    expect(JSON.stringify(current)).toBe(before)
  })

  test('keeps old flat lawn slabs byte-for-byte while creating a new core lawn', () => {
    const nodes = scene()
    const slab = SlabNode.parse({
      parentId: 'level_g',
      polygon: [
        [30, 0],
        [32, 0],
        [32, 2],
        [30, 2],
      ],
      elevation: 0.01,
      metadata: { flatwork: 'lawn' },
    })
    nodes[slab.id] = slab
    const old = JSON.stringify(slab)
    const { nodes: after } = run(nodes, { kind: 'lawn', siteId: 'site_a', corners })
    expect(JSON.stringify(after[slab.id])).toBe(old)
  })
})

describe('generic lawn stroke editing', () => {
  test('the contract, creation and replacement share the explicit total-point budget', () => {
    const dab = { ...strokes[0]!, points: [[100, 100]] }
    const dabs = Array.from({ length: 65 }, () => dab)
    const created = run(scene(), { kind: 'lawn', siteId: 'site_a', corners, strokes: dabs })
    expect(lawn(created.nodes).strokes).toEqual(dabs)
    const current = lawn(created.nodes)
    expect(honestNodePatch(current, { strokes: dabs })).toEqual({ strokes: dabs })

    const points = Array.from({ length: LAWN_LIMITS.maxStrokePoints }, () => [100, 100])
    const atBudget = [{ ...dab, points }]
    const contract = z.object(addSiteSurfaceTool.input)
    expect(contract.safeParse({ kind: 'lawn', corners, strokes: atBudget }).success).toBe(true)
    expect(honestNodePatch(current, { strokes: atBudget })).toEqual({ strokes: atBudget })
    const full = run(scene(), {
      kind: 'lawn',
      siteId: 'site_a',
      corners: [
        [0, 0],
        [1, 1],
      ],
      strokes: atBudget,
    })
    expect(lawn(full.nodes).strokes).toEqual(atBudget)
    const overBudget = [...atBudget, dab]
    const input = { kind: 'lawn', siteId: 'site_a', corners, strokes: overBudget }
    const parsed = contract.safeParse(input)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.message).toMatch(/20,000.*points/)

    const before = JSON.stringify(created.nodes)
    for (const action of [
      () =>
        AGENT_OPERATIONS.add_site_surface(created.nodes, input as never, { activeLevelId: null }),
      () => honestNodePatch(current, { strokes: overBudget }),
      () => lawnPatchFacts(current, { strokes: overBudget }, created.nodes),
    ]) {
      expect(refusal(action)).toBe('invalid_input')
      expect(action).toThrow(/20,000.*points/)
    }
    expect(JSON.stringify(created.nodes)).toBe(before)
  })

  test('stores exactly the same bounded stroke representation as creation', () => {
    const current = LawnNode.parse({
      outline: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    expect(honestNodePatch(current, { strokes })).toEqual({ strokes })
  })

  test('preflights an existing lawn and returns the same effect-area facts as creation', () => {
    const nodes = scene()
    const created = run(nodes, { kind: 'lawn', siteId: 'site_a', corners, strokes })
    const current = LawnNode.parse({
      parentId: 'site_a',
      outline: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const before = JSON.stringify(nodes)
    expect(lawnPatchFacts(current, { strokes }, nodes)?.strokeAreas).toEqual(
      created.result.strokeAreas,
    )
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test.each([
    { replacement: [{ points: [], radiusM: 1, effect: 'bare', strength: 1 }] },
    { replacement: [{ points: [[NaN, 0]], radiusM: 1, effect: 'bare', strength: 1 }] },
    { replacement: [{ points: [[0, 0]], radiusM: 11, effect: 'bare', strength: 1 }] },
  ])('refuses invalid replacement strokes without mutating the node', ({ replacement }) => {
    const current = LawnNode.parse({
      outline: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const before = JSON.stringify(current)
    expect(refusal(() => honestNodePatch(current, { strokes: replacement }))).toBe('invalid_input')
    expect(JSON.stringify(current)).toBe(before)
  })
})
