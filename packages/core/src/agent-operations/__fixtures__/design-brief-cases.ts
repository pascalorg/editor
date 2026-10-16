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

const piece = (id: string, name: string, category: string): AssetInput => ({
  id,
  name,
  category,
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions: [1, 1, 1],
})
const CATALOG = [
  piece('double-bed', 'Double bed', 'beds'),
  piece('toilet', 'Toilet', 'bathroom'),
]
const library = { activeLevelId: null, catalog: CATALOG }

const OPEN: DesignBrief = {
  fixed: ['a 4 by 5 m bedroom', 'a double bed', 'two nightstands', 'a wardrobe'],
  open: ['style and character', 'the form and finish of each piece', 'materials and finishes'],
  source: 'open',
  vision: 'A calm room of oak and linen, low furniture, the bed under the window wall.',
}
const OPEN_AS_IS: DesignBrief = {
  ...OPEN,
  asIs: [{ assetId: 'toilet', reason: 'technical equipment, as drawn in the catalog' }],
}
const IKEA: DesignBrief = {
  fixed: ['a 4 by 5 m bedroom', 'furniture from the IKEA range only'],
  open: ['which pieces', 'the finishes'],
  source: 'brand',
  brand: 'IKEA',
  vision: 'IKEA pieces in pale birch, kept plain.',
}

/** A brief that opens every furnishing tool, for the tests whose subject is not the gate. */
export const CATALOG_BRIEF: DesignBrief = {
  fixed: ['the furnishings the test places'],
  open: [],
  source: 'catalog',
  vision: "The catalog's pieces, as they are.",
}

const ground = { levelId: 'level_ground' }
const sofa = { design: DESIGN_EXAMPLE, hostId: 'level_ground', position: [3, 0, 2] }
const bed = { items: [{ assetId: 'double-bed', x: 2, z: 2 }], ...ground }
const wc = { items: [{ assetId: 'toilet', x: 2, z: 2 }], ...ground }

const BEFORE = ['design_brief records what the request fixes', 'searched and viewed, not placed']
const OPEN_SOURCE = (pieceNamed: string) =>
  `The brief left the source open: ${pieceNamed} can be made with add_object or place_design (view_assets shows the catalog's for reference), or named in the brief's asIs with a reason.`

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
      asIs: OPEN_AS_IS.asIs,
    },
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
    input: { fixed: IKEA.fixed, open: IKEA.open, source: 'brand', brand: 'IKEA', vision: IKEA.vision },
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
    input: { fixed: IKEA.fixed, open: [], source: 'brand', vision: IKEA.vision },
    expect: { refusal: 'brand_required', mentions: ['IKEA'] },
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
