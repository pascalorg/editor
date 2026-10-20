import { DESIGN_EXAMPLE } from '../../procedural-items'
import type { AssetInput } from '../../schema'
import type { Beyond, BriefAxes, DesignBrief } from '../../agent-tools/design-brief'
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

/** Seven of the eight layers name pieces: what an open request owes. */
export const DRESSED: Beyond = {
  textiles: ['linen bedding', 'two cushions'],
  light: ['two bedside lamps'],
  windows: ['linen curtains'],
  walls: ['framed art above the bed'],
  floor: ['a wool rug'],
  plants: ['a plant by the window'],
  objects: ['books on the nightstands'],
  smallFurniture: { none: 'the room is small' },
}
const DRESSING = [
  'linen bedding',
  'two cushions',
  'two bedside lamps',
  'linen curtains',
  'framed art above the bed',
  'a wool rug',
  'a plant by the window',
  'books on the nightstands',
]
/** Every layer says none, as a request that limits the pieces may. */
const nothing = (why: string): Beyond =>
  Object.fromEntries(
    ['textiles', 'light', 'windows', 'walls', 'floor', 'plants', 'objects', 'smallFurniture'].map(
      (layer) => [layer, { none: why }],
    ),
  ) as Beyond

const bounded = (quote: string, reading: string, extent?: 'minimum' | 'exact') => ({
  kind: 'bounded' as const,
  quote,
  reading,
  ...(extent ? { extent } : {}),
})
const openAxis = (design: string) => ({ kind: 'open' as const, design })

const BEDROOM_REQUEST =
  'a 4 by 5 m bedroom with a double bed, two nightstands, a wardrobe, one window, one door'

/** The owner's bedroom, read axis by axis: action, size, pieces (a minimum) and openings bounded; style, materials and dressing open. */
export const BEDROOM_AXES: BriefAxes = {
  action: bounded('a 4 by 5 m bedroom', 'one bedroom, not a house; inside it, making it is the job'),
  size: bounded('4 by 5 m', 'the room is 4 by 5 m'),
  pieces: bounded(
    'a double bed, two nightstands, a wardrobe',
    'those pieces must be there; nothing says only, so more may come',
    'minimum',
  ),
  openings: bounded('one window, one door', 'exactly one window and one door'),
  style: openAxis('each piece designed in a calm oak and linen character, not defaulted'),
  materials: openAxis('oak, linen and wool chosen for floor, walls and fabrics'),
  dressing: openAxis('the room dressed lived-in, stated in beyond layer by layer'),
}

/** "add a lamp next to the sofa": action and dressing bounded by the same words, style open. */
export const LAMP_AXES: BriefAxes = {
  action: bounded('add a lamp', 'one object added to a room that exists; no redecoration'),
  size: openAxis('the lamp sized to the sofa it stands beside'),
  pieces: bounded('a lamp', 'the one lamp the request names', 'exact'),
  openings: openAxis('no openings are touched by this addition'),
  style: openAxis('a sculptural paper lamp echoing the oak sofa'),
  materials: openAxis('paper shade and oak stem, warm against the sofa'),
  dressing: bounded('add a lamp', 'the request adds one lamp; the room is not dressed further'),
}

/** The same request in French: the quotes are the person's words, accents and case folded away. */
const LAMP_AXES_FR: BriefAxes = {
  action: bounded('Ajoute une lampe', 'un seul objet ajouté à une pièce qui existe; aucune redécoration'),
  size: openAxis('la lampe dimensionnée selon le canapé près duquel elle se tient'),
  pieces: bounded('une lampe', 'la seule lampe que la demande nomme', 'exact'),
  openings: openAxis('aucune ouverture n’est touchée par cet ajout'),
  style: openAxis('une lampe en papier sculpturale qui répond au canapé en chêne'),
  materials: openAxis('abat-jour en papier et pied en chêne, chauds contre le canapé'),
  dressing: bounded('Ajoute une lampe', 'la demande ajoute une lampe; la pièce n’est pas habillée davantage'),
}

