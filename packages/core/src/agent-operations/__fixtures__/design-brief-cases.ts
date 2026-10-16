import { DESIGN_EXAMPLE } from '../../procedural-items'
import type { AssetInput } from '../../schema'
import type { DesignBrief } from '../../agent-tools/design-brief'
import type { AgentToolCase } from './cases'
import { storeysScene } from './structure-cases'

/**
 * `design_brief` and the gate it opens: placing or making furnishings follows the brief of the
 * turn (chat) or session (MCP). Written from the owner's bedroom prompt (16 Oct): a 4 by 5 m
 * bedroom with a double bed, two nightstands, a wardrobe, one window, one door, which
 * `furnish_room` once answered in one call, no brief and no view. Before a brief the catalog is
 * read, not placed; an open brief makes the pieces and places a catalog piece only as named; a
 * catalog brief places the catalog's.
 */

const piece = (id: string, name: string, functionTag: string): AssetInput => ({
  id,
  name,
  category: functionTag,
  functionTags: [functionTag],
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions: [1, 1, 1],
})
const CATALOG = [
  piece('double-bed', 'Double bed', 'double-beds'),
  piece('bedside-table', 'Bedside table', 'coffee-tables'),
  piece('closet', 'Closet', 'wardrobes'),
  piece('toilet', 'Toilet', 'toilets'),
]
const seen = (...ids: string[]) => () => ({ checkpoints: {}, made: [], viewed: ids })
const library = { activeLevelId: null, catalog: CATALOG }

const OPEN: DesignBrief = {
  fixed: ['a 4 by 5 m bedroom', 'a double bed', 'two nightstands', 'a wardrobe'],
  open: ['style and character', 'the form and finish of each piece', 'materials and finishes'],
  source: 'open',
  vision: 'A calm room of oak and linen, low furniture, the bed under the window wall.',
  beyond: 'linen bedding and curtains, a wool rug, bedside lamps, a plant by the window, framed art',
}
const OPEN_AS_IS: DesignBrief = {
  ...OPEN,
  asIs: [{ assetId: 'toilet', reason: 'technical equipment, as drawn in the catalog' }],
}
const IKEA: DesignBrief = {
  fixed: ['a 4 by 5 m bedroom', 'furniture from the IKEA range only'],
  open: ['which pieces', 'the finishes'],
  source: 'brand',
  sourceQuote: 'furniture from the IKEA range only',
  brand: 'IKEA',
  vision: 'IKEA pieces in pale birch, kept plain.',
  beyond: 'none: the request says IKEA furniture only',
}

/** A brief that opens every furnishing tool, for the tests whose subject is not the gate. */
export const CATALOG_BRIEF: DesignBrief = {
  fixed: ['the furnishings the test places'],
  open: [],
  source: 'catalog',
  sourceQuote: 'the catalog only',
  vision: "The catalog's pieces, as they are.",
  beyond: 'none: the request says the catalog only',
}

const ground = { levelId: 'level_ground' }
const sofa = { design: DESIGN_EXAMPLE, hostId: 'level_ground', position: [3, 0, 2] }
const bed = { items: [{ assetId: 'double-bed', x: 2, z: 2 }], ...ground }
const wc = { items: [{ assetId: 'toilet', x: 2, z: 2 }], ...ground }

const BEFORE = ['design_brief records what the request fixes', 'searched and viewed, not placed']
const OPEN_SOURCE = (pieceNamed: string) =>
  `The brief left the source open: ${pieceNamed} can be made with add_object or place_design (view_assets shows the catalog's for reference), or, for technical equipment, named in the brief's asIs after view_assets, with a reason.`

