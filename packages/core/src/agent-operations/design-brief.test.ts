import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { AGENT_TOOL_CONTRACTS, type DesignBrief, designBriefTool } from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { type AssetInput, BuildingNode, LevelNode, ZoneNode } from '../schema'
import { CATALOG_BRIEF } from './__fixtures__/design-brief-cases'
import {
  briefUnlocks,
  designBrief,
  furnishingRefusal,
  gatedByBrief,
  isTechnicalEquipment,
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
  beyond: 'none: the test places what the request names.',
  ...(asIs ? { asIs } : {}),
})

const tagged = (id: string, name: string, ...functionTags: string[]): AssetInput => ({
  id,
  name,
  category: functionTags[0]!,
  functionTags,
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions: [1, 1, 1],
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
      "The brief left the source open: double-bed can be made with add_object or place_design (view_assets shows the catalog's for reference), or, for technical equipment, named in the brief's asIs after view_assets, with a reason.",
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
    beyond: 'none: the test places what the request names.',
    asIs: [{ assetId: 'toilet', reason: 'technical equipment' }],
  }
  const seen: AgentContext = {
    activeLevelId: null,
    catalog: [tagged('toilet', 'Toilet', 'toilets')],
    session: { checkpoints: {}, made: [], viewed: ['toilet'] },
  }

  test('is a shared tool: contract, operation, no scene change', () => {
    expect(AGENT_TOOL_CONTRACTS.map((contract) => contract.name)).toContain('design_brief')
    const outcome = designBrief({}, input, seen)
    expect(outcome.changes).toBeUndefined()
    expect(outcome.keep?.designBrief).toEqual(outcome.result.brief as DesignBrief)
  })

  test('asIs is kept only with an open source, and a brand only with a brand source', () => {
    const catalog = designBrief(
      {},
      { ...input, source: 'catalog', brand: 'IKEA', sourceQuote: 'catalog only' },
      { activeLevelId: null },
    )
    expect(catalog.result.brief).not.toHaveProperty('asIs')
    expect(catalog.result.brief).not.toHaveProperty('brand')
    const brand = designBrief(
      {},
      { ...input, source: 'brand', brand: ' IKEA ', sourceQuote: 'IKEA only' },
      { activeLevelId: null },
    )
    expect(brand.result.brief).toMatchObject({ brand: 'IKEA' })
  })

  test('says what it unlocks and what stays closed', () => {
    expect(briefUnlocks(open([{ assetId: 'toilet', reason: 'r' }]))).toEqual({
      unlocks: [
        'add_object, place_design make the pieces.',
        'place_items and place_in_room place the technical equipment named in asIs: toilet.',
      ],
      closed: [
        'furnish_room places a whole stock set.',
        'Catalog pieces not named in asIs: place_items and place_in_room refuse them; view_assets shows the catalog for reference.',
        'asIs keeps technical equipment (sanitaryware, appliances); furniture is made.',
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

describe('asIs keeps technical equipment, looked at first', () => {
  const catalog = [
    tagged('double-bed', 'Double bed', 'double-beds'),
    tagged('bedside-table', 'Bedside table', 'coffee-tables'),
    tagged('closet', 'Closet', 'wardrobes'),
    tagged('toilet', 'Toilet', 'toilets'),
    tagged('fridge', 'Fridge', 'kitchen-appliances'),
  ]
  const brief = (assetIds: string[], source: 'open' | 'catalog' = 'open') => ({
    fixed: ['a bedroom'],
    open: [],
    source,
    ...(source === 'open' ? {} : { sourceQuote: 'catalog only' }),
    vision: 'Calm.',
    beyond: 'a rug, curtains, bedside lamps',
    asIs: assetIds.map((assetId) => ({ assetId, reason: 'as drawn' })),
  })
  const run = (assetIds: string[], viewed: string[], source: 'open' | 'catalog' = 'open') => {
    try {
      return designBrief({}, brief(assetIds, source), {
        activeLevelId: null,
        catalog,
        session: { checkpoints: {}, made: [], viewed },
      })
    } catch (error) {
      if (isAgentRefusal(error)) return error
      throw error
    }
  }

  test('furniture is refused as asIs, viewed or not, with a fact per piece', () => {
    const refusal = run(
      ['double-bed', 'bedside-table', 'closet'],
      ['double-bed', 'bedside-table', 'closet'],
    )
    expect(isAgentRefusal(refusal) && refusal.code).toBe('brief_as_is_furniture')
    expect((refusal as { message: string }).message).toBe(
      ['Double bed', 'Bedside table', 'Closet']
        .map(
          (name) =>
            `${name} is furniture: in an open brief furniture is made (add_object, place_design) or the request names a catalog source; asIs keeps technical equipment (sanitaryware, appliances).`,
        )
        .join(' '),
    )
  })

  test('a piece not viewed is refused, naming it and view_assets', () => {
    const refusal = run(['toilet', 'fridge'], ['fridge']) as { code: string; message: string }
    expect(refusal.code).toBe('brief_as_is_not_viewed')
    expect(refusal.message).toBe(
      'toilet was not viewed: asIs keeps a catalog piece only after view_assets showed it earlier in the same turn (chat) or session (MCP).',
    )
  })

  test('a piece never viewed because the host has no session record is refused too', () => {
    expect(
      (() => {
        try {
          designBrief({}, brief(['toilet']), { activeLevelId: null, catalog })
        } catch (error) {
          return isAgentRefusal(error) && error.code
        }
      })(),
    ).toBe('brief_as_is_not_viewed')
  })

  test('technical equipment viewed is kept, and place_items then passes', () => {
    const outcome = run(['toilet', 'fridge'], ['toilet', 'fridge']) as ReturnType<
      typeof designBrief
    >
    const kept = outcome.keep?.designBrief as DesignBrief
    expect(kept.asIs?.map((piece) => piece.assetId)).toEqual(['toilet', 'fridge'])
    expect(code('place_items', { items: [{ assetId: 'toilet', x: 0, z: 0 }] }, kept)).toBeNull()
    expect(code('place_items', { items: [{ assetId: 'double-bed', x: 0, z: 0 }] }, kept)).toBe(
      'brief_source_open',
    )
  })

  test('a catalog brief opens everything and checks no asIs', () => {
    const outcome = run(['double-bed'], [], 'catalog') as ReturnType<typeof designBrief>
    expect(outcome.result.brief).not.toHaveProperty('asIs')
    expect(
      code('place_items', { items: [{ assetId: 'double-bed' }] }, outcome.keep!.designBrief!),
    ).toBeNull()
  })

  test('technical means plumbing, appliances and services by function tag, else by category', () => {
    expect(isTechnicalEquipment(tagged('x', 'X', 'sinks', 'plumbing'))).toBe(true)
    expect(isTechnicalEquipment(tagged('x', 'X', 'utilities'))).toBe(true)
    expect(isTechnicalEquipment(tagged('x', 'X', 'climate-appliances'))).toBe(true)
    expect(isTechnicalEquipment(tagged('x', 'X', 'sofas'))).toBe(false)
    expect(isTechnicalEquipment(tagged('x', 'X', 'kitchen-appliances', 'cabinets'))).toBe(false)
    expect(isTechnicalEquipment({ category: 'toilets' })).toBe(true)
    expect(isTechnicalEquipment({ category: 'furniture' })).toBe(false)
  })

  test('view_assets records the ids it showed; the session adds, dedups and forgets them', () => {
    const outcome = AGENT_OPERATIONS.view_assets({}, { ids: ['toilet', 'fridge'] } as never, {
      activeLevelId: null,
      catalog,
    })
    expect(outcome.keep?.viewed).toEqual(['toilet', 'fridge'])
    const once = keepInSession(EMPTY_SESSION, outcome.keep!)
    const twice = keepInSession(once, { viewed: ['fridge', 'closet'] })
    expect(twice.viewed).toEqual(['toilet', 'fridge', 'closet'])
    expect(parseSessionRecord(JSON.parse(JSON.stringify(twice))).viewed).toEqual(twice.viewed)
    expect(keepInSession(twice, { viewed: null })).not.toHaveProperty('viewed')
    expect(keepInSession(twice, { made: [] }).viewed).toEqual(twice.viewed)
  })
})

describe('beyond: what is added to make the space lived-in', () => {
  const schema = z.object(designBriefTool.input)
  const base = { fixed: ['a bedroom'], open: [], source: 'open', vision: 'Calm.' }

  test('is required: an empty answer is a stated choice', () => {
    expect(schema.safeParse(base).success).toBe(false)
    expect(schema.safeParse({ ...base, beyond: '' }).success).toBe(false)
    expect(
      schema.safeParse({ ...base, beyond: 'a rug, linen curtains, a plant, framed art' }).success,
    ).toBe(true)
    expect(
      schema.safeParse({ ...base, beyond: 'none: the request says only those pieces' }).success,
    ).toBe(true)
  })

  test('is echoed in the result and kept with the brief', () => {
    const outcome = designBrief(
      {},
      { ...base, source: 'open', beyond: 'a rug and curtains' } as DesignBrief,
      { activeLevelId: null },
    )
    expect(outcome.result.brief).toMatchObject({ beyond: 'a rug and curtains' })
    expect(outcome.keep?.designBrief?.beyond).toBe('a rug and curtains')
  })
})

describe('a source other than open quotes the request', () => {
  const brief = {
    fixed: ['a house'],
    open: [],
    vision: 'Furnished.',
    beyond: 'none: the request says catalog only',
  }
  const refusalOf = (input: Record<string, unknown>, requestText?: string) => {
    try {
      designBrief({}, { ...brief, ...input } as DesignBrief, {
        activeLevelId: null,
        ...(requestText === undefined ? {} : { requestText }),
      })
    } catch (error) {
      return isAgentRefusal(error) ? error : null
    }
    return null
  }

  test('catalog, brand and existing without a quote are refused', () => {
    for (const source of ['catalog', 'brand', 'existing']) {
      const refusal = refusalOf({ source, brand: 'IKEA' }, 'Build a house')
      expect(refusal?.code).toBe('source_quote_required')
    }
  })

  test('a quote that is not in the person’s words is refused with the fact', () => {
    const refusal = refusalOf(
      { source: 'catalog', sourceQuote: 'Furnished from the catalog' },
      'Build a house',
    )
    expect(refusal?.code).toBe('source_not_in_request')
    expect(refusal?.message).toBe(
      "A source is set by the request: the brief's sourceQuote must be the person's own words naming it, a brand, the catalog or what is already there; this request names none, so its source is open.",
    )
  })

  test('a quote found in the request, whatever the case and the spacing, sets the source', () => {
    expect(
      refusalOf(
        { source: 'brand', brand: 'IKEA', sourceQuote: 'IKEA  furniture ONLY' },
        'A 4 by 5 m bedroom with\nikea furniture only, please',
      ),
    ).toBeNull()
    const outcome = designBrief(
      {},
      { ...brief, source: 'catalog', sourceQuote: ' que du catalogue ' } as DesignBrief,
      { activeLevelId: null, requestText: 'Une chambre, que du catalogue' },
    )
    expect(outcome.result.brief).toMatchObject({
      source: 'catalog',
      sourceQuote: 'que du catalogue',
    })
  })

  test('where no person’s message is lent (MCP) the quote is not compared with a request, and must still name a source', () => {
    expect(refusalOf({ source: 'catalog', sourceQuote: 'only the catalog' })).toBeNull()
    expect(refusalOf({ source: 'catalog', sourceQuote: 'a house' })?.code).toBe('source_not_named')
  })

  test('a quote in the request that names no source is refused with the fact', () => {
    const refusal = refusalOf({ source: 'catalog', sourceQuote: 'a house' }, 'Build a house')
    expect(refusal?.code).toBe('source_not_named')
    expect(refusal?.message).toBe(
      "A source is set by the request: the brief's sourceQuote must be the person's own words naming it, a brand, the catalog or what is already there; this request names none, so its source is open.",
    )
  })

  test('the quote names the brief’s own source, at least two words', () => {
    const named = (source: string, sourceQuote: string, request: string, extra = {}) =>
      refusalOf({ source, sourceQuote, ...extra }, request)?.code ?? null
    expect(
      named('brand', 'IKEA furniture only', 'a bedroom with IKEA furniture only', {
        brand: 'IKEA',
      }),
    ).toBeNull()
    expect(named('brand', 'catalog only', 'a bedroom, catalog only', { brand: 'IKEA' })).toBe(
      'source_not_named',
    )
    expect(named('catalog', 'avec le catalogue', 'meuble la chambre avec le catalogue')).toBeNull()
    expect(
      named('catalog', 'depuis la bibliothèque Pascal', 'Depuis la Bibliothèque Pascal, meuble'),
    ).toBeNull()
    expect(named('catalog', 'with a library', 'Build a house with a library')).toBe(
      'source_not_named',
    )
    expect(named('catalog', 'from the store', 'a kitchen like the one from the store')).toBe(
      'source_not_named',
    )
    expect(named('catalog', 'Pascal’s items please', "use Pascal's items please")).toBeNull()
    expect(named('catalog', 'catalog', 'a catalog')).toBe('source_not_named')
    expect(named('existing', 'garde mes meubles actuels', 'garde mes meubles actuels')).toBeNull()
    expect(named('existing', 'ce qu’il y a déjà', 'Ce qu’il y a déjà')).toBeNull()
    expect(named('existing', 'use my existing furniture', 'use my existing furniture')).toBeNull()
    expect(named('existing', 'IKEA furniture only', 'IKEA furniture only')).toBe('source_not_named')
    expect(named('existing', 'the existing house', 'add a room to the existing house')).toBe(
      'source_not_named',
    )
    expect(named('existing', 'keep it simple', 'Build a house, keep it simple')).toBe(
      'source_not_named',
    )
    expect(named('existing', 'already have a plan', 'I already have a plan')).toBe(
      'source_not_named',
    )
  })

  test('an older stored brief (no beyond) still reads, with the session’s checkpoints, and still gates', () => {
    const { beyond: _beyond, ...older } = open([{ assetId: 'toilet', reason: 'r' }])
    const stored = JSON.parse(
      JSON.stringify({
        ...EMPTY_SESSION,
        made: [{ id: 'wall_1', type: 'wall', levelId: null }],
        designBrief: older,
      }),
    )
    const read = parseSessionRecord(stored)
    expect(read.made).toHaveLength(1)
    expect(read.designBrief?.source).toBe('open')
    expect(read.designBrief?.beyond).toBeUndefined()
    expect(code('place_items', { items: [{ assetId: 'double-bed' }] }, read.designBrief!)).toBe(
      'brief_source_open',
    )
    expect(code('place_items', { items: [{ assetId: 'toilet' }] }, read.designBrief!)).toBeNull()
  })

  test('an open brief needs no quote and keeps none', () => {
    const outcome = designBrief(
      {},
      { ...brief, source: 'open', sourceQuote: 'ignored' } as DesignBrief,
      { activeLevelId: null, requestText: 'Build a house' },
    )
    expect(outcome.result.brief).not.toHaveProperty('sourceQuote')
  })
})