/** Every axis open, for the briefs whose subject is the source or the gate, not the reading. */
export const OPEN_AXES: BriefAxes = {
  action: openAxis('the work the request calls for, designed as a whole'),
  size: openAxis('sizes chosen to fit the rooms they serve'),
  pieces: openAxis('the pieces each room needs, designed one by one'),
  openings: openAxis('openings placed for light and passage room by room'),
  style: openAxis('each piece designed in one calm character throughout'),
  materials: openAxis('materials and finishes chosen surface by surface'),
  dressing: openAxis('the rooms dressed lived-in, stated in beyond'),
}

const OPEN: DesignBrief = {
  axes: BEDROOM_AXES,
  source: 'open',
  vision: 'A calm room of oak and linen, low furniture, the bed under the window wall.',
  beyond: DRESSED,
}
const OPEN_AS_IS: DesignBrief = {
  ...OPEN,
  asIs: [{ assetId: 'toilet', reason: 'technical equipment, as drawn in the catalog' }],
}
const IKEA: DesignBrief = {
  axes: {
    ...OPEN_AXES,
    action: bounded('a bedroom', 'one bedroom'),
    pieces: bounded('IKEA furniture only', 'the IKEA range, and nothing else', 'exact'),
    dressing: bounded('IKEA furniture only', 'the request limits the pieces to the range'),
  },
  source: 'brand',
  sourceQuote: 'furniture from the IKEA range only',
  brand: 'IKEA',
  vision: 'IKEA pieces in pale birch, kept plain.',
  beyond: nothing('the request says IKEA furniture only'),
}

