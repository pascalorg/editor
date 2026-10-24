import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  CeilingNode,
  ItemNode,
  type LevelNode,
  parseNode,
  SlabNode,
  StairNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { coveredStoreyId, planRoofsOffStorey, seatRoofs, servesAsRoofLevel } from '../services'
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
} from './__fixtures__/roof-bearing-cases'
import {
  applySceneChanges,
  applySceneWrites,
  duplicateLevel,
  type NodeWrite,
  seatWrittenRoofs,
  verifyScene,
} from './index'

// The roof-level rule on the writes that name nodes and parents themselves: apply_patch (every
// MCP and the in-page Architect), the chat's update_node, a saved graph. A roof on its walls'
// storey is seated by appended operations; what the rule cannot place is refused at its index.

const SQUARE: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

/** The bungalow under its declared roof level, the roof on it. */
const underRoofLevel = (metadata: Record<string, unknown> | undefined = { role: 'roof' }) =>
  bungalow(level('level_r', 1, metadata), ...mainRoof('level_r', TOP - 3))

const refusalOf = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    const { code, message, details } = error as {
      code: string
      message: string
      details: Record<string, unknown>
    }
    return { code, message, ...details }
  }
  throw Error('not refused')
}

const creates = (...nodes: AnyNode[]): NodeWrite[] =>
  nodes.map((node) => ({ op: 'create', node, parentId: node.parentId ?? undefined }))

/** The scene the ops leave, creates parsed as the store parses them. */
const landed = (nodes: Record<string, AnyNode>, ops: NodeWrite[]) =>
  applySceneWrites(
    nodes,
    ops.map((op) => {
      if (op.op !== 'create') return op
      const parsed = parseNode(op.node)
      return { ...op, node: parsed.success ? parsed.data : op.node }
    }),
  )

const STOREY_CONTENT: [string, AnyNode][] = [
  ['wall', WallNode.parse({ id: 'wall_new', parentId: 'level_r', start: [0, 0], end: [4, 0] })],
  ['zone', ZoneNode.parse({ id: 'zone_new', parentId: 'level_r', name: 'Attic', polygon: SQUARE })],
  ['slab', SlabNode.parse({ id: 'slab_new', parentId: 'level_r', polygon: SQUARE })],
  ['ceiling', CeilingNode.parse({ id: 'ceiling_new', parentId: 'level_r', polygon: SQUARE })],
  [
    'item',
    ItemNode.parse({
      id: 'item_new',
      parentId: 'level_r',
      position: [2, 0, 1],
      asset: {
        id: 'chair',
        name: 'Chair',
        category: 'furniture',
        thumbnail: '/items/chair/thumbnail.webp',
        src: '/items/chair/model.glb',
        dimensions: [0.5, 0.9, 0.5],
      },
    }),
  ],
  ['stair', StairNode.parse({ id: 'stair_new', parentId: 'level_r', position: [2, 0, 1] })],
]

