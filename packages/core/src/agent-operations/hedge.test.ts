import { describe, expect, test } from 'bun:test'
import {
  AGENT_TOOL_CONTRACTS,
  BATCHABLE_TOOLS,
  HEDGE_MAX_LENGTH_M,
  isAgentRefusal,
} from '../agent-tools'
import { BuildingNode, HedgeNode, SiteNode, SlabNode } from '../index'
import {
  AGENT_OPERATIONS,
  type AgentContext,
  addHedge,
  applySceneChanges,
  type SceneNodes,
} from './index'

const context: AgentContext = { activeLevelId: null }
const lot = [
  [-10, -15],
  [10, -15],
  [10, 15],
  [-10, 15],
] as [number, number][]

function garden(buildingPlacement: Partial<BuildingNode> = {}, siteExtra: Partial<SiteNode> = {}) {
  const site = SiteNode.parse({ polygon: { type: 'polygon', points: lot }, ...siteExtra })
  const building = BuildingNode.parse({ parentId: site.id, ...buildingPlacement })
  const nodes: SceneNodes = {
    [site.id]: { ...site, children: [building.id] },
    [building.id]: building,
  }
  return { nodes, site, building }
}

const call = (nodes: SceneNodes, input: Record<string, unknown>) =>
  addHedge(nodes, input as never, context) as {
    result: { hedgeId: string; siteId: string; facts: Record<string, any> }
    changes?: {
      create?: { node: HedgeNode; parentId: string }[]
      update?: { id: string; data: Partial<HedgeNode> }[]
    }
  }

function refusalOf(run: () => unknown): string | null {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  return null
}

const straight = [
  [-8, 0],
  [8, 0],
]

