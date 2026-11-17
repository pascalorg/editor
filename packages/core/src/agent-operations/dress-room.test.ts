import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { dressRoomTool, isAgentRefusal } from '../agent-tools'
import {
  CabinetModuleNode,
  CabinetNode,
  ItemNode,
  LevelNode,
  type WallFace,
  type WallNode,
} from '../schema'
import { twoRooms } from './__fixtures__/dressing-scenes'
import { applySceneChanges, type DressRoomInput, dressRoom } from './index'
import type { SceneNodes } from './types'

// Oracles: the fixed two-room rectangle, documented layer defaults, the eight-region
// cap and owner prefix. No expected face, interval or height calls a production helper.
const context = { activeLevelId: 'level_0' }
const scene = (setup?: Parameters<typeof twoRooms>[0]) => twoRooms(setup).nodes as SceneNodes
const wall = (nodes: SceneNodes, id: string) => nodes[id] as WallNode
const regions = (nodes: SceneNodes, id: string) => wall(nodes, id).faceRegions ?? []
const run = (nodes: SceneNodes, input: DressRoomInput) => {
  const outcome = dressRoom(nodes, input, context)
  return { ...outcome, nodes: applySceneChanges(nodes, outcome.changes) as SceneNodes }
}
const code = (action: () => unknown, fact?: string) => {
  try {
    action()
  } catch (error) {
    if (isAgentRefusal(error)) {
      if (fact) expect(`${error.message} ${JSON.stringify(error.details)}`).toContain(fact)
      return error.code
    }
    throw error
  }
  return 'no refusal'
}
const hand = (n: number, face: WallFace = 'a') =>
  Array.from({ length: n }, (_, i) => ({
    id: `hand_${i}`,
    face,
    v1: 0.1 + i / 10,
    finish: '#aaaaaa',
  }))
const LIVING: DressRoomInput = {
  zoneIds: ['zone_salon'],
  layers: [
    { kind: 'skirting', height: 0.14, profile: 'base-colonial' },
    { kind: 'wainscot', finish: 'library:preset-cream', to: 0.9 },
    { kind: 'chairRail', offsetY: 0.9, height: 0.06, profile: 'rail-ogee' },
    { kind: 'crown', height: 0.14, profile: 'crown-ogee' },
  ],
}

function kitchenRun(tier: 'base' | 'wall' = 'base') {
  const cabinet = CabinetNode.parse({
    id: 'cabinet_a',
    parentId: 'level_0',
    position: [2, 0, 2.65],
    rotation: Math.PI,
    runTier: tier,
    children: ['cabinet-module_a', 'cabinet-module_b', 'cabinet-module_c'],
  })
  return [
    cabinet,
    ...['a', 'b', 'c'].map((suffix, at) =>
      CabinetModuleNode.parse({
        id: `cabinet-module_${suffix}`,
        parentId: cabinet.id,
        // Native run creation seats the module itself on the 10 cm plinth.
        position: [(at - 1) * 0.6, tier === 'base' ? 0.1 : 0, 0],
        width: 0.6,
      }),
    ),
  ]
}