describe('seatWrittenRoofs', () => {
  test('classifying and reparenting a retained roof keeps source lineage and its world height', () => {
    const original = ItemNode.parse({
      ...STOREY_CONTENT.find(([kind]) => kind === 'item')![1],
      parentId: 'level_g',
      position: [2, 3.25, 1],
      metadata: {
        design: { originalSourceFileId: 'asset_original', mappingFileId: 'asset_map' },
        note: 'manual',
      },
    })
    const before = scene(
      ...Object.values(bungalow(level('level_r', 1, { role: 'roof' }))),
      original,
    )
    const ops: NodeWrite[] = [
      {
        op: 'update',
        id: original.id,
        data: {
          parentId: 'level_r',
          position: [2, 0.25, 1],
          metadata: { ...original.metadata, role: 'roof' },
        },
      },
    ]
    seatWrittenRoofs(ops, before)
    const after = landed(before, ops)
    const saved = after[original.id] as typeof original
    expect(saved.parentId).toBe('level_r')
    expect(saved.position[1] + 3).toBe(original.position[1])
    expect(saved.metadata.design).toEqual(original.metadata.design)
    expect(saved.metadata.note).toBe('manual')
    expect(saved.asset).toEqual(original.asset)
    const move: NodeWrite[] = [{ op: 'update', id: saved.id, data: { position: [3, 0.25, 1] } }]
    expect(() => seatWrittenRoofs(move, after)).not.toThrow()
  })

  test('legacy misplaced content still accepts unrelated metadata, but a retained roof cannot host storey content on its roof level', () => {
    const wall = { ...STOREY_CONTENT[0]![1], parentId: 'level_r' }
    const legacy = scene(...Object.values(underRoofLevel()), wall)
    expect(() =>
      seatWrittenRoofs(
        [{ op: 'update', id: wall.id, data: { metadata: { note: 'existing condition' } } }],
        legacy,
      ),
    ).not.toThrow()
    const retained = ItemNode.parse({
      ...STOREY_CONTENT.find(([kind]) => kind === 'item')![1],
      id: 'item_roof',
      metadata: { role: 'roof' },
    })
    const child = ItemNode.parse({
      ...retained,
      id: 'item_furniture',
      parentId: retained.id,
      metadata: {},
    })
    expect(
      refusalOf(() => seatWrittenRoofs(creates(retained, child), underRoofLevel())),
    ).toMatchObject({ code: 'roof_level', id: child.id })
  })

  test('retained roof geometry keeps its placement, asset and roof role through writes and duplication', () => {
    const retained = ItemNode.parse({
      ...STOREY_CONTENT.find(([kind]) => kind === 'item')![1],
      id: 'item_retained-roof',
      metadata: { role: 'roof' },
      position: [2, -0.25, 1],
      provenance: { refs: [{ ns: 'asset_source', id: 'scene.mjs#roof', role: 'primary' }] },
    })
    const nodes = bungalow(level('level_r', 1, { role: 'roof' }))
    const ops = creates(retained)
    seatWrittenRoofs(ops, nodes)
    const after = landed(nodes, ops)
    expect(after[retained.id]).toEqual(retained)
    expect(servesAsRoofLevel(after, after.level_r as LevelNode)).toBe(true)
    const report = verifyScene(after, {}, { activeLevelId: null }).result
    expect(report.levels).toContainEqual(
      expect.objectContaining({
        levelId: 'level_r',
        role: 'roof',
        content: expect.objectContaining({ items: 0, roofs: 1 }),
      }),
    )
    expect(report.issues).not.toContainEqual(
      expect.objectContaining({ type: 'roof_level_occupied' }),
    )
    const duplicate = duplicateLevel(after, { levelId: 'level_r' }, { activeLevelId: null })
    const copied = applySceneChanges(after, duplicate.changes)
    const roofLevels = Object.values(copied).filter(
      (node) => node.type === 'level' && node.metadata.role === 'roof',
    )
    expect(roofLevels).toHaveLength(2)
    expect(
      refusalOf(() =>
        seatWrittenRoofs([{ op: 'update', id: retained.id, data: { metadata: {} } }], after),
      ),
    ).toMatchObject({ code: 'roof_level' })
  })

  test('a roof name or asset category does not admit furniture, and walls cannot claim the retained roof role', () => {
    const item = ItemNode.parse({
      ...STOREY_CONTENT.find(([kind]) => kind === 'item')![1],
      name: 'Roof',
    })
    item.asset.category = 'roof'
    expect(refusalOf(() => seatWrittenRoofs(creates(item), underRoofLevel()))).toMatchObject({
      code: 'roof_level',
    })
    const wall = { ...STOREY_CONTENT[0]![1], metadata: { role: 'roof' } }
    expect(refusalOf(() => seatWrittenRoofs(creates(wall), underRoofLevel()))).toMatchObject({
      code: 'roof_level',
    })
  })

  for (const [kind, node] of STOREY_CONTENT)
    test(`a ${kind} created on the roof level is refused, naming the storey it covers`, () => {
      const refusal = refusalOf(() => seatWrittenRoofs(creates(node), underRoofLevel()))
      expect(refusal).toMatchObject({
        code: 'roof_level',
        index: 0,
        id: node.id,
        levelId: 'level_r',
        storeyId: 'level_g',
      })
      expect(refusal.message).toContain('Ground floor (level_g)')
    })

  test('a zone on a level that only holds roofs, never declared, is refused', () => {
    const zone = ZoneNode.parse({ parentId: 'level_r', name: 'Attic', polygon: SQUARE })
    expect(
      refusalOf(() => seatWrittenRoofs(creates(zone), underRoofLevel(undefined))),
    ).toMatchObject({ code: 'roof_level', storeyId: 'level_g' })
  })

  test('a slab moved onto the roof level is refused at its index', () => {
    const ops: NodeWrite[] = [
      { op: 'update', id: 'roof_main', data: { name: 'Main roof' } },
      { op: 'update', id: 'slab_g', data: { parentId: 'level_r' } },
    ]
    expect(refusalOf(() => seatWrittenRoofs(ops, underRoofLevel()))).toMatchObject({
      code: 'roof_level',
      index: 1,
      id: 'slab_g',
    })
  })

  test('a level created declared the roof level with a wall under it: the wall is refused', () => {
    const roofLevel = level('level_x', 1, { role: 'roof' })
    const wall = WallNode.parse({ parentId: 'level_x', start: [0, 0], end: [4, 0] })
    expect(refusalOf(() => seatWrittenRoofs(creates(roofLevel, wall), bungalow()))).toMatchObject({
      code: 'roof_level',
      index: 1,
      storeyId: 'level_g',
    })
  })

  test('a walled level declared the roof level is refused, naming create_roof', () => {
    const refusal = refusalOf(() =>
      seatWrittenRoofs(
        [{ op: 'update', id: 'level_g', data: { metadata: { role: 'roof' } } }],
        bungalow(),
      ),
    )
    expect(refusal).toMatchObject({ code: 'roof_level_holds_storey', index: 0, levelId: 'level_g' })
    expect(refusal.message).toContain('create_roof')
  })

  test('floor indexes putting the roof level under a storey are refused', () => {
    const nodes = bungalow(
      level('level_1', 1),
      ...mainRoof('level_r', TOP - 6),
      level('level_r', 2, { role: 'roof' }),
    )
    const ops: NodeWrite[] = [
      { op: 'update', id: 'level_r', data: { level: 1 } },
      { op: 'update', id: 'level_1', data: { level: 2 } },
    ]
    expect(refusalOf(() => seatWrittenRoofs(ops, nodes))).toMatchObject({
      code: 'roof_level_on_top',
      index: 0,
      levelId: 'level_r',
      storeyId: 'level_1',
    })
  })

  test('a storey created at the roof level’s floor index moves the roof level up over it', () => {
    const nodes = underRoofLevel()
    const ops = creates(level('level_1', 1))
    expect(seatWrittenRoofs(ops, nodes)).toEqual([
      "Floor 1 (level_r) moved up to floor index 2: a building's roof level stays above its storeys.",
    ])
    expect(ops.slice(1)).toEqual([{ op: 'update', id: 'level_r', data: { level: 2 } }])
  })

  test('a roof level created under a storey goes up over it', () => {
    const ops = creates({ ...level('level_x', 0, { role: 'roof' }), name: 'Roof' })
    expect(seatWrittenRoofs(ops, bungalow())).toEqual([
      "Roof (level_x) moved up to floor index 1: a building's roof level stays above its storeys.",
    ])
    expect(ops.slice(1)).toEqual([{ op: 'update', id: 'level_x', data: { level: 1 } }])
  })

  test('a storey created over a carport, a ground level holding only its roof on posts, leaves the carport where it is', () => {
    const carport = level('level_c', 0)
    const ops = creates(level('level_1', 1))
    expect(seatWrittenRoofs(ops, scene(building(), carport, ...portico('level_c')))).toEqual([])
    expect(ops).toHaveLength(1)
  })

  test('a roof created on its walls’ storey: a Roof level and the roof’s move are appended', () => {
    const nodes = bungalow()
    const ops = creates(...mainRoof())
    const notes = seatWrittenRoofs(ops, nodes)
    expect(notes).toHaveLength(1)
    expect(ops.slice(0, 2)).toEqual(creates(...mainRoof()))
    const [made, move] = ops.slice(2) as [
      Extract<NodeWrite, { op: 'create' }>,
      Extract<NodeWrite, { op: 'update' }>,
    ]
    expect(made.node).toMatchObject({ type: 'level', metadata: { role: 'roof' } })
    expect(move).toMatchObject({ op: 'update', id: 'roof_main', data: { parentId: made.node.id } })
    const after = landed(nodes, ops)
    expect((after[made.node.id] as LevelNode).children).toEqual(['roof_main'])
    expect((after.level_g as LevelNode).children).not.toContain('roof_main')
  })

  // The seat put a lower storey's roof on an empty storey with one built above it: that level is a
  // storey still to be built. Running the rule again, or adding a level elsewhere, leaves it there.
  test('a roof seated on the storey above, under a built one, stays put on a second pass and on a new level', () => {
    const nodes = bungalow(level('level_1', 1), level('level_2', 2), ...room('level_2', 'u'))
    const ops = creates(...mainRoof())
    seatWrittenRoofs(ops, nodes)
    const after = landed(nodes, ops)
    expect(after.roof_main!.parentId).toBe('level_1')
    const again = [...ops]
    expect(seatWrittenRoofs(again, nodes)).toEqual([])
    expect(again).toEqual(ops)
    const basement = creates(level('level_b', -1))
    expect(seatWrittenRoofs(basement, after)).toEqual([])
    expect(basement).toHaveLength(1)
  })

  test('walls redrawn on a storey holding only a lower wing’s roof, under the roof level, are not refused', () => {
    const nodes = bungalow(
      level('level_1', 1),
      ...roof(
        'roof_wing',
        'level_1',
        { position: [5, 0, 4] },
        { id: 'rseg_wing', width: 4, depth: 8 },
      ),
      level('level_r', 2, { role: 'roof' }),
    )
    const wall = WallNode.parse({ parentId: 'level_1', start: [0, 0], end: [4, 0] })
    const ops = creates(wall)
    expect(seatWrittenRoofs(ops, nodes)).toEqual([])
    expect(ops).toHaveLength(1)
  })

  test('a roof created on the roof level appends nothing', () => {
    const nodes = bungalow(level('level_r', 1, { role: 'roof' }))
    const ops = creates(...mainRoof('level_r', TOP - 3))
    expect(seatWrittenRoofs(ops, nodes)).toEqual([])
    expect(ops).toHaveLength(2)
  })
})