/** A brief that opens every furnishing tool, for the tests whose subject is not the gate. */
export const CATALOG_BRIEF: DesignBrief = {
  fixed: ['the furnishings the test places'],
  open: [],
  source: 'catalog',
  sourceQuote: 'the catalog only',
  vision: "The catalog's pieces, as they are.",
  beyond: nothing('the request says the catalog only'),
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
      axes: OPEN.axes,
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
      axes: IKEA.axes,
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
      axes: IKEA.axes,
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
      axes: OPEN_AXES,
      source: 'catalog',
      vision: 'Furnished from the catalog.',
      beyond: nothing('catalog'),
    },
    expect: { refusal: 'source_quote_required', mentions: ['sourceQuote', 'the person\'s own words'] },
  },
  {
    name: 'a quote the request does not hold is refused with the fact, where a person’s message is lent',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN_AXES,
      source: 'catalog',
      sourceQuote: 'Furnished from the catalog',
      vision: 'Furnished from the catalog.',
      beyond: nothing('catalog'),
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
      axes: IKEA.axes,
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
      axes: OPEN.axes,
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
      axes: OPEN.axes,
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
      axes: {
        ...OPEN_AXES,
        dressing: bounded('catalog only', 'the request limits the pieces to the catalog'),
      },
      source: 'catalog',
      sourceQuote: 'catalog only',
      vision: 'The catalog as it is.',
      beyond: nothing('the request says catalog only'),
    },
    readOnly: true,
    expect: {
      result: { status: 'recorded', brief: { beyond: nothing('the request says catalog only') } },
    },
  },
  {
    name: 'the owner’s bedroom with a two-piece beyond is refused: an open request owes the dressing, the empty layers named',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN.axes,
      source: 'open',
      vision: OPEN.vision,
      beyond: {
        ...nothing('no need'),
        floor: ['a wool rug'],
        light: ['a soft ceiling pendant'],
      },
    },
    context: { requestText: BEDROOM_REQUEST },
    expect: {
      refusal: 'beyond_too_thin',
      mentions: [
        'The request leaves the dressing open: beyond names pieces for at least 6 of its 8 layers (textiles, light, windows, walls, floor, plants, objects, small furniture); textiles, windows, walls, plants, objects, small furniture say none.',
      ],
    },
  },
  {
    name: 'the same request with the dressing stated layer by layer is recorded, each bounded axis quoting the message, and hands the dressing back',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN.axes,
      source: 'open',
      vision: OPEN.vision,
      beyond: DRESSED,
    },
    context: { requestText: BEDROOM_REQUEST },
    readOnly: true,
    expect: { result: { status: 'recorded', brief: { axes: BEDROOM_AXES }, dressing: DRESSING } },
  },
  {
    name: '"a bedroom with only a bed and a lamp": pieces exact and dressing bounded by those words, style and materials open, every layer none, is recorded',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        action: bounded('a bedroom', 'one bedroom'),
        pieces: bounded('only a bed and a lamp', 'a bed and a lamp, and nothing else', 'exact'),
        dressing: bounded('only a bed and a lamp', 'the request limits the pieces to those two'),
        style: openAxis('the bed and the lamp designed plainly in oak and paper'),
        materials: openAxis('oak, paper and plain cotton chosen for the two pieces'),
      },
      source: 'open',
      vision: 'A bed and a lamp in a plain room, both designed.',
      beyond: nothing('the request says only a bed and a lamp'),
    },
    context: { requestText: 'a bedroom with only a bed and a lamp' },
    readOnly: true,
    expect: {
      result: {
        status: 'recorded',
        brief: {
          axes: {
            pieces: { kind: 'bounded', extent: 'exact' },
            dressing: { kind: 'bounded' },
            style: { kind: 'open' },
            materials: { kind: 'open' },
          },
        },
        dressing: [],
      },
    },
  },
  {
    name: '"a bedroom with only a bed and a lamp" with the pieces left at their default reading, a minimum, cannot bound the dressing by those words',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        action: bounded('a bedroom', 'one bedroom'),
        pieces: bounded('only a bed and a lamp', 'a bed and a lamp'),
        dressing: bounded('only a bed and a lamp', 'the request limits the pieces to those two'),
      },
      source: 'open',
      vision: 'A bed and a lamp in a plain room, both designed.',
      beyond: nothing('the request says only a bed and a lamp'),
    },
    context: { requestText: 'a bedroom with only a bed and a lamp' },
    expect: { refusal: 'dressing_bounded_by_minimum' },
  },
  {
    name: 'a person’s message in French bounds the dressing by its own words: "rien d’autre" accepts none everywhere',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        pieces: bounded('un lit, rien d’autre', 'a bed and nothing else', 'exact'),
        dressing: bounded('rien d’autre', 'the request limits the pieces to the bed'),
      },
      source: 'open',
      vision: 'A bed in a plain room.',
      beyond: nothing('the request says nothing else'),
    },
    context: { requestText: 'une chambre avec un lit, rien d’autre' },
    surfaces: ['core', 'chat'],
    readOnly: true,
    expect: { result: { status: 'recorded', dressing: [] } },
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
    name: '"add a lamp next to the sofa": action and dressing bounded by "add a lamp", style open with its design, beyond none everywhere, is recorded',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: LAMP_AXES,
      source: 'open',
      vision: 'One lamp, designed for the sofa it stands beside.',
      beyond: nothing('the request adds one lamp'),
    },
    context: { requestText: 'add a lamp next to the sofa' },
    readOnly: true,
    expect: { result: { status: 'recorded', brief: { axes: LAMP_AXES }, dressing: [] } },
  },
  {
    name: '"Ajoute une lampe à côté du canapé": action and dressing bounded by "Ajoute une lampe", style open with its design, beyond none everywhere, is recorded',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: LAMP_AXES_FR,
      source: 'open',
      vision: 'Une seule lampe, dessinée pour le canapé près duquel elle se tient.',
      beyond: nothing('la demande ajoute une lampe'),
    },
    context: { requestText: 'Ajoute une lampe à côté du canapé' },
    readOnly: true,
    expect: { result: { status: 'recorded', brief: { axes: LAMP_AXES_FR }, dressing: [] } },
  },
  {
    name: 'the lamp whose pieces are read as a minimum still bounds its dressing by "add a lamp": those words are not inside the pieces quote',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...LAMP_AXES, pieces: bounded('a lamp', 'the lamp the request names', 'minimum') },
      source: 'open',
      vision: 'One lamp, designed for the sofa it stands beside.',
      beyond: nothing('the request adds one lamp'),
    },
    context: { requestText: 'add a lamp next to the sofa' },
    readOnly: true,
    expect: { result: { status: 'recorded', dressing: [] } },
  },
  {
    name: 'the lamp dressing bounded by "a lamp", words inside a pieces quote read as a minimum, is refused',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...LAMP_AXES,
        pieces: bounded('a lamp', 'the lamp the request names', 'minimum'),
        dressing: bounded('a lamp', 'the request adds a lamp'),
      },
      source: 'open',
      vision: 'One lamp, designed for the sofa it stands beside.',
      beyond: nothing('the request adds one lamp'),
    },
    context: { requestText: 'add a lamp next to the sofa' },
    expect: { refusal: 'dressing_bounded_by_minimum' },
  },
  {
    name: 'the lamp with no style axis is refused, the absent axis named',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...LAMP_AXES, style: undefined },
      source: 'open',
      vision: 'One lamp beside the sofa.',
      beyond: nothing('the request adds one lamp'),
    },
    expect: { refusal: 'axis_missing', mentions: ['style is absent'] },
  },
  {
    name: 'the lamp with style open and no design statement is refused: an open axis says how it is designed',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...LAMP_AXES, style: openAxis('') },
      source: 'open',
      vision: 'One lamp beside the sofa.',
      beyond: nothing('the request adds one lamp'),
    },
    expect: {
      refusal: 'axis_open_without_design',
      mentions: ['The style is open: say how it is designed.'],
    },
  },
  {
    name: 'a bounded axis whose quote is not in the person’s message is refused with the fact',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...LAMP_AXES, style: bounded('in brass and glass', 'brass and glass, as asked') },
      source: 'open',
      vision: 'One lamp beside the sofa.',
      beyond: nothing('the request adds one lamp'),
    },
    context: { requestText: 'add a lamp next to the sofa' },
    surfaces: ['core', 'chat'],
    expect: {
      refusal: 'axis_quote_not_in_request',
      mentions: [
        "The style is bounded by the request's own words: its quote must be words of the person's message.",
      ],
    },
  },
  {
    name: '"Build a house" with the dressing bounded by "a house" is recorded: the quote is in the message, and whether it bounds the dressing is the brief’s reading',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        action: bounded('a house', 'one house'),
        dressing: bounded('a house', 'read as the house alone, undressed'),
      },
      source: 'open',
      vision: 'A house, plainly built.',
      beyond: nothing('read as the house alone'),
    },
    context: { requestText: 'Build a house' },
    surfaces: ['core', 'chat'],
    readOnly: true,
    expect: { result: { status: 'recorded', dressing: [] } },
  },
  {
    name: 'the bedroom with the dressing bounded by "a double bed" is refused: the named pieces are a minimum and do not bound the dressing',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...BEDROOM_AXES,
        dressing: bounded('a double bed', 'the bed is the room’s dressing'),
      },
      source: 'open',
      vision: 'A bed in a plain room.',
      beyond: nothing('the bed is enough'),
    },
    context: { requestText: BEDROOM_REQUEST },
    expect: {
      refusal: 'dressing_bounded_by_minimum',
      mentions: [
        'The pieces the request names are a minimum: they do not bound the dressing. The dressing is bounded only by words that limit the pieces or the action.',
      ],
    },
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
