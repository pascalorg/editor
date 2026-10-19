import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  AGENT_TOOL_CONTRACTS,
  type DesignBrief,
  type DesignBriefInput,
  designBriefTool,
} from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { type AssetInput, BuildingNode, LevelNode, ZoneNode } from '../schema'
import { CATALOG_BRIEF, OPEN_AXES } from './__fixtures__/design-brief-cases'
import { applyAgentOutcome } from './apply-outcome'
import {
  briefUnlocks,
  designBrief,
  furnishingRefusal,
  gatedByBrief,
  isTechnicalEquipment,
  requireFurnishing,
} from './design-brief'
import { AGENT_OPERATIONS } from './index'
import { EMPTY_SESSION, keepInSession, MAX_VIEWED, parseSessionRecord } from './scene-checkpoint'
import type { AgentContext, SceneNodes } from './types'

const dressed = {
  textiles: ['linen bedding', 'two cushions'],
  light: ['two bedside lamps'],
  windows: ['linen curtains'],
  walls: ['framed art above the bed'],
  floor: ['a wool rug'],
  plants: ['a plant by the window'],
  objects: ['books on the nightstands'],
  smallFurniture: { none: 'the room is small' },
}
const nothing = (why: string) =>
  Object.fromEntries(
    ['textiles', 'light', 'windows', 'walls', 'floor', 'plants', 'objects', 'smallFurniture'].map(
      (layer) => [layer, { none: why }],
    ),
  ) as never

const open = (asIs?: DesignBrief['asIs']): DesignBriefInput => ({
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
  test.each(['catalog', 'brand', 'existing'] as const)(
    '%s opens the catalog and creation',
    (source) => {
      const brief: DesignBrief = {
        ...CATALOG_BRIEF,
        source,
        ...(source === 'brand' ? { brand: 'IKEA' } : {}),
      }
      for (const [tool, input] of FURNISHING) expect(code(tool, input, brief)).toBeNull()
    },
  )
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
    axes: OPEN_AXES,
    source: 'open' as const,
    vision: 'Calm.',
    beyond: dressed,
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

  test('the contract refuses an empty vision, and an axis is bounded with a quote or open with a design', () => {
    const contract = AGENT_TOOL_CONTRACTS.find((entry) => entry.name === 'design_brief')!
    const schema = contract.input.vision as { safeParse: (v: unknown) => { success: boolean } }
    expect(schema.safeParse('').success).toBe(false)
    const axes = contract.input.axes as typeof schema
    expect(axes.safeParse({ style: { kind: 'bounded' } }).success).toBe(false)
    expect(axes.safeParse({ style: { kind: 'open' } }).success).toBe(false)
    expect(
      axes.safeParse({ style: { kind: 'bounded', quote: 'in oak', reading: 'oak, as asked' } })
        .success,
    ).toBe(true)
    expect(axes.safeParse({ style: { kind: 'open', design: '' } }).success).toBe(true)
  })
})