// Every writer, one rule: a roof on the walls of its storey ends on the level above them; a porch
// or a portico on its beams and posts stays on its storey. One table, each writer run on each roof.

const ROOFS: [string, () => Record<string, AnyNode>, () => AnyNode[], string, boolean][] = [
  ['a roof on the house’s walls', bungalow, () => mainRoof(), 'roof_main', true],
  [
    'a generated gable porch on an 8 ft house',
    bungalow8ft,
    () => gablePorch('level_g', [3.5, 6.5], 0.3),
    'roof_porch',
    false,
  ],
  [
    'a full-width gable porch flush with the side walls, its box 0.35 m into the house',
    bungalow8ft,
    () => gablePorch('level_g', [0, 10], 0.35),
    'roof_porch',
    false,
  ],
  ['a shed porch on its ledger', bungalow, () => shedPorch('level_g'), 'roof_porch', false],
  ['a portico on columns', bungalow, () => portico('level_g'), 'roof_porch', false],
  [
    'a roof following the walls, written at y 0',
    bungalow,
    () =>
      roof(
        'roof_main',
        'level_g',
        { support: 'walls', position: [5, 0, 4] },
        {
          id: 'rseg_main',
          width: 10,
          depth: 8,
        },
      ),
    'roof_main',
    true,
  ],
]