describe('atomic room dressing', () => {
  test('one seven-layer request leaves the complete final stack, not only its last layer', () => {
    const before = scene()
    const { nodes, changes } = run(before, {
      zoneIds: ['zone_salon'],
      layers: [
        { kind: 'skirting', height: 0.14, finish: 'library:preset-white' },
        { kind: 'wainscot', finish: '#111111', to: 0.9 },
        { kind: 'chairRail', offsetY: 0.9, finish: 'library:preset-cream' },
        { kind: 'crown', height: 0.12, finish: 'library:preset-white' },
        { kind: 'tiles', finish: '#222222', to: 1.2, where: { walls: ['wall_p'] } },
        { kind: 'splashback', finish: '#333333', where: { walls: ['wall_an'] } },
        { kind: 'accent', finish: '#444444', where: { walls: ['wall_w'] } },
      ],
    })
    for (const id of ['wall_s', 'wall_p', 'wall_an', 'wall_w']) {
      expect(wall(nodes, id).skirting).toMatchObject({ enabled: true, height: 0.14 })
      expect(wall(nodes, id).chairRail).toMatchObject({ enabled: true, offsetY: 0.9 })
      expect(wall(nodes, id).crown).toMatchObject({ enabled: true, height: 0.12 })
      expect(wall(nodes, id).slots).toMatchObject({
        aSkirting: 'library:preset-white',
        aChairRail: 'library:preset-cream',
        aCrown: 'library:preset-white',
      })
    }
    expect(regions(nodes, 'wall_s').map(({ finish }) => finish)).toEqual(['#111111'])
    expect(regions(nodes, 'wall_p').map(({ finish }) => finish)).toEqual(['#111111', '#222222'])
    expect(regions(nodes, 'wall_an').map(({ finish }) => finish)).toEqual(['#111111', '#333333'])
    expect(regions(nodes, 'wall_w').map(({ finish }) => finish)).toEqual(['#111111', '#444444'])
    expect(regions(nodes, 'wall_s')[0]).toMatchObject({ face: 'a', u0: 0, u1: 4, v1: 0.9 })
    expect(changes?.update).toHaveLength(4)
    expect(new Set(changes?.update?.map(({ id }) => id)).size).toBe(4)
    expect(wall(nodes, 'wall_e')).toEqual(wall(before, 'wall_e'))
  })

  test('the contract accepts the complete stack and zero chair-rail offset', () => {
    const schema = z.object(dressRoomTool.input)
    expect(schema.safeParse(LIVING).success).toBe(true)
    expect(
      schema.safeParse({ zoneIds: ['zone_salon'], layers: [{ kind: 'chairRail', offsetY: 0 }] })
        .success,
    ).toBe(true)
    const after = run(scene(), {
      zoneIds: ['zone_salon'],
      layers: [{ kind: 'chairRail', offsetY: 0 }],
    }).nodes
    expect(wall(after, 'wall_w').chairRail?.offsetY).toBe(0)
  })

  test('lays all trims and wainscot on inward faces, bounded to the selected room', () => {
    const before = scene()
    const { nodes, result } = run(before, LIVING)
    for (const id of ['wall_s', 'wall_p', 'wall_an', 'wall_w']) {
      expect(regions(nodes, id)).toHaveLength(1)
      expect(regions(nodes, id)[0]).toMatchObject({
        face: 'a',
        finish: 'library:preset-cream',
        v1: 0.9,
      })
      expect(wall(nodes, id).skirting).toMatchObject({
        enabled: true,
        sides: 'a',
        height: 0.14,
        profile: 'base-colonial',
      })
      expect(wall(nodes, id).chairRail).toMatchObject({
        enabled: true,
        sides: 'a',
        height: 0.06,
        offsetY: 0.9,
      })
      expect(wall(nodes, id).crown).toMatchObject({ enabled: true, sides: 'a', height: 0.14 })
    }
    expect(regions(nodes, 'wall_s')[0]).toMatchObject({ u0: 0, u1: 4 })
    for (const kind of ['skirting', 'chairRail', 'crown'] as const)
      expect(wall(nodes, 'wall_s')[kind]?.spans).toEqual([{ face: 'a', u0: 0, u1: 4 }])
    expect(wall(nodes, 'wall_e')).toEqual(wall(before, 'wall_e'))
    expect(result).toMatchObject({ ok: true, written: true, conflicts: [] })
  })

  test('replaces only the selected owner, retaining hand paint and the neighboring room', () => {
    const initial = scene({ walls: { wall_s: { faceRegions: hand(1) } } })
    const first = run(initial, { ...LIVING, zoneIds: ['zone_salon', 'zone_bath'] }).nodes
    const neighbors = regions(first, 'wall_s').filter((r) => r.id.startsWith('dress:zone_bath:'))
    expect(neighbors).toHaveLength(1)
    expect(neighbors[0]).toMatchObject({ face: 'a', u0: 4, u1: 8, v1: 0.9 })
    const second = run(first, {
      zoneIds: ['zone_salon'],
      layers: [{ kind: 'wainscot', finish: '#ffffff', to: 1.1 }],
    }).nodes
    expect(regions(second, 'wall_s').filter((r) => r.id.startsWith('dress:zone_bath:'))).toEqual(
      neighbors,
    )
    expect(regions(second, 'wall_s').filter((r) => r.id.startsWith('hand_'))).toEqual(hand(1))
    const owned = regions(second, 'wall_s').filter((r) => r.id.startsWith('dress:zone_salon:'))
    expect(owned).toHaveLength(1)
    expect(owned[0]).toMatchObject({ face: 'a', u0: 0, u1: 4, v1: 1.1, finish: '#ffffff' })
  })

  test('empty layers remove owned regions but preserve trims, other owners and hand paint', () => {
    const first = run(scene({ walls: { wall_s: { faceRegions: hand(1) } } }), {
      ...LIVING,
      zoneIds: ['zone_salon', 'zone_bath'],
    }).nodes
    const { nodes } = run(first, { zoneIds: ['zone_salon'], layers: [] })
    for (const id of ['wall_s', 'wall_p', 'wall_an', 'wall_w']) {
      expect(regions(nodes, id).some((r) => r.id.startsWith('dress:zone_salon:'))).toBe(false)
      for (const kind of ['skirting', 'chairRail', 'crown'] as const)
        expect(wall(nodes, id)[kind]).toEqual(wall(first, id)[kind])
    }
    expect(regions(nodes, 'wall_s')).toEqual(
      regions(first, 'wall_s').filter((r) => !r.id.startsWith('dress:zone_salon:')),
    )
  })

  test('dry run reports the same plan without changes or input mutation', () => {
    const nodes = scene()
    const before = structuredClone(nodes)
    const live = dressRoom(nodes, LIVING, context)
    const dry = dressRoom(nodes, { ...LIVING, dryRun: true }, context)
    expect(dry.result).toEqual({ ...live.result, written: false })
    expect(applySceneChanges(nodes, dry.changes)).toEqual(before)
    expect(dry.changes?.update ?? []).toEqual([])
    expect(nodes).toEqual(before)
    expect(live.changes?.update).toHaveLength(4)
  })

  test('uses documented height defaults and preserves the base room finish', () => {
    const base = scene({ zones: { zone_salon: { wallMaterial: 'library:preset-white' } } })
    const { nodes } = run(base, {
      zoneIds: ['zone_salon'],
      layers: [
        { kind: 'wainscot', finish: '#111111', where: { walls: ['wall_s'] } },
        { kind: 'tiles', finish: '#222222', where: { walls: ['wall_w'] } },
        { kind: 'splashback', finish: '#333333', where: { walls: ['wall_an'] } },
        { kind: 'tiles', finish: '#444444', to: 'full', where: { walls: ['wall_p'] } },
        { kind: 'accent', finish: '#555555', where: { walls: ['wall_w'] } },
      ],
    })
    const vertical = (id: string) =>
      regions(nodes, id).map(({ v0, v1, finish }) => [v0, v1, finish])
    expect(vertical('wall_s')).toEqual([[undefined, 0.9, '#111111']])
    expect(vertical('wall_w')).toEqual([
      [undefined, 1.2, '#222222'],
      [undefined, undefined, '#555555'],
    ])
    expect(vertical('wall_an')).toEqual([[0.9, 1.5, '#333333']])
    expect(vertical('wall_p')).toEqual([[undefined, undefined, '#444444']])
    expect(nodes.zone_salon).toEqual(base.zone_salon)
  })

  test('every colored trim layer is painted even when an earlier color produces a matching note', () => {
    const { nodes } = run(scene(), {
      zoneIds: ['zone_salon'],
      layers: [
        { kind: 'skirting', finish: '#13579b' },
        { kind: 'chairRail', finish: 'library:preset-white' },
        { kind: 'crown', finish: 'library:preset-cream' },
      ],
    })
    expect(wall(nodes, 'wall_w').slots).toMatchObject({
      aChairRail: 'library:preset-white',
      aCrown: 'library:preset-cream',
    })
    expect(wall(nodes, 'wall_w').slots?.aSkirting).toBeDefined()
    expect(wall(nodes, 'wall_w').slots?.bSkirting).toBeUndefined()
  })
})