describe('the brief in a session', () => {
  test('an outcome can clear the brief without a scene write', () => {
    let session = keepInSession(EMPTY_SESSION, { designBrief: open() })
    applyAgentOutcome(
      { result: {}, keep: { designBrief: null } },
      {
        getNodes: () => ({}),
        applyChanges: () => {
          throw new Error('unexpected scene write')
        },
        reconcile: () => {
          throw new Error('unexpected reconciliation')
        },
        keep: (kept) => {
          session = keepInSession(session, kept)
        },
      },
    )
    expect(session.designBrief).toBeUndefined()
  })

  test('viewing an older item again refreshes its bounded retention', () => {
    const ids = Array.from({ length: MAX_VIEWED }, (_, index) => `asset_${index}`)
    const full = keepInSession(EMPTY_SESSION, { viewed: ids })
    const refreshed = keepInSession(full, { viewed: [ids[0]!, ids[0]!] })
    const next = keepInSession(refreshed, { viewed: ['asset_new'] })
    expect(next.viewed).toHaveLength(MAX_VIEWED)
    expect(next.viewed).toContain(ids[0]!)
    expect(next.viewed).not.toContain(ids[1]!)
    expect(next.viewed?.slice(-2)).toEqual([ids[0]!, 'asset_new'])
  })

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
    axes:
      source === 'open'
        ? OPEN_AXES
        : {
            ...OPEN_AXES,
            dressing: {
              kind: 'bounded' as const,
              quote: 'catalog only',
              reading: 'the catalog, and nothing beyond it',
            },
          },
    source,
    ...(source === 'open' ? {} : { sourceQuote: 'catalog only' }),
    vision: 'Calm.',
    beyond: source === 'open' ? dressed : nothing('catalog only'),
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

describe('beyond: the dressing of the rooms, layer by layer', () => {
  const schema = z.object(designBriefTool.input)
  const base = { axes: OPEN_AXES, source: 'open', vision: 'Calm.' }
  const run = (
    beyond: unknown,
    extra: Partial<DesignBrief> = {},
    context: Partial<AgentContext> = {},
  ) => {
    try {
      return designBrief({}, { ...base, ...extra, beyond } as never, {
        activeLevelId: null,
        ...context,
      })
    } catch (error) {
      if (isAgentRefusal(error)) return error
      throw error
    }
  }

  test('is required, an object of eight layers each pieces or { none: why }', () => {
    expect(schema.safeParse(base).success).toBe(false)
    expect(schema.safeParse({ ...base, beyond: 'a rug and curtains' }).success).toBe(false)
    expect(schema.safeParse({ ...base, beyond: { ...dressed, floor: [] } }).success).toBe(false)
    expect(schema.safeParse({ ...base, beyond: { ...dressed, floor: { none: '' } } }).success).toBe(
      false,
    )
    const { floor: _floor, ...lacking } = dressed
    expect(schema.safeParse({ ...base, beyond: lacking }).success).toBe(false)
    expect(schema.safeParse({ ...base, beyond: dressed }).success).toBe(true)
    expect(schema.safeParse({ ...base, beyond: nothing('only a bed') }).success).toBe(true)
  })

  test('an open request owes six of the eight layers, the empty ones named', () => {
    const thin = run({ ...nothing('no'), floor: ['a wool rug'], light: ['a pendant'] }) as {
      code: string
      message: string
    }
    expect(thin.code).toBe('beyond_too_thin')
    expect(thin.message).toBe(
      'The request leaves the dressing open: beyond names pieces for at least 6 of its 8 layers (textiles, light, windows, walls, floor, plants, objects, small furniture); textiles, windows, walls, plants, objects, small furniture say none.',
    )
    const five = { ...dressed, objects: { none: 'no' }, plants: { none: 'no' } }
    expect((run(five) as { code: string }).code).toBe('beyond_too_thin')
    const six = { ...dressed, objects: { none: 'no' } }
    expect((run(six) as { code?: string }).code).toBeUndefined()
  })

  test('is handed back as the brief’s own list, flattened, and kept with the brief', () => {
    const outcome = run(dressed) as ReturnType<typeof designBrief>
    expect(outcome.result.dressing).toEqual([
      'linen bedding',
      'two cushions',
      'two bedside lamps',
      'linen curtains',
      'framed art above the bed',
      'a wool rug',
      'a plant by the window',
      'books on the nightstands',
    ])
    expect(outcome.keep?.designBrief?.beyond).toEqual(dressed)
  })

  test('a dressing bounded by the request’s words accepts none everywhere; the quote is checked where a message is lent, folded', () => {
    const bounded = {
      ...OPEN_AXES,
      pieces: {
        kind: 'bounded' as const,
        quote: 'only a bed',
        reading: 'a bed, and nothing else',
        extent: 'exact' as const,
      },
      dressing: {
        kind: 'bounded' as const,
        quote: 'only a bed',
        reading: 'the request limits the pieces to the bed',
      },
    }
    // Over MCP (no message lent) the quotes are required by the contract and not compared.
    expect(
      (run(nothing('only a bed'), { axes: bounded } as never) as { code?: string }).code,
    ).toBeUndefined()
    // In the chat the quote is in the person's message, whatever the case, accents and spacing.
    expect(
      (
        run(nothing('only a bed'), { axes: bounded } as never, {
          requestText: 'Une chambre, ONLY  a bed s’il te plaît',
        }) as { code?: string }
      ).code,
    ).toBeUndefined()
    const refused = run(nothing('only a bed'), { axes: bounded } as never, {
      requestText: 'a bedroom',
    }) as { code: string; message: string }
    expect(refused.code).toBe('axis_quote_not_in_request')
    expect(refused.message).toBe(
      "The pieces is bounded by the request's own words: its quote must be words of the person's message.",
    )
  })

  test('the dressing cannot be bounded by the named pieces read as a minimum; exact pieces, or words outside the pieces quote, bound it', () => {
    const pieces = (extent?: 'minimum' | 'exact') => ({
      kind: 'bounded' as const,
      quote: 'a double bed, two nightstands, a wardrobe',
      reading: 'the pieces the request names',
      ...(extent ? { extent } : {}),
    })
    const dressing = (quote: string) => ({
      kind: 'bounded' as const,
      quote,
      reading: 'bounded by those words',
    })
    const refused = run(nothing('the bed is enough'), {
      axes: { ...OPEN_AXES, pieces: pieces(), dressing: dressing('a double bed') },
    } as never) as { code: string; message: string }
    expect(refused.code).toBe('dressing_bounded_by_minimum')
    expect(refused.message).toBe(
      'The pieces the request names are a minimum: they do not bound the dressing. The dressing is bounded only by words that limit the pieces or the action.',
    )
    expect(
      (
        run(nothing('only those pieces'), {
          axes: { ...OPEN_AXES, pieces: pieces('exact'), dressing: dressing('a double bed') },
        } as never) as { code?: string }
      ).code,
    ).toBeUndefined()
    expect(
      (
        run(nothing('one lamp'), {
          axes: { ...OPEN_AXES, pieces: pieces(), dressing: dressing('add a lamp') },
        } as never) as { code?: string }
      ).code,
    ).toBeUndefined()
  })

  test('every axis is stated: an absent one is refused with the list, an open one without a design of a few words too', () => {
    const { style: _style, materials: _materials, ...lacking } = OPEN_AXES
    const missing = run(dressed, { axes: lacking } as never) as {
      code: string
      message: string
      details: { axes: string[] }
    }
    expect(missing.code).toBe('axis_missing')
    expect(missing.message).toContain('style, materials are absent')
    expect(missing.details.axes).toEqual(['style', 'materials'])
    for (const design of ['', 'oak', 'calm oak']) {
      const refused = run(dressed, {
        axes: { ...OPEN_AXES, style: { kind: 'open' as const, design } },
      } as never) as { code: string; message: string }
      expect(refused.code).toBe('axis_open_without_design')
      expect(refused.message).toBe('The style is open: say how it is designed.')
    }
    expect(
      (
        run(dressed, {
          axes: {
            ...OPEN_AXES,
            style: { kind: 'open' as const, design: 'calm oak throughout' },
          },
        } as never) as { code?: string }
      ).code,
    ).toBeUndefined()
  })

  test('a bounded axis with no words is refused, a message lent or not', () => {
    for (const quote of ['', '   ']) {
      const axes = {
        ...OPEN_AXES,
        style: { kind: 'bounded' as const, quote, reading: 'as asked' },
      }
      for (const context of [{}, { requestText: 'add a lamp next to the sofa' }]) {
        const refused = run(dressed, { axes } as never, context) as { code: string }
        expect(refused.code).toBe('axis_quote_not_in_request')
      }
    }
  })

  test('the dressing axis decides, whatever the source: catalog and dressing open still owes the layers, dressing bounded owes none', () => {
    const catalog = { source: 'catalog', sourceQuote: 'the catalog only' } as never
    expect((run(nothing('catalog'), catalog) as { code: string }).code).toBe('beyond_too_thin')
    const outcome = run(nothing('catalog only'), {
      ...catalog,
      axes: {
        ...OPEN_AXES,
        dressing: {
          kind: 'bounded' as const,
          quote: 'the catalog only',
          reading: 'the catalog, and nothing beyond it',
        },
      },
    }) as ReturnType<typeof designBrief>
    expect(outcome.result.dressing).toEqual([])
  })

  test('a brief stored with a string beyond (before the layers) still reads, with its session', () => {
    const stored = JSON.parse(
      JSON.stringify({
        ...EMPTY_SESSION,
        made: [{ id: 'wall_1', type: 'wall', levelId: null }],
        designBrief: { ...open(), beyond: 'a wool rug and a soft ceiling pendant' },
      }),
    )
    const read = parseSessionRecord(stored)
    expect(read.made).toHaveLength(1)
    expect(read.designBrief?.beyond).toBe('a wool rug and a soft ceiling pendant')
    expect(
      parseSessionRecord(
        JSON.parse(
          JSON.stringify({ ...EMPTY_SESSION, designBrief: { ...open(), beyond: dressed } }),
        ),
      ).designBrief?.beyond,
    ).toEqual(dressed)
  })
})

describe('a source other than open quotes the request', () => {
  const brief = {
    axes: OPEN_AXES,
    vision: 'Furnished.',
    beyond: dressed,
  }
  const refusalOf = (input: Record<string, unknown>, requestText?: string) => {
    try {
      designBrief({}, { ...brief, ...input } as DesignBriefInput, {
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
      { ...brief, source: 'catalog', sourceQuote: ' que du catalogue ' } as DesignBriefInput,
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

  test('a brief stored as fixed and open lists with a string beyond, before the axes, still reads, with the session’s checkpoints', () => {
    const older = open([{ assetId: 'toilet', reason: 'r' }])
    const read = parseSessionRecord(
      JSON.parse(
        JSON.stringify({
          ...EMPTY_SESSION,
          made: [{ id: 'wall_1', type: 'wall', levelId: null }],
          designBrief: older,
        }),
      ),
    )
    expect(read.made).toHaveLength(1)
    expect(read.designBrief).toMatchObject({
      fixed: older.fixed,
      open: older.open,
      beyond: older.beyond,
    })
    expect(read.designBrief?.axes).toBeUndefined()
    expect(code('place_items', { items: [{ assetId: 'double-bed' }] }, read.designBrief!)).toBe(
      'brief_source_open',
    )
  })

  test('an open brief needs no quote and keeps none', () => {
    const outcome = designBrief(
      {},
      { ...brief, source: 'open', sourceQuote: 'ignored', beyond: dressed } as DesignBriefInput,
      { activeLevelId: null, requestText: 'Build a house' },
    )
    expect(outcome.result.brief).not.toHaveProperty('sourceQuote')
  })
})
