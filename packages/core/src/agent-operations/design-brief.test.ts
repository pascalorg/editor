import { describe, expect, test } from 'bun:test'
import { AGENT_TOOL_CONTRACTS, type DesignBrief } from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { type AssetInput, BuildingNode, LevelNode, ZoneNode } from '../schema'
import { CATALOG_BRIEF } from './__fixtures__/design-brief-cases'
import {
  briefUnlocks,
  designBrief,
  furnishingRefusal,
  gatedByBrief,
  requireFurnishing,
} from './design-brief'
import { AGENT_OPERATIONS } from './index'
import { EMPTY_SESSION, keepInSession, parseSessionRecord } from './scene-checkpoint'
import type { AgentContext, SceneNodes } from './types'

const open = (asIs?: DesignBrief['asIs']): DesignBrief => ({
  fixed: ['a 4 by 5 m bedroom with a double bed'],
  open: ['form and finish'],
  source: 'open',
  vision: 'Oak and linen.',
  ...(asIs ? { asIs } : {}),
})

const code = (tool: string, input: unknown, brief: DesignBrief | null) =>
  furnishingRefusal(tool, input, brief)?.code ?? null

const FURNISHING = [
  ['place_items', { items: [{ assetId: 'double-bed', x: 0, z: 0 }] }],
  ['furnish_room', { roomType: 'bedroom' }],
  ['place_in_room', { assetId: 'double-bed' }],
  ['add_object', { code: 'export default 1', reason: 'a bed' }],
  ['place_design', { design: {} }],
] as const

describe('the gate before a brief', () => {
  test.each(FURNISHING)('%s is refused with the fact', (tool, input) => {
    const refusal = furnishingRefusal(tool, input, null)
    expect(refusal?.code).toBe('design_brief_required')
    expect(refusal?.message).toBe(
      "Furnishing follows the turn's design brief: design_brief records what the request fixes, what it leaves open and where objects come from; until then the catalog can be searched and viewed, not placed, and no furnishing is made.",
    )
    expect(refusal?.details).toEqual({ tool })
  })

  test('nothing else is gated: rooms, walls, openings, finishes, reads, the catalog’s search and view', () => {
    for (const tool of [
      'create_room',
      'add_wall',
      'add_door',
      'add_window',
      'paint',
      'search_materials',
      'search_assets',
      'view_assets',
      'verify_scene',
      'design_brief',
    ])
      expect(code(tool, {}, null)).toBeNull()
  })

  test('add_object that edits an object that stands places and makes nothing', () => {
    expect(code('add_object', { nodeId: 'item_abc', params: { width: 2 } }, null)).toBeNull()
  })

  test('a host that does not gate (no brief to keep) is never refused', () => {
    for (const [tool, input] of FURNISHING)
      expect(() => requireFurnishing(tool, input, undefined)).not.toThrow()
  })
})

describe('an open brief', () => {
  test.each([
      ['add_object', { code: 'export default 1' }],
    ['place_design', { design: {} }],
  ])('%s creates', (tool, input) => {
    expect(code(tool, input, open())).toBeNull()
  })

  test('place_items of a bed is refused, saying what to do', () => {
    const refusal = furnishingRefusal(
      'place_items',
      { items: [{ assetId: 'double-bed', x: 0, z: 0 }] },
      open(),
    )
    expect(refusal?.code).toBe('brief_source_open')
    expect(refusal?.message).toBe(
      "The brief left the source open: double-bed can be made with add_object or place_design (view_assets shows the catalog's for reference), or named in the brief's asIs with a reason.",
    )
    expect(refusal?.details).toMatchObject({ tool: 'place_items', pieces: ['double-bed'] })
  })

  test('every piece of the call that is not named is listed, each once', () => {
    const refusal = furnishingRefusal(
      'place_items',
      {
        items: [
          { assetId: 'double-bed', x: 0, z: 0 },
          { assetId: 'toilet', x: 1, z: 1 },
          { assetId: 'double-bed', x: 2, z: 2 },
          { assetId: 'nightstand', x: 3, z: 3 },
        ],
      },
      open([{ assetId: 'toilet', reason: 'technical equipment' }]),
    )
    expect(refusal?.details.pieces).toEqual(['double-bed', 'nightstand'])
  })

  test('a catalog piece named in asIs is placed as it is, by place_items and place_in_room', () => {
    const brief = open([{ assetId: 'toilet', reason: 'technical equipment' }])
    expect(code('place_items', { items: [{ assetId: 'toilet', x: 0, z: 0 }] }, brief)).toBeNull()
    expect(code('place_in_room', { assetId: 'toilet' }, brief)).toBeNull()
    expect(code('place_in_room', { assetId: 'bathtub' }, brief)).toBe('brief_source_open')
  })

  test('furnish_room places a whole stock set, so asIs does not open it', () => {
    const brief = open([{ assetId: 'toilet', reason: 'technical equipment' }])
    const refusal = furnishingRefusal('furnish_room', { roomType: 'bathroom' }, brief)
    expect(refusal?.code).toBe('brief_source_open')
    expect(refusal?.message).toContain("the pieces of furnish_room's stock set can be made")
  })
})