describe('dressing refusals have no partial effect', () => {
  const wainscot = { kind: 'wainscot', finish: '#ffffff' } as const
  test('shared-face recoloring refuses without applying an earlier valid paint layer', () => {
    const nodes = run(scene({ walls: { wall_w: { faceRegions: hand(1) } } }), {
      zoneIds: ['zone_salon'],
      layers: [{ kind: 'skirting', finish: 'library:preset-white' }],
    }).nodes
    const before = structuredClone(nodes)
    expect(
      code(
        () =>
          dressRoom(
            nodes,
            {
              zoneIds: ['zone_bath'],
              layers: [wainscot, { kind: 'skirting', finish: 'library:preset-cream' }],
            },
            context,
          ),
        'wall_s',
      ),
    ).toBe('trim_conflict')
    expect(nodes).toEqual(before)
  })

  test('opposite-face shape changes refuse, but selecting both rooms permits a common change', () => {
    const nodes = run(scene(), {
      zoneIds: ['zone_salon'],
      layers: [{ kind: 'skirting', height: 0.1 }],
    }).nodes
    const before = structuredClone(nodes)
    expect(
      code(
        () =>
          dressRoom(
            nodes,
            {
              zoneIds: ['zone_bath'],
              layers: [{ kind: 'skirting', height: 0.16, where: { walls: ['wall_p'] } }],
            },
            context,
          ),
        'wall_p',
      ),
    ).toBe('trim_conflict')
    expect(nodes).toEqual(before)
    const both = run(nodes, {
      zoneIds: ['zone_salon', 'zone_bath'],
      layers: [{ kind: 'skirting', height: 0.16 }],
    }).nodes
    expect(wall(both, 'wall_p').skirting).toMatchObject({
      enabled: true,
      sides: 'both',
      height: 0.16,
    })
    expect(wall(both, 'wall_s').skirting?.height).toBe(0.16)
  })

  const invalid: [string, DressRoomInput, Parameters<typeof twoRooms>[0]?][] = [
    ['target_required', { zoneIds: [], layers: [] }],
    ['target_not_found', { zoneIds: ['zone_missing'], layers: [wainscot] }],
    [
      'target_not_found',
      { zoneIds: ['zone_salon'], layers: [{ ...wainscot, where: { walls: ['wall_missing'] } }] },
    ],
    [
      'not_on_room',
      { zoneIds: ['zone_salon'], layers: [{ ...wainscot, where: { walls: ['wall_bn'] } }] },
    ],
    [
      'no_walls',
      { zoneIds: ['zone_salon'], layers: [wainscot] },
      { zones: { zone_salon: { boundaryWallIds: [] } } },
    ],
    [
      'curtain_wall',
      { zoneIds: ['zone_salon'], layers: [{ ...wainscot, where: { walls: ['wall_w'] } }] },
      { walls: { wall_w: { wallType: 'curtain' } } },
    ],
    ['finish_required', { zoneIds: ['zone_salon'], layers: [{ kind: 'wainscot' }] }],
    [
      'walls_required',
      { zoneIds: ['zone_salon'], layers: [{ kind: 'accent', finish: '#ffffff' }] },
    ],
    ['invalid_layer', { zoneIds: ['zone_salon'], layers: [{ kind: 'skirting', to: 1 }] }],
    ['invalid_layer', { zoneIds: ['zone_salon'], layers: [{ ...wainscot, profile: 'flat' }] }],
    ['invalid_size', { zoneIds: ['zone_salon'], layers: [{ kind: 'skirting', height: -1 }] }],
    [
      'invalid_size',
      {
        zoneIds: ['zone_salon'],
        layers: [{ kind: 'splashback', finish: '#ffffff', from: 1, to: 0.5 }],
      },
    ],
  ]
  for (const [expected, input, setup] of invalid)
    test(`${expected}: ${JSON.stringify(input)}`, () => {
      const nodes = scene(setup)
      const before = structuredClone(nodes)
      expect(code(() => dressRoom(nodes, input, context))).toBe(expected)
      expect(nodes).toEqual(before)
    })

  test('a late invalid room prevents writes to an earlier valid room', () => {
    const nodes = scene({ zones: { zone_bath: { boundaryWallIds: [] } } })
    const before = structuredClone(nodes)
    expect(
      code(() => dressRoom(nodes, { ...LIVING, zoneIds: ['zone_salon', 'zone_bath'] }, context)),
    ).toBe('no_walls')
    expect(nodes).toEqual(before)
  })

  test('room-targeted railings cannot bypass unsupported trim refusal', () => {
    const nodes = scene({ walls: { wall_w: { wallType: 'railing' } } })
    const before = structuredClone(nodes)
    expect(code(() => dressRoom(nodes, LIVING, context))).toBe('railing_wall')
    expect(nodes).toEqual(before)
  })

  test('an unselected railing does not block paint on an ordinary boundary wall', () => {
    const nodes = scene({
      walls: { wall_w: { wallType: 'railing', faceRegions: hand(1) } },
    })
    const { nodes: after } = run(nodes, {
      zoneIds: ['zone_salon'],
      layers: [{ kind: 'tiles', finish: '#ffffff', where: { walls: ['wall_an'] } }],
    })
    expect(regions(after, 'wall_an')).toEqual([
      expect.objectContaining({ face: 'a', finish: '#ffffff', v1: 1.2 }),
    ])
    expect(wall(after, 'wall_w')).toEqual(wall(nodes, 'wall_w'))
  })

  test('an unselected railing does not block trim on an ordinary boundary wall', () => {
    const nodes = scene({ walls: { wall_w: { wallType: 'railing' } } })
    const { nodes: after } = run(nodes, {
      zoneIds: ['zone_salon'],
      layers: [{ kind: 'skirting', height: 0.14, where: { walls: ['wall_an'] } }],
    })
    expect(wall(after, 'wall_an').skirting).toMatchObject({
      enabled: true,
      sides: 'a',
      height: 0.14,
    })
    expect(wall(after, 'wall_w')).toEqual(wall(nodes, 'wall_w'))
  })

  test('an unselected railing with owned regions still refuses unsafe cleanup atomically', () => {
    const nodes = scene({
      walls: {
        wall_w: {
          wallType: 'railing',
          faceRegions: [{ id: 'dress:zone_salon:old', face: 'a', v1: 0.9, finish: '#cccccc' }],
        },
      },
    })
    const before = structuredClone(nodes)
    expect(
      code(() =>
        dressRoom(
          nodes,
          {
            zoneIds: ['zone_salon'],
            layers: [{ kind: 'tiles', finish: '#ffffff', where: { walls: ['wall_an'] } }],
          },
          context,
        ),
      ),
    ).toBe('railing_wall')
    expect(nodes).toEqual(before)
  })

  test('the eighth region is accepted and the ninth refused, including hand paint', () => {
    const input: DressRoomInput = { zoneIds: ['zone_salon'], layers: [wainscot] }
    const full = scene({ walls: { wall_w: { faceRegions: hand(8) } } })
    const before = structuredClone(full)
    expect(code(() => dressRoom(full, input, context))).toBe('region_limit')
    expect(full).toEqual(before)
    const { nodes } = run(scene({ walls: { wall_w: { faceRegions: hand(7) } } }), input)
    expect(regions(nodes, 'wall_w')).toHaveLength(8)
    expect(regions(nodes, 'wall_w').filter((r) => r.id.startsWith('hand_'))).toEqual(hand(7))
  })

  test('a full-face script refuses the entire plan, not just its own wall', () => {
    const nodes = scene({
      raw: { wall_w: { finishScripts: { a: { kind: 'script', inputs: 'k' } } } },
    })
    const before = structuredClone(nodes)
    expect(code(() => dressRoom(nodes, LIVING, context))).toBe('script_owns_face')
    expect(nodes).toEqual(before)
  })

  test('partial curved finish coverage is skipped with a fact, not expanded to the whole wall', () => {
    const { nodes, result } = run(scene({ walls: { wall_s: { curveOffset: 0.05 } } }), {
      zoneIds: ['zone_salon'],
      layers: [wainscot],
    })
    expect(regions(nodes, 'wall_s')).toEqual([])
    expect(regions(nodes, 'wall_w')).toHaveLength(1)
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          zoneId: 'zone_salon',
          layer: 0,
          why: expect.stringContaining('wall_s is curved'),
        }),
      ]),
    )
  })
})