describe('add_hedge', () => {
  test('is a shared tool with an operation behind it', () => {
    expect(AGENT_TOOL_CONTRACTS.some((contract) => contract.name === 'add_hedge')).toBe(true)
    expect(AGENT_OPERATIONS.add_hedge).toBe(addHedge)
  })

  test('is named by no other tool: a host that withholds it sends the texts it sent before', () => {
    expect((BATCHABLE_TOOLS as readonly string[]).includes('add_hedge')).toBe(false)
    for (const contract of AGENT_TOOL_CONTRACTS)
      if (contract.name !== 'add_hedge')
        expect({ name: contract.name, names: contract.description.includes('add_hedge') }).toEqual({
          name: contract.name,
          names: false,
        })
  })

  test('adds one hedge to the only Site, stored as its line and numbers, and nothing else', () => {
    const { nodes, site } = garden()
    const { result, changes } = call(nodes, { points: straight, height: 1.5, clip: 0.3, seed: 4 })
    const created = changes?.create?.[0]?.node

    expect(changes?.create).toHaveLength(1)
    expect(changes?.update).toBeUndefined()
    expect(created).toMatchObject({
      type: 'hedge',
      parentId: site.id,
      path: straight,
      closed: false,
      curve: false,
      height: 1.5,
      width: 0.7,
      clip: 0.3,
      seed: 4,
      gaps: [],
      gen: 1,
    })
    expect(result.siteId).toBe(site.id)
    expect(result.facts).toMatchObject({
      lengthM: 16,
      plantedM: 16,
      runs: 1,
      heightM: 1.5,
      widthM: 0.7,
      gaps: [],
      notPlanted: [],
      groundM: { lowest: -0.05, highest: -0.05 },
      gen: 1,
    })
    expect(result.facts.triangles).toBeGreaterThan(10_000)
    expect(result.facts.trianglesPerM).toBe(Math.round(result.facts.triangles / 16))
    const after = applySceneChanges(nodes, changes ?? {})
    expect(Object.values(after).filter((node) => node.type === 'hedge')).toHaveLength(1)
  })

  test('answers every opening asked for: where it was left, or why it was not', () => {
    const { nodes } = garden()
    const { result, changes } = call(nodes, {
      points: straight,
      gaps: [
        { at: [0, 0.3], width: 1.2 },
        { at: [2, 6], width: 1 },
        { at: [8.2, 0], width: 1 },
      ],
    })

    expect(changes?.create?.[0]?.node.gaps).toEqual([
      { at: 8, width: 1.2 },
      { at: 16, width: 1 },
    ])
    expect(result.facts.gaps).toEqual([
      { at: [0, 0.3], atM: 8, widthM: 1.2, fromM: 7.4, toM: 8.6, left: true },
      {
        at: [2, 6],
        widthM: 1,
        left: false,
        why: '6 m from the line: an opening is given on it or within 1.5 m of it.',
      },
      {
        at: [8.2, 0],
        atM: 16,
        widthM: 1,
        fromM: 15.5,
        toM: 16,
        left: true,
        note: 'cut at an end of the line',
      },
    ])
    expect(result.facts.runs).toBe(2)
    expect(result.facts.plantedM).toBe(14.3)
  })

  test('plants along a side of the lot, inside it by half its width, or the whole outline as a ring', () => {
    const { nodes } = garden({}, { frontEdge: 0 })
    const front = call(nodes, { boundary: { side: 'front' }, width: 1 }).changes?.create?.[0]?.node
    const rear = call(nodes, { boundary: { side: 'rear', insetM: 2 } }).changes?.create?.[0]?.node
    const all = call(nodes, { boundary: { side: 'all' }, width: 1 })

    expect(front?.path).toEqual([
      [-10, -14.5],
      [10, -14.5],
    ])
    expect(rear?.path).toEqual([
      [10, 13],
      [-10, 13],
    ])
    expect(all.changes?.create?.[0]?.node).toMatchObject({
      closed: true,
      path: [
        [-9.5, -14.5],
        [9.5, -14.5],
        [9.5, 14.5],
        [-9.5, 14.5],
      ],
    })
    expect(all.result.facts.closed).toBe(true)
    expect(all.result.facts.lengthM).toBeGreaterThan(90)
  })

  test('reads points and openings in a building’s plan frame and stores them in the Site’s', () => {
    const { nodes, building } = garden({ position: [3, 0, -2], rotation: [0, Math.PI / 2, 0] })
    const { changes, result } = call(nodes, {
      buildingId: building.id,
      points: [
        [0, 0],
        [4, 0],
      ],
      gaps: [{ at: [2, 0], width: 1 }],
    })
    const [[ax, az], [bx, bz]] = (changes?.create?.[0]?.node.path ?? []) as [
      [number, number],
      [number, number],
    ]

    expect([ax, az]).toEqual([3, -2])
    expect(bx).toBeCloseTo(3, 9)
    expect(bz).toBeCloseTo(-6, 9)
    expect(result.facts.gaps[0]).toMatchObject({ atM: 2, left: true })
  })

  test('reports the flat Site and raised slab top under its line', () => {
    const { nodes, site } = garden()
    const slab = SlabNode.parse({
      id: 'slab_garden',
      parentId: site.id,
      polygon: [
        [0, -2],
        [10, -2],
        [10, 2],
        [0, 2],
      ],
      elevation: 1.25,
      thickness: 0.4,
    })
    const scene = { ...nodes, [slab.id]: slab }
    const { facts } = call(scene, { points: straight }).result

    expect(facts.groundM.lowest).toBeCloseTo(-0.05, 6)
    expect(facts.groundM.highest).toBeCloseTo(1.25, 6)
  })

  test('changes only the fields given to an existing hedge, and new openings replace the old', () => {
    const { nodes } = garden()
    const made = call(nodes, { points: straight, gaps: [{ at: [0, 0], width: 1 }], seed: 3 })
    const scene = applySceneChanges(nodes, made.changes ?? {})
    const hedgeId = made.result.hedgeId
    const taller = call(scene, { hedgeId, height: 2 })
    const regated = call(scene, { hedgeId, gaps: [{ at: [4, 0], width: 2 }] })

    expect(taller.changes?.update).toEqual([{ id: hedgeId, data: { height: 2 } }])
    expect(taller.result.facts).toMatchObject({ heightM: 2, runs: 2 })
    expect(regated.changes?.update).toEqual([
      { id: hedgeId, data: { gaps: [{ at: 12, width: 2 }] } },
    ])
    expect(taller.changes?.create).toBeUndefined()
  })

  test('editing a saved generation-1 hedge preserves its generator and omitted fields', () => {
    const { nodes, site } = garden()
    const saved = HedgeNode.parse({
      id: 'hedge_saved',
      parentId: site.id,
      path: straight,
      gen: 1,
      seed: 19,
      gaps: [{ at: 8, width: 1 }],
    })
    const scene = { ...nodes, [saved.id]: saved }
    const changed = call(scene, { hedgeId: saved.id, height: 2 })
    expect(changed.result.facts.gen).toBe(1)
    expect(applySceneChanges(scene, changed.changes ?? {})[saved.id]).toEqual({
      ...saved,
      height: 2,
    })
    expect(scene[saved.id]).toBe(saved)
  })

  test('refuses editing a hedge from another Site using that Site’s boundary without changing either scene', () => {
    const { nodes, site } = garden()
    const other = SiteNode.parse({
      id: 'site_hedge_other',
      polygon: {
        type: 'polygon',
        points: [
          [100, 100],
          [120, 100],
          [120, 120],
          [100, 120],
        ],
      },
    })
    const saved = HedgeNode.parse({
      id: 'hedge_original_site',
      parentId: site.id,
      path: straight,
      gen: 1,
      seed: 19,
    })
    const scene = {
      ...nodes,
      [site.id]: {
        ...nodes[site.id],
        children: [...(nodes[site.id] as SiteNode).children, saved.id],
      },
      [other.id]: other,
      [saved.id]: saved,
    } as SceneNodes
    const before = JSON.stringify(scene)
    expect(
      refusalOf(() =>
        call(scene, {
          hedgeId: saved.id,
          siteId: other.id,
          boundary: { side: 'all' },
        }),
      ),
    ).toBe('hedge_site_mismatch')
    expect(JSON.stringify(scene)).toBe(before)
    expect(scene[saved.id]).toBe(saved)
    expect(scene[other.id]).toBe(other)
  })

  test('refuses a foreign building frame for both creation and editing without changing scene nodes', () => {
    const { nodes, site } = garden()
    const other = SiteNode.parse({ id: 'site_foreign_frame', children: ['building_foreign_frame'] })
    const foreignBuilding = BuildingNode.parse({
      id: 'building_foreign_frame',
      parentId: other.id,
      position: [100, 0, 100],
      rotation: [0, Math.PI / 2, 0],
    })
    const saved = HedgeNode.parse({
      id: 'hedge_frame_guard',
      parentId: site.id,
      path: straight,
      gen: 1,
    })
    const scene = {
      ...nodes,
      [other.id]: other,
      [foreignBuilding.id]: foreignBuilding,
      [saved.id]: saved,
    }
    const before = JSON.stringify(scene)
    for (const hedgeId of [undefined, saved.id]) {
      expect(
        refusalOf(() =>
          call(scene, {
            ...(hedgeId ? { hedgeId } : {}),
            siteId: site.id,
            buildingId: foreignBuilding.id,
            points: straight,
          }),
        ),
      ).toBe('building_site_mismatch')
      expect(JSON.stringify(scene)).toBe(before)
      expect(scene[saved.id]).toBe(saved)
      expect(scene[foreignBuilding.id]).toBe(foreignBuilding)
    }
  })

  test('refuses what cannot be a hedge, with a code, before building anything', () => {
    const { nodes, site } = garden()
    const bare = { [site.id]: { ...SiteNode.parse({}), id: site.id, polygon: undefined } } as never
    const long = Array.from({ length: 64 }, (_, i) => [i * 9000 - 280_000, i % 2 ? 9000 : -9000])

    expect(refusalOf(() => call(nodes, { height: 2 }))).toBe('hedge_line_required')
    expect(refusalOf(() => call(nodes, { points: straight, boundary: { side: 'front' } }))).toBe(
      'hedge_line_required',
    )
    expect(
      refusalOf(() =>
        call(nodes, {
          points: [
            [0, 0],
            [0.05, 0],
          ],
        }),
      ),
    ).toBe('hedge_side_too_short')
    expect(
      refusalOf(() =>
        call(nodes, {
          points: [
            [0, 0],
            [5, 0],
            [0, 0.05],
          ],
          closed: true,
        }),
      ),
    ).toBe('hedge_side_too_short')
    expect(
      refusalOf(() =>
        call(nodes, {
          points: [
            [0, 0],
            [HEDGE_MAX_LENGTH_M + 1, 0],
          ],
        }),
      ),
    ).toBe('hedge_too_long')
    expect(
      refusalOf(() => call(nodes, { points: long.map(([x, z]) => [(x ?? 0) / 100, z]) })),
    ).toBe('hedge_too_long')
    expect(
      refusalOf(() => call(nodes, { points: straight, gaps: [{ at: [0, 0], width: 20 }] })),
    ).toBe('hedge_all_open')
    expect(refusalOf(() => call(bare, { boundary: { side: 'front' } }))).toBe('hedge_no_boundary')
    expect(refusalOf(() => call(nodes, { hedgeId: 'hedge_missing', height: 2 }))).toBe(
      'hedge_not_found',
    )
    expect(refusalOf(() => call(nodes, { points: straight, buildingId: 'building_missing' }))).toBe(
      'building_not_found',
    )
    expect(refusalOf(() => call({}, { points: straight }))).toBe('no_site')
    for (const input of [
      { points: straight, height: 1001 },
      { points: straight, width: 0.01 },
      { points: straight, clip: 2 },
      { points: straight, leafSize: 5 },
      { points: straight, leafColor: 'green' },
      { points: [[0, 0]] },
      { points: Array.from({ length: 65 }, (_, i) => [i, 0]) },
      { points: straight, gaps: Array.from({ length: 17 }, () => ({ at: [0, 0], width: 1 })) },
      { points: straight, style: 'formal' },
    ])
      expect(refusalOf(() => call(nodes, input))).toBe('invalid_input')
  })
})