export const DESIGN_BRIEF_CASES: AgentToolCase[] = [
  {
    name: 'a brief is recorded as the turn’s design record, with what it unlocks',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: OPEN.fixed,
      open: OPEN.open,
      source: 'open',
      vision: OPEN.vision,
      beyond: OPEN.beyond,
      asIs: OPEN_AS_IS.asIs,
    },
    context: { ...library, session: seen('toilet') },
    readOnly: true,
    expect: {
      result: { status: 'recorded', brief: OPEN_AS_IS },
      mentions: ['add_object, place_design make the pieces', 'furnish_room places a whole stock set'],
      session: (session) => (session.designBrief?.vision === OPEN.vision ? [] : ['not kept']),
    },
  },
  {
    name: 'a brand names its range; the brief opens the catalog',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: IKEA.fixed,
      open: IKEA.open,
      source: 'brand',
      sourceQuote: IKEA.sourceQuote,
      brand: 'IKEA',
      vision: IKEA.vision,
      beyond: IKEA.beyond,
    },
    readOnly: true,
    expect: {
      result: { status: 'recorded', brief: IKEA, closed: [] },
      mentions: ['place_items, furnish_room, place_in_room place the catalog'],
    },
  },
  {
    name: 'a brand brief without a brand is refused',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: IKEA.fixed,
      open: [],
      source: 'brand',
      sourceQuote: IKEA.sourceQuote,
      vision: IKEA.vision,
      beyond: IKEA.beyond,
    },
    expect: { refusal: 'brand_required', mentions: ['IKEA'] },
  },
  {
    name: 'a source other than open without the request’s words is refused: "Build a house" does not name the catalog',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: ['A house (single-family home)'],
      open: [],
      source: 'catalog',
      vision: 'Furnished from the catalog.',
      beyond: 'none',
    },
    expect: { refusal: 'source_quote_required', mentions: ['sourceQuote', 'the person\'s own words'] },
  },
  {
    name: 'a quote the request does not hold is refused with the fact, where a person’s message is lent',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: ['A house (single-family home)'],
      open: [],
      source: 'catalog',
      sourceQuote: 'Furnished from the catalog',
      vision: 'Furnished from the catalog.',
      beyond: 'none',
    },
    context: { requestText: 'Build a house' },
    surfaces: ['core', 'chat'],
    expect: {
      refusal: 'source_not_in_request',
      mentions: ['this request names none, so its source is open'],
    },
  },
  {
    name: 'a quote the request holds opens the catalog: "IKEA furniture only" in a bedroom request',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: IKEA.fixed,
      open: [],
      source: 'brand',
      sourceQuote: 'IKEA furniture only',
      brand: 'IKEA',
      vision: IKEA.vision,
      beyond: IKEA.beyond,
    },
    context: { requestText: 'a bedroom with IKEA furniture only' },
    surfaces: ['core', 'chat'],
    readOnly: true,
    expect: { result: { status: 'recorded', brief: { source: 'brand', sourceQuote: 'IKEA furniture only' } } },
  },
  {
    name: 'view_assets records what it showed, for the brief’s asIs',
    tool: 'view_assets',
    scene: storeysScene,
    input: { ids: ['toilet'] },
    context: library,
    readOnly: true,
    expect: {
      result: {},
      session: (session) => (session.viewed?.includes('toilet') ? [] : ['not kept']),
    },
  },
  {
    name: 'an open brief naming a double bed, a bedside table and a closet as they are is refused: furniture is made',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: OPEN.fixed,
      open: OPEN.open,
      source: 'open',
      vision: OPEN.vision,
      beyond: OPEN.beyond,
      asIs: ['double-bed', 'bedside-table', 'closet'].map((assetId) => ({
        assetId,
        reason: 'fits the room',
      })),
    },
    context: { ...library, session: seen('double-bed', 'bedside-table', 'closet') },
    expect: {
      refusal: 'brief_as_is_furniture',
      mentions: [
        'Double bed is furniture: in an open brief furniture is made (add_object, place_design) or the request names a catalog source; asIs keeps technical equipment (sanitaryware, appliances).',
        'Bedside table is furniture',
        'Closet is furniture',
      ],
    },
  },
  {
    name: 'an open brief keeping a toilet not viewed is refused: look first',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: OPEN.fixed,
      open: OPEN.open,
      source: 'open',
      vision: OPEN.vision,
      beyond: OPEN.beyond,
      asIs: OPEN_AS_IS.asIs,
    },
    context: library,
    expect: {
      refusal: 'brief_as_is_not_viewed',
      mentions: ['toilet was not viewed', 'view_assets'],
    },
  },
  {
    name: 'a brief that adds nothing says so and why',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      fixed: ['a bedroom', 'catalog only'],
      open: [],
      source: 'catalog',
      sourceQuote: 'catalog only',
      vision: 'The catalog as it is.',
      beyond: 'none: the request says catalog only',
    },
    readOnly: true,
    expect: {
      result: { status: 'recorded', brief: { beyond: 'none: the request says catalog only' } },
    },
  },
  {
    name: 'before a brief, a sofa is not made',
    tool: 'place_design',
    scene: storeysScene,
    input: sofa,
    context: { designBrief: null },
    expect: { refusal: 'design_brief_required', mentions: BEFORE },
  },
  {
    name: 'before a brief, the owner’s bedroom is not furnished in one call',
    tool: 'furnish_room',
    scene: storeysScene,
    input: { roomType: 'bedroom', polygon: [[0, 0], [4, 0], [4, 5], [0, 5]], ...ground },
    context: { ...library, designBrief: null },
    expect: { refusal: 'design_brief_required', mentions: BEFORE },
  },
  {
    name: 'before a brief, a double bed is not placed',
    tool: 'place_items',
    scene: storeysScene,
    input: bed,
    context: { ...library, designBrief: null },
    expect: { refusal: 'design_brief_required', mentions: BEFORE },
  },
  {
    name: 'before a brief, place_in_room does not place either',
    tool: 'place_in_room',
    scene: storeysScene,
    input: { assetId: 'double-bed', polygon: [[0, 0], [4, 0], [4, 5], [0, 5]], ...ground },
    context: { ...library, designBrief: null },
    expect: { refusal: 'design_brief_required', mentions: BEFORE },
  },
  {
    name: 'before a brief, a design is not placed',
    tool: 'place_design',
    scene: storeysScene,
    input: { design: {}, hostId: 'level_ground', position: [1, 0, 1] },
    context: { designBrief: null },
    expect: { refusal: 'design_brief_required', mentions: BEFORE },
  },
  {
    name: 'reading the catalog is open before a brief',
    tool: 'search_assets',
    scene: storeysScene,
    input: { queries: [{ query: 'bed' }] },
    context: { ...library, designBrief: null },
    readOnly: true,
    expect: { result: {} },
  },
  {
    name: 'a batch holding one furnishing call before a brief is refused whole, whatever onRefusal says',
    tool: 'run_batch',
    scene: storeysScene,
    input: {
      calls: [
        { tool: 'list_levels' },
        { tool: 'place_design', input: sofa },
      ],
      onRefusal: 'skip',
    },
    context: { designBrief: null },
    expect: {
      refusal: 'design_brief_required',
      mentions: ["The batch's call 2 (place_design) is refused", 'Nothing in the batch was applied'],
    },
  },
  {
    name: 'an open brief: the piece is made with place_design',
    tool: 'place_design',
    scene: storeysScene,
    input: sofa,
    context: { designBrief: OPEN },
    expect: { result: { parentId: 'level_ground' } },
  },
  {
    name: 'an open brief: a double bed from the catalog is refused, with the fact',
    tool: 'place_items',
    scene: storeysScene,
    input: bed,
    context: { ...library, designBrief: OPEN },
    expect: { refusal: 'brief_source_open', mentions: [OPEN_SOURCE('double-bed')] },
  },
  {
    name: 'an open brief: furnish_room, which places a whole stock set, stays closed',
    tool: 'furnish_room',
    scene: storeysScene,
    input: { roomType: 'bedroom', polygon: [[0, 0], [4, 0], [4, 5], [0, 5]], ...ground },
    context: { ...library, designBrief: OPEN },
    expect: {
      refusal: 'brief_source_open',
      mentions: [OPEN_SOURCE("the pieces of furnish_room's stock set")],
    },
  },
  {
    name: 'an open brief: a catalog piece named in asIs is placed as it is',
    tool: 'place_items',
    scene: storeysScene,
    input: wc,
    context: { ...library, designBrief: OPEN_AS_IS },
    expect: { result: { ok: true, levelId: 'level_ground' } },
  },
  {
    name: 'an open brief: asIs lets that piece through and still refuses the others of the call',
    tool: 'place_items',
    scene: storeysScene,
    input: { items: [...wc.items, ...bed.items], ...ground },
    context: { ...library, designBrief: OPEN_AS_IS },
    expect: { refusal: 'brief_source_open', mentions: [OPEN_SOURCE('double-bed')] },
  },
  {
    name: 'a brand brief opens the catalog: the double bed is placed',
    tool: 'place_items',
    scene: storeysScene,
    input: bed,
    context: { ...library, designBrief: IKEA },
    expect: { result: { ok: true, levelId: 'level_ground' } },
  },
  {
    name: 'a brand brief leaves creation open for what the catalog lacks',
    tool: 'place_design',
    scene: storeysScene,
    input: sofa,
    context: { designBrief: IKEA },
    expect: { result: { parentId: 'level_ground' } },
  },
  {
    name: 'a batch under an open brief makes its pieces',
    tool: 'run_batch',
    scene: storeysScene,
    input: { calls: [{ tool: 'place_design', input: sofa }] },
    context: { designBrief: OPEN },
    expect: { result: { status: 'applied', applied: 1, refused: 0 } },
  },
  {
    name: 'a batch under an open brief refuses a catalog placement whole',
    tool: 'run_batch',
    scene: storeysScene,
    input: {
      calls: [
        { tool: 'place_design', input: sofa },
        { tool: 'place_in_room', input: { assetId: 'double-bed', polygon: [[0, 0], [4, 0], [4, 5], [0, 5]], ...ground } },
      ],
      onRefusal: 'skip',
    },
    context: { ...library, designBrief: OPEN },
    expect: {
      refusal: 'brief_source_open',
      mentions: ["The batch's call 2 (place_in_room) is refused", OPEN_SOURCE('double-bed')],
    },
  },
]