describe('fixture and cabinet splashback targeting', () => {
  test('a square fixture flush against a diagonal wall is matched by its oriented footprint', () => {
    // A 60 cm square with local X along the 45-degree wall, centered at station
    // 2*sqrt(2). Its back is on face a, 5 cm from the wall reference line.
    // An enclosing world AABB penetrates this face by 30 cm, but the actual
    // oriented square does not. Expected coverage is its 60 cm wall projection.
    const offset = 0.35 / Math.SQRT2
    const fixture = ItemNode.parse({
      id: 'item_diagonal_sink',
      parentId: 'level_0',
      position: [2 - offset, 0, 2 + offset],
      rotation: [0, -Math.PI / 4, 0],
      asset: {
        id: 'asset_diagonal_sink',
        category: 'sink',
        name: 'Sink',
        thumbnail: '',
        src: 'https://example.com/sink.glb',
        dimensions: [0.6, 1, 0.6],
      },
    })
    const nodes = scene({
      walls: {
        wall_s: { start: [0, 0], end: [4, 4] },
        wall_an: { start: [4, 4], end: [0, 4] },
        wall_w: { start: [0, 4], end: [0, 0] },
      },
      zones: {
        zone_salon: {
          polygon: [
            [0, 0],
            [4, 4],
            [0, 4],
          ],
          boundaryWallIds: ['wall_s', 'wall_an', 'wall_w'],
        },
        zone_bath: {
          polygon: [
            [10, 0],
            [12, 0],
            [12, 2],
            [10, 2],
          ],
          boundaryWallIds: [],
        },
      },
      extra: [fixture],
    })
    const { nodes: after } = run(nodes, {
      zoneIds: ['zone_salon'],
      layers: [
        {
          kind: 'tiles',
          finish: '#ffffff',
          where: { around: [fixture.id], margin: 0 },
        },
      ],
    })
    const painted = regions(after, 'wall_s')
    expect(painted).toHaveLength(1)
    expect(painted[0]?.face).toBe('a')
    // Fixture projections are stored to the nearest millimetre, as in the
    // original lab targeting contract. Round the analytic endpoints, not output.
    expect(painted[0]?.u0).toBe(Math.round((2 * Math.SQRT2 - 0.3) * 1000) / 1000)
    expect(painted[0]?.u1).toBe(Math.round((2 * Math.SQRT2 + 0.3) * 1000) / 1000)
    expect(regions(after, 'wall_an')).toEqual([])
    expect(regions(after, 'wall_w')).toEqual([])
  })

  for (const [showPlinth, moduleY, expectedTop] of [
    [false, 0, 0.82],
    [true, 0.25, 1.07],
  ] as const) {
    test(`a cabinet splashback meets the native countertop at module Y=${moduleY}, showPlinth=${showPlinth}`, () => {
      const extra = kitchenRun().map((node) => {
        if (node.type === 'cabinet') return { ...node, showPlinth }
        return {
          ...node,
          position: [node.position[0], moduleY, node.position[2]] as [number, number, number],
        }
      })
      const { nodes } = run(scene({ extra }), {
        zoneIds: ['zone_salon'],
        layers: [
          {
            kind: 'splashback',
            finish: '#ffffff',
            where: { alongRun: 'cabinet_a' },
          },
        ],
      })
      const painted = regions(nodes, 'wall_an')
      expect(painted).toHaveLength(1)
      // Native run-layout groups use module Y + its 0.80 m carcass; the
      // countertop slab adds 0.02 m. No extra run-level plinth is added.
      expect(painted[0]?.v0).toBeCloseTo(expectedTop, 8)
      expect(painted[0]?.v1).toBeCloseTo(expectedTop + 0.6, 8)
      expect(painted[0]?.u0).toBeCloseTo(1.1, 8)
      expect(painted[0]?.u1).toBeCloseTo(2.9, 8)
    })
  }

  test('a stepped native countertop gets contiguous splashback regions at each actual top', () => {
    const extra = kitchenRun().map((node) =>
      node.id === 'cabinet-module_b'
        ? { ...node, position: [0, 0.25, 0] as [number, number, number] }
        : node,
    )
    const { nodes } = run(scene({ extra }), {
      zoneIds: ['zone_salon'],
      layers: [
        {
          kind: 'splashback',
          finish: '#ffffff',
          where: { alongRun: 'cabinet_a' },
        },
      ],
    })
    const painted = [...regions(nodes, 'wall_an')].sort((a, b) => (a.u0 ?? 0) - (b.u0 ?? 0))
    expect(painted).toHaveLength(3)
    // The three 60 cm modules occupy u=1.1..2.9. Only the middle module is
    // raised; its neighbors keep their lower countertop, without a gap or overlap.
    for (const [index, [u0, u1, v0]] of [
      [1.1, 1.7, 0.92],
      [1.7, 2.3, 1.07],
      [2.3, 2.9, 0.92],
    ].entries()) {
      expect(painted[index]?.u0).toBeCloseTo(u0!, 8)
      expect(painted[index]?.u1).toBeCloseTo(u1!, 8)
      expect(painted[index]?.v0).toBeCloseTo(v0!, 8)
      expect(painted[index]?.v1).toBeCloseTo(v0! + 0.6, 8)
    }
  })

  test('missing and cyclic cabinet ancestry refuses instead of guessing a world frame', () => {
    const runNodes = kitchenRun()
    const missing = scene({
      extra: runNodes.map((node) =>
        node.id === 'cabinet_a' ? { ...node, parentId: 'cabinet-module_missing' } : node,
      ),
    })
    const host = CabinetModuleNode.parse({
      id: 'cabinet-module_cycle',
      parentId: 'cabinet_a',
      children: ['cabinet_a'],
    })
    const cyclic = scene({
      extra: [
        host,
        ...runNodes.map((node) =>
          node.id === 'cabinet_a' ? { ...node, parentId: host.id } : node,
        ),
      ],
    })
    for (const nodes of [missing, cyclic]) {
      const before = structuredClone(nodes)
      expect(
        code(() =>
          dressRoom(
            nodes,
            {
              zoneIds: ['zone_salon'],
              layers: [{ kind: 'splashback', finish: '#ffffff', where: { alongRun: 'cabinet_a' } }],
            },
            context,
          ),
        ),
      ).not.toBe('no refusal')
      expect(nodes).toEqual(before)
    }
  })

  test('a fixture or cabinet on another level cannot dress this room at matching plan coordinates', () => {
    const otherLevel = LevelNode.parse({ id: 'level_other', parentId: 'building_main', level: 1 })
    const fixture = scene({ items: { item_shower: ['shower', 7.5, 2.5, 0.9, 0.9] } })
    const foreignFixture: SceneNodes = {
      ...fixture,
      [otherLevel.id]: otherLevel,
      item_shower: { ...fixture.item_shower!, parentId: otherLevel.id },
    }
    const foreignRun = scene({
      extra: [
        otherLevel,
        ...kitchenRun().map((node) =>
          node.id === 'cabinet_a' ? { ...node, parentId: otherLevel.id } : node,
        ),
      ],
    })
    for (const [nodes, input] of [
      [
        foreignFixture,
        {
          zoneIds: ['zone_bath'],
          layers: [{ kind: 'tiles', finish: '#ffffff', where: { around: ['item_shower'] } }],
        },
      ],
      [
        foreignRun,
        {
          zoneIds: ['zone_salon'],
          layers: [{ kind: 'splashback', finish: '#ffffff', where: { alongRun: 'cabinet_a' } }],
        },
      ],
    ] as [SceneNodes, DressRoomInput][]) {
      const before = structuredClone(nodes)
      expect(code(() => dressRoom(nodes, input, context))).not.toBe('no refusal')
      expect(nodes).toEqual(before)
    }
  })

  test('wet-room tiles cover the corner shower footprint plus margin, on inward faces only', () => {
    const { nodes } = run(scene({ items: { item_shower: ['shower', 7.5, 2.5, 0.9, 0.9] } }), {
      zoneIds: ['zone_bath'],
      layers: [
        {
          kind: 'tiles',
          finish: '#aaaaaa',
          to: 1.2,
          where: { walls: ['wall_p', 'wall_bn', 'wall_e'] },
        },
        {
          kind: 'tiles',
          finish: '#bbbbbb',
          to: 'full',
          where: { around: ['item_shower'], margin: 0.1 },
        },
        { kind: 'skirting', height: 0.1, where: { walls: ['wall_s'] } },
      ],
    })
    expect(regions(nodes, 'wall_p')).toEqual([expect.objectContaining({ face: 'b', v1: 1.2 })])
    for (const [id, u0, u1] of [
      ['wall_e', 1.95, 3],
      ['wall_bn', 0, 1.05],
    ] as const) {
      const around = regions(nodes, id).find((r) => r.finish === '#bbbbbb')!
      expect(around.face).toBe('a')
      expect(around.u0).toBeCloseTo(u0, 8)
      expect(around.u1).toBeCloseTo(u1, 8)
      expect(around.v1).toBeUndefined()
    }
    expect(regions(nodes, 'wall_w')).toEqual([])
    expect(wall(nodes, 'wall_s').skirting?.spans).toEqual([{ face: 'a', u0: 4, u1: 8 }])
  })

  test('fixtures away from walls or across the partition produce no wrong-side regions', () => {
    const { nodes, result } = run(
      scene({
        items: {
          item_chair: ['chair', 6, 1.5, 0.5, 0.5],
          item_sink: ['sink', 4.3, 1.5, 0.4, 0.6],
        },
      }),
      {
        zoneIds: ['zone_salon'],
        layers: [
          { kind: 'tiles', finish: '#ffffff', where: { around: ['item_chair', 'item_sink'] } },
        ],
      },
    )
    for (const id of ['wall_s', 'wall_p', 'wall_an', 'wall_w'])
      expect(regions(nodes, id)).toEqual([])
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          zoneId: 'zone_salon',
          why: expect.stringContaining('item_chair'),
        }),
        expect.objectContaining({
          zoneId: 'zone_salon',
          why: expect.stringContaining('item_sink'),
        }),
      ]),
    )
  })

  test('a splashback starts at the worktop and covers the 1.8 m run behind it', () => {
    const { nodes } = run(scene({ extra: kitchenRun() }), {
      zoneIds: ['zone_salon'],
      layers: [{ kind: 'splashback', finish: '#ffffff', where: { alongRun: 'cabinet_a' } }],
    })
    const [region] = regions(nodes, 'wall_an')
    expect(regions(nodes, 'wall_an')).toHaveLength(1)
    // Analytic dimensions: 3 × 0.6 m modules centered at x=2;
    // 0.10 plinth + 0.80 carcass + 0.02 worktop, plus 0.6 m splashback.
    expect(region?.u0).toBeCloseTo(1.1, 8)
    expect(region?.u1).toBeCloseTo(2.9, 8)
    expect(region?.v0).toBeCloseTo(0.92, 8)
    expect(region?.v1).toBeCloseTo(1.52, 8)
    expect(region?.face).toBe('a')
    expect(regions(nodes, 'wall_s')).toEqual([])
  })

  test('a run nested beneath rotated cabinet and module frames keeps its physical footprint and worktop', () => {
    const root = CabinetNode.parse({
      id: 'cabinet_root',
      parentId: 'level_0',
      position: [2, 0.2, 2.65],
      rotation: Math.PI / 2,
      children: ['cabinet-module_host'],
    })
    const host = CabinetModuleNode.parse({
      id: 'cabinet-module_host',
      parentId: root.id,
      position: [0, 0, 0],
      rotation: Math.PI / 2,
      children: ['cabinet_a'],
    })
    const nested = kitchenRun().map((node) =>
      node.id === 'cabinet_a'
        ? {
            ...node,
            parentId: host.id,
            position: [0, 0, 0] as [number, number, number],
            rotation: 0,
          }
        : node,
    )
    const { nodes } = run(scene({ extra: [root, host, ...nested] }), {
      zoneIds: ['zone_salon'],
      layers: [{ kind: 'splashback', finish: '#ffffff', where: { alongRun: 'cabinet_a' } }],
    })
    const [region] = regions(nodes, 'wall_an')
    expect(regions(nodes, 'wall_an')).toHaveLength(1)
    // Two quarter turns seat the run exactly like the flat fixture; ancestor lift
    // adds 0.20 m to its worktop. No candidate transform supplies expected bounds.
    expect(region?.u0).toBeCloseTo(1.1, 8)
    expect(region?.u1).toBeCloseTo(2.9, 8)
    expect(region?.v0).toBeCloseTo(1.12, 8)
    expect(region?.v1).toBeCloseTo(1.72, 8)
    expect(region?.face).toBe('a')
  })

  test('wall cabinets have no worktop, and ambiguous or non-item targets refuse', () => {
    const layers: [string, DressRoomInput['layers'][number]][] = [
      [
        'invalid_layer',
        { kind: 'splashback', finish: '#ffffff', where: { alongRun: 'cabinet_a' } },
      ],
      ['target_not_found', { kind: 'tiles', finish: '#ffffff', where: { around: ['wall_p'] } }],
      ['invalid_layer', { kind: 'skirting', where: { around: ['item_shower'] } }],
      ['invalid_layer', { kind: 'tiles', finish: '#ffffff', where: { margin: 0.1 } }],
      [
        'invalid_layer',
        {
          kind: 'tiles',
          finish: '#ffffff',
          where: { around: ['item_shower'], alongRun: 'cabinet_a' },
        },
      ],
    ]
    for (const [expected, layer] of layers) {
      const nodes = scene({ extra: kitchenRun('wall') })
      const before = structuredClone(nodes)
      expect(
        code(() => dressRoom(nodes, { zoneIds: ['zone_salon'], layers: [layer] }, context)),
      ).toBe(expected)
      expect(nodes).toEqual(before)
    }
  })
})