describe('a brief that names the catalog, a brand or existing pieces', () => {
  test.each([
    'catalog',
    'brand',
    'existing',
  ] as const)('%s opens the catalog and creation', (source) => {
    const brief: DesignBrief = {
      ...CATALOG_BRIEF,
      source,
      ...(source === 'brand' ? { brand: 'IKEA' } : {}),
    }
    for (const [tool, input] of FURNISHING) expect(code(tool, input, brief)).toBeNull()
  })
})

describe('run_batch', () => {
  const call = (tool: string, input: unknown) => ({ tool, input })

  test('one refused call refuses the batch whole, naming the call, whatever onRefusal says', () => {
    const calls = [call('paint', {}), call('place_design', { design: {} })]
    for (const onRefusal of ['stop', 'skip'] as const) {
      const refusal = furnishingRefusal('run_batch', { calls, onRefusal }, null)
      expect(refusal?.code).toBe('design_brief_required')
      expect(refusal?.message).toStartWith(
        "The batch's call 2 (place_design) is refused: Furnishing follows",
      )
      expect(refusal?.message).toEndWith('Nothing in the batch was applied.')
      expect(refusal?.details).toMatchObject({ index: 1, tool: 'place_design' })
    }
  })

  test('under an open brief, creation passes and a catalog placement does not', () => {
    expect(code('run_batch', { calls: [call('add_object', { code: 'x' })] }, open())).toBeNull()
    expect(code('run_batch', { calls: [call('place_in_room', { assetId: 'sofa' })] }, open())).toBe(
      'brief_source_open',
    )
  })

  test('a batch with no furnishing call is not gated', () => {
    expect(
      code('run_batch', { calls: [call('paint', {}), call('delete_node', {})] }, null),
    ).toBeNull()
  })

  test('the operation refuses before any call runs', () => {
    const run = () =>
      AGENT_OPERATIONS.run_batch(
        {},
        { calls: [{ tool: 'list_levels' }, { tool: 'place_design', input: { design: {} } }] },
        { activeLevelId: null, designBrief: null },
      )
    expect(run).toThrow(/The batch's call 2 \(place_design\)/)
  })
})

describe('design_brief', () => {
  const input = {
    fixed: ['a bedroom'],
    open: [],
    source: 'open' as const,
    vision: 'Calm.',
    asIs: [{ assetId: 'toilet', reason: 'technical equipment' }],
  }

  test('is a shared tool: contract, operation, no scene change', () => {
    expect(AGENT_TOOL_CONTRACTS.map((contract) => contract.name)).toContain('design_brief')
    const outcome = designBrief({}, input, { activeLevelId: null })
    expect(outcome.changes).toBeUndefined()
    expect(outcome.keep?.designBrief).toEqual(outcome.result.brief as DesignBrief)
  })

  test('asIs is kept only with an open source, and a brand only with a brand source', () => {
    const catalog = designBrief(
      {},
      { ...input, source: 'catalog', brand: 'IKEA' },
      { activeLevelId: null },
    )
    expect(catalog.result.brief).not.toHaveProperty('asIs')
    expect(catalog.result.brief).not.toHaveProperty('brand')
    const brand = designBrief(
      {},
      { ...input, source: 'brand', brand: ' IKEA ' },
      { activeLevelId: null },
    )
    expect(brand.result.brief).toMatchObject({ brand: 'IKEA' })
  })

  test('says what it unlocks and what stays closed', () => {
    expect(briefUnlocks(open([{ assetId: 'toilet', reason: 'r' }]))).toEqual({
      unlocks: [
        'add_object, place_design make the pieces.',
        'place_items and place_in_room place the catalog pieces named in asIs: toilet.',
      ],
      closed: [
        'furnish_room places a whole stock set.',
        'Catalog pieces not named in asIs: place_items and place_in_room refuse them; view_assets shows the catalog for reference.',
      ],
    })
    expect(briefUnlocks(CATALOG_BRIEF).closed).toEqual([])
  })

  test('a brand source with no brand is refused', () => {
    let error: unknown
    try {
      designBrief({}, { ...input, source: 'brand' }, { activeLevelId: null })
    } catch (thrown) {
      error = thrown
    }
    expect(isAgentRefusal(error) && error.code).toBe('brand_required')
  })

  test('the contract asks for at least one fixed fact and refuses an empty vision', () => {
    const contract = AGENT_TOOL_CONTRACTS.find((entry) => entry.name === 'design_brief')!
    const schema = contract.input.fixed as { safeParse: (v: unknown) => { success: boolean } }
    expect(schema.safeParse([]).success).toBe(false)
    expect((contract.input.vision as typeof schema).safeParse('').success).toBe(false)
  })
})

describe('the brief in a session', () => {
  test('the next brief replaces it, null takes it away, a keep that names none leaves it', () => {
    const first = keepInSession(EMPTY_SESSION, { designBrief: open() })
    expect(first.designBrief?.source).toBe('open')
    const second = keepInSession(first, { designBrief: CATALOG_BRIEF })
    expect(second.designBrief).toEqual(CATALOG_BRIEF)
    expect(keepInSession(second, { made: [] }).designBrief).toEqual(CATALOG_BRIEF)
    expect(keepInSession(second, { designBrief: null })).not.toHaveProperty('designBrief')
  })

  test('is read back from where a host stored it, and a stored record that is not a brief is dropped with the record', () => {
    const stored = keepInSession(EMPTY_SESSION, {
      designBrief: open([{ assetId: 'toilet', reason: 'r' }]),
    })
    expect(parseSessionRecord(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
    expect(parseSessionRecord({ ...stored, designBrief: { source: 'nope' } })).toEqual(
      EMPTY_SESSION,
    )
  })
})

describe('the owner’s bedroom: a 4 by 5 m bedroom with a double bed, two nightstands, a wardrobe', () => {
  const CATALOG: AssetInput[] = ['double-bed', 'bedside-table', 'dresser', 'closet'].map((id) => ({
    id,
    name: id,
    category: 'furniture',
    thumbnail: '/items/a/thumbnail.webp',
    src: '/items/a/model.glb',
    dimensions: [0.5, 0.5, 0.4],
  }))
  const building = BuildingNode.parse({ id: 'building_a', children: ['level_0'] })
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: building.id,
    level: 0,
    children: ['zone_a'],
  })
  const zone = ZoneNode.parse({
    id: 'zone_a',
    parentId: level.id,
    name: 'Bedroom',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 5],
      [0, 5],
    ],
  })
  const nodes = { [building.id]: building, [level.id]: level, [zone.id]: zone } as SceneNodes
  const furnish = (designBriefOf: AgentContext['designBrief']) =>
    AGENT_OPERATIONS.furnish_room(nodes, { zoneId: zone.id, roomType: 'bedroom' } as never, {
      activeLevelId: null,
      catalog: CATALOG,
      designBrief: designBriefOf,
    })

  test('furnish_room answers in one call only when the brief names the catalog', () => {
    expect(() => furnish(null)).toThrow(/design_brief records/)
    expect(() => furnish(open())).toThrow(/furnish_room's stock set/)
    const outcome = furnish({ ...CATALOG_BRIEF, source: 'brand', brand: 'IKEA' })
    expect((outcome.changes?.create ?? []).length).toBeGreaterThan(0)
  })

  test('a host that does not gate lends no brief and furnish_room runs as before', () => {
    const outcome = AGENT_OPERATIONS.furnish_room(
      nodes,
      { zoneId: zone.id, roomType: 'bedroom' } as never,
      {
        activeLevelId: null,
        catalog: CATALOG,
      },
    )
    expect((outcome.changes?.create ?? []).length).toBeGreaterThan(0)
  })

  test('gatedByBrief runs the wrapped operation untouched when the brief opens it', () => {
    let ran = 0
    const wrapped = gatedByBrief('place_design', () => {
      ran++
      return { result: { ok: true } }
    })
    wrapped({}, {}, { activeLevelId: null, designBrief: open() })
    expect(ran).toBe(1)
    expect(() => wrapped({}, {}, { activeLevelId: null, designBrief: null })).toThrow()
    expect(ran).toBe(1)
  })
})