/** Where the roof ended: on the level above `storeyId`'s walls, covering it, or on `storeyId`. */
function expectPlaced(
  after: Record<string, AnyNode>,
  roofId: string,
  storeyId: string,
  seated: boolean,
) {
  const placed = after[roofId]!
  const holder = after[placed.parentId!] as LevelNode
  expect((holder.children as string[]).filter((id) => id === roofId)).toHaveLength(1)
  if (!seated) return expect(holder.id).toBe(storeyId)
  expect(servesAsRoofLevel(after, holder)).toBe(true)
  expect(coveredStoreyId(after, placed as Parameters<typeof coveredStoreyId>[1])).toBe(storeyId)
}

const context = { activeLevelId: null }

describe('every roof writer', () => {
  for (const [name, house, roofNodes, roofId, seated] of ROOFS) {
    const verdict = seated ? 'seated on the level above' : 'left on its storey'
    describe(`${name}: ${verdict}`, () => {
      test('paste, room placement and a generated build (seatRoofs on their changes)', () => {
        const nodes = house()
        const create = roofNodes().map((node) => ({ node, parentId: node.parentId ?? undefined }))
        const { changes } = seatRoofs(nodes, { create })
        expectPlaced(applySceneChanges(nodes, changes), roofId, 'level_g', seated)
      })

      test('apply_patch, update_node and a saved graph (seatWrittenRoofs on their ops)', () => {
        const nodes = house()
        const ops = creates(...roofNodes())
        seatWrittenRoofs(ops, nodes)
        expectPlaced(landed(nodes, ops), roofId, 'level_g', seated)
      })

      test('duplicate_level and the level selector: the copy’s roof', () => {
        const nodes = applySceneChanges(house(), {
          create: roofNodes().map((node) => ({ node })),
        })
        const { changes, result } = duplicateLevel(nodes, { levelId: 'level_g' }, context)
        const after = applySceneChanges(nodes, changes)
        const copied = Object.values(after).find((node) => node.type === 'roof' && !nodes[node.id])!
        expectPlaced(after, copied.id, result.newLevelId as string, seated)
        expect(Boolean(result.notes)).toBe(seated)
      })

      test('move_roofs_to_roof_level and verify_scene, on the roof written there before the rule', () => {
        const nodes = applySceneChanges(house(), {
          create: roofNodes().map((node) => ({ node })),
        })
        const move = planRoofsOffStorey(nodes, 'level_g')
        expectPlaced(
          move ? applySceneChanges(nodes, move.changes) : nodes,
          roofId,
          'level_g',
          seated,
        )
        const { issues } = verifyScene(nodes, undefined, context).result as {
          issues: { type: string }[]
        }
        expect(issues.some((issue) => issue.type === 'roof_mixed_in_storey')).toBe(seated)
      })
    })
  }
})
