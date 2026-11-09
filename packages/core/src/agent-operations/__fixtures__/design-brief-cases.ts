import { DESIGN_EXAMPLE } from '../../procedural-items'
import type { AssetInput } from '../../schema'
import type {
  Beyond,
  BriefAxes,
  BriefRoom,
  DesignBrief,
  Massing,
  Treatment,
} from '../../agent-tools/design-brief'
import type { SessionRecord } from '../scene-checkpoint'
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
  piece('sofa', 'Sofa', 'sofas'),
  piece('toilet', 'Toilet', 'toilets'),
  piece('fridge', 'Fridge', 'kitchen-appliances'),
  { ...piece('palm', 'Palm', 'outdoor'), tags: ['tree', 'plant', 'garden'] },
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
/** An open facade states its treatment: what it is clad in or carries, and the rhythm of its openings. */
export const openFacade = (design: string, treatment: Treatment) => ({
  kind: 'open' as const,
  design,
  treatment,
})

/** The rooms of the house an open brief designs: two of one use, each with its own line. */
export const HOUSE_ROOMS: BriefRoom[] = [
  {
    name: 'Master bedroom',
    use: 'bedroom',
    distinct: 'the parents’ room, calm and oak, the largest, with its own bathroom',
    finishes: { floor: 'oak parquet', walls: 'limewashed white', tiled: false, skirting: true },
    pieces: ['a king bed', 'two nightstands', 'a wardrobe'],
  },
  {
    name: 'Children’s bedroom',
    use: 'bedroom',
    distinct: 'the children’s room, bright, with a desk by the window and bunk beds',
    finishes: { floor: 'cork', walls: 'pale green', tiled: false, skirting: true },
    pieces: ['bunk beds', 'a desk', 'a toy chest'],
  },
  {
    name: 'Bathroom',
    use: 'bathroom',
    distinct: 'the family bathroom, tiled floor to ceiling, a bath under the window',
    finishes: { floor: 'terrazzo tiles', walls: 'white zellige tiles', tiled: true, skirting: false },
    pieces: ['a bath', 'a double basin', 'a toilet'],
  },
]

/** An open form states its massing: the plan, the volumes, whether they stand at one height. */
export const openForm = (design: string, massing: Massing) => ({
  kind: 'open' as const,
  design,
  massing,
})

const BEDROOM_REQUEST =
  'a 4 by 5 m bedroom with a double bed, two nightstands, a wardrobe, one window, one door'

/** The owner's bedroom, read axis by axis: action, size, pieces (a minimum) and openings bounded; style, materials and dressing open. */
export const BEDROOM_AXES: BriefAxes = {
  action: bounded('a 4 by 5 m bedroom', 'one bedroom, not a house; inside it, making it is the job'),
  size: bounded('4 by 5 m', 'the room is 4 by 5 m'),
  form: bounded('a 4 by 5 m bedroom', 'one room of 4 by 5 m, a rectangle; no building is designed'),
  facade: bounded('a 4 by 5 m bedroom', 'one room: no building exterior is designed'),
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
  form: bounded('add a lamp', 'one object in a room that exists; the building stands as it is'),
  facade: bounded('add a lamp', 'one object in a room that exists; the exterior stands as it is'),
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
  form: bounded('Ajoute une lampe', 'un objet dans une pièce qui existe; le bâtiment reste tel qu’il est'),
  facade: bounded('Ajoute une lampe', 'un objet dans une pièce qui existe; l’extérieur reste tel qu’il est'),
  pieces: bounded('une lampe', 'la seule lampe que la demande nomme', 'exact'),
  openings: openAxis('aucune ouverture n’est touchée par cet ajout'),
  style: openAxis('une lampe en papier sculpturale qui répond au canapé en chêne'),
  materials: openAxis('abat-jour en papier et pied en chêne, chauds contre le canapé'),
  dressing: bounded('Ajoute une lampe', 'la demande ajoute une lampe; la pièce n’est pas habillée davantage'),
}

/** Every axis open, for the briefs whose subject is the source or the gate, not the reading. Its open form owes `rooms`: HOUSE_ROOMS. */
export const OPEN_AXES: BriefAxes = {
  action: openAxis('the work the request calls for, designed as a whole'),
  size: openAxis('sizes chosen to fit the rooms they serve'),
  form: openForm('a single block composed to fit the rooms it holds', {
    plan: 'rectangle',
    volumes: 1,
    heights: 'one',
  }),
  facade: openFacade('a plain render facade with a free rhythm of windows', {
    cladding: ['render'],
    rhythm: 'free',
  }),
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
const fridge = { items: [{ assetId: 'fridge', x: 2, z: 2 }], ...ground }
const palm = { items: [{ assetId: 'palm', x: 2, z: 2 }], ...ground }
const couch = { items: [{ assetId: 'sofa', x: 2, z: 2 }], ...ground }

const BEFORE = ['design_brief records what the request fixes', 'searched and viewed, not placed']
const OPEN_SOURCE = (pieceNamed: string) =>
  `The brief left the source open: ${pieceNamed} cannot be placed from the catalog, pieces are made.`
/** The facts the first refusal states about the making tools: which tool, with which input. */
const MAKING_TOOLS = [
  'add_object makes a piece (code, or piece for the object in words; parentId and position say where it goes)',
  'place_design places a designed piece (design, hostId, position)',
]
/** What the session holds after a refusal: the pieces already refused, read back by the next call. */
const refusedBefore = (...pieces: string[]) => (): SessionRecord => ({
  checkpoints: {},
  made: [],
  readings: { 'brief.refusedPieces': pieces },
})

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
    },
    context: library,
    readOnly: true,
    expect: {
      result: { status: 'recorded', brief: OPEN },
      mentions: [
        'add_object, place_design make the pieces',
        'furnish_room places a whole stock set',
        'place_items and place_in_room place technical equipment and plants from the catalog',
      ],
      session: (session) => (session.designBrief?.vision === OPEN.vision ? [] : ['not kept']),
    },
  },
  {
    name: 'a brand names its range; the brief opens the catalog',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: IKEA.axes,
      rooms: HOUSE_ROOMS,
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
      rooms: HOUSE_ROOMS,
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
      rooms: HOUSE_ROOMS,
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
      rooms: HOUSE_ROOMS,
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
      rooms: HOUSE_ROOMS,
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
    name: 'view_assets records what it showed in the session',
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
    name: 'a brief that adds nothing says so and why',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        dressing: bounded('catalog only', 'the request limits the pieces to the catalog'),
      },
      rooms: HOUSE_ROOMS,
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
      rooms: HOUSE_ROOMS,
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
      rooms: HOUSE_ROOMS,
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
      rooms: HOUSE_ROOMS,
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
      rooms: HOUSE_ROOMS,
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
    name: 'skip reports a missing brief per call while the batch reads still run',
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
      result: { applied: 1, refused: 1 },
      contains: { calls: [{ index: 1, tool: 'place_design', status: 'refused', code: 'design_brief_required' }] },
      mentions: BEFORE,
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
    name: 'an open brief: the first refusal says which tools make the piece and with which input',
    tool: 'place_items',
    scene: storeysScene,
    input: bed,
    context: { ...library, designBrief: OPEN },
    expect: { refusal: 'brief_source_open', mentions: MAKING_TOOLS },
  },
  {
    name: 'an open brief: the same piece refused again is answered briefly, by any placing tool',
    tool: 'place_in_room',
    scene: storeysScene,
    input: { assetId: 'double-bed', ...ground },
    context: { ...library, designBrief: OPEN, session: refusedBefore('double-bed') },
    expect: {
      refusal: 'brief_source_open',
      mentions: ["Already refused, the brief's source is open: double-bed."],
    },
  },
  {
    name: 'an open brief: a call naming a piece refused before and a new one gives the facts for the new one only',
    tool: 'place_items',
    scene: storeysScene,
    input: { items: [...couch.items, ...bed.items], ...ground },
    context: { ...library, designBrief: OPEN, session: refusedBefore('sofa') },
    expect: {
      refusal: 'brief_source_open',
      mentions: [OPEN_SOURCE('double-bed'), ' Already refused: sofa.'],
    },
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
    name: 'an open brief: a fridge and a palm are placed from the catalog',
    tool: 'place_items',
    scene: storeysScene,
    input: { items: [...fridge.items, ...palm.items], ...ground },
    context: { ...library, designBrief: OPEN },
    expect: { result: { ok: true, levelId: 'level_ground' } },
  },
  {
    name: 'an open brief: a sofa and a bed in one call are both listed in the refusal',
    tool: 'place_items',
    scene: storeysScene,
    input: { items: [...couch.items, ...bed.items], ...ground },
    context: { ...library, designBrief: OPEN },
    expect: { refusal: 'brief_source_open', mentions: [OPEN_SOURCE('sofa, double-bed')] },
  },
  {
    name: 'a brand brief opens the catalog: the toilet is placed',
    tool: 'place_items',
    scene: storeysScene,
    input: { items: [{ assetId: 'toilet', x: 2, z: 2 }], ...ground },
    context: { ...library, designBrief: IKEA },
    expect: { result: { ok: true, levelId: 'level_ground' } },
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
    name: 'skip under an open brief makes its piece and reports the refused catalog call',
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
      result: { applied: 1, refused: 1 },
      contains: { calls: [{ index: 1, tool: 'place_in_room', status: 'refused', code: 'brief_source_open' }] },
      mentions: [OPEN_SOURCE('double-bed')],
    },
  },
  {
    name: 'a brief with no form axis is recorded: form is optional',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...BEDROOM_AXES, form: undefined },
      source: 'open',
      vision: 'A calm room of oak and linen.',
      beyond: DRESSED,
    },
    expect: { result: { status: 'recorded' } },
  },
  {
    name: 'an open form with no massing is refused, the fields named',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...OPEN_AXES, form: openAxis('a house composed of volumes around a forecourt') },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A house around its forecourt.',
      beyond: DRESSED,
    },
    expect: {
      refusal: 'form_massing_missing',
      mentions: ['plan, volumes, heights are absent'],
    },
  },
  {
    name: 'an open form that states only its plan is refused for the fields it leaves out',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        form: openForm('a house composed of volumes around a forecourt', { plan: 'u' }),
      },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A house around its forecourt.',
      beyond: DRESSED,
    },
    expect: { refusal: 'form_massing_missing', mentions: ['volumes, heights are absent'] },
  },
  {
    name: 'a form of one volume stated as detached is refused',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        form: openForm('a house composed of volumes around a forecourt', {
          plan: 'detached',
          volumes: 1,
          heights: 'one',
        }),
      },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A house around its forecourt.',
      beyond: DRESSED,
    },
    expect: { refusal: 'form_massing_inconsistent', mentions: ['one volume cannot be detached'] },
  },
  {
    name: '"Build a house" with the form open states its massing and is recorded with it',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        form: openForm('a two-storey body with a lower wing at each end, around a forecourt', {
          plan: 'u',
          volumes: 3,
          heights: 'several',
        }),
      },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A house around its forecourt.',
      beyond: DRESSED,
    },
    expect: {
      result: {
        status: 'recorded',
        brief: {
          axes: {
            form: { kind: 'open', massing: { plan: 'u', volumes: 3, heights: 'several' } },
          },
        },
      },
    },
  },
  {
    name: '"an L-shaped house" bounds the form by the person’s words, the plan they fix stated',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        action: bounded('an L-shaped house', 'a house, L-shaped'),
        form: { ...bounded('an L-shaped house', 'the plan is an L'), massing: { plan: 'l' } },
      },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'An L-shaped house around a terrace.',
      beyond: DRESSED,
    },
    context: { requestText: 'Build me an L-shaped house' },
    expect: {
      result: {
        status: 'recorded',
        brief: { axes: { form: { kind: 'bounded', massing: { plan: 'l' } } } },
      },
    },
  },
  {
    name: 'a form bounded by words that are not in the person’s message is refused',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...OPEN_AXES, form: bounded('a U-shaped house', 'the plan is a U') },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A house around its forecourt.',
      beyond: DRESSED,
    },
    context: { requestText: 'Build me a house' },
    surfaces: ['core', 'chat'],
    expect: { refusal: 'axis_quote_not_in_request' },
  },
  {
    name: 'an open form owes its rooms: a house with none is refused',
    tool: 'design_brief',
    scene: storeysScene,
    input: { axes: OPEN_AXES, source: 'open', vision: 'A calm house.', beyond: DRESSED },
    expect: { refusal: 'rooms_missing', mentions: ['rooms lists each room it builds'] },
  },
  {
    name: 'an open form with an empty list of rooms is refused too',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN_AXES,
      rooms: [],
      source: 'open',
      vision: 'A calm house.',
      beyond: DRESSED,
    },
    expect: { refusal: 'rooms_missing' },
  },
  {
    name: 'a room with no distinct line is refused, the room named',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN_AXES,
      rooms: [HOUSE_ROOMS[0], { ...HOUSE_ROOMS[1], distinct: undefined }],
      source: 'open',
      vision: 'A calm house.',
      beyond: DRESSED,
    },
    expect: { refusal: 'room_distinct_missing', mentions: ['The room "Children’s bedroom"'] },
  },
  {
    name: 'a room whose distinct line is blank is refused like one with none',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN_AXES,
      rooms: [{ ...HOUSE_ROOMS[0], distinct: '   ' }],
      source: 'open',
      vision: 'A calm house.',
      beyond: DRESSED,
    },
    expect: { refusal: 'room_distinct_missing' },
  },
  {
    name: 'two rooms of one use with the same distinct line and the same pieces, in any order, are refused as copies',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN_AXES,
      rooms: [
        HOUSE_ROOMS[0],
        {
          ...HOUSE_ROOMS[0],
          name: 'Guest bedroom',
          distinct: HOUSE_ROOMS[0]!.distinct!.toUpperCase(),
          pieces: [...HOUSE_ROOMS[0]!.pieces].reverse(),
        },
      ],
      source: 'open',
      vision: 'A calm house.',
      beyond: DRESSED,
    },
    expect: {
      refusal: 'rooms_identical',
      mentions: ['The rooms "Master bedroom" and "Guest bedroom" are of one use'],
    },
  },
  {
    name: 'two rooms of one use with the same distinct line but their own pieces are recorded: anything subtler is a finding at the end of the turn',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN_AXES,
      rooms: [
        HOUSE_ROOMS[0],
        { ...HOUSE_ROOMS[0], name: 'Guest bedroom', pieces: ['a sofa bed', 'a reading chair'] },
      ],
      source: 'open',
      vision: 'A calm house.',
      beyond: DRESSED,
    },
    expect: { result: { status: 'recorded', brief: { rooms: [{ name: 'Master bedroom' }, { name: 'Guest bedroom' }] } } },
  },
  {
    name: 'a focused refit of two rooms bounds the form by its words and still lists the rooms: they are kept with the brief',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: LAMP_AXES,
      rooms: [HOUSE_ROOMS[0], HOUSE_ROOMS[2]],
      source: 'open',
      vision: 'Two rooms refitted.',
      beyond: nothing('the request refits two rooms'),
    },
    context: { requestText: 'add a lamp next to the sofa' },
    expect: {
      result: { status: 'recorded', brief: { rooms: [{ use: 'bedroom' }, { use: 'bathroom' }] } },
      session: (session) =>
        session.designBrief?.rooms?.length === 2 ? [] : ['the rooms were not kept with the brief'],
    },
  },
  {
    name: 'a brief with no facade axis is recorded: facade is optional',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...BEDROOM_AXES, facade: undefined },
      source: 'open',
      vision: 'A calm room of oak and linen.',
      beyond: DRESSED,
    },
    expect: { result: { status: 'recorded' } },
  },
  {
    name: 'an open facade with no treatment is refused, the fields named',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: { ...OPEN_AXES, facade: openAxis('a stone manor with shuttered windows') },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A manor.',
      beyond: DRESSED,
    },
    expect: {
      refusal: 'facade_treatment_missing',
      mentions: ['Absent: cladding or elements, rhythm.'],
    },
  },
  {
    name: 'an open facade that states cladding but no rhythm is refused for the rhythm',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        facade: openFacade('a stone manor with shuttered windows', { cladding: ['stone'] }),
      },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A manor.',
      beyond: DRESSED,
    },
    expect: { refusal: 'facade_treatment_missing', mentions: ['Absent: rhythm.'] },
  },
  {
    name: 'an open facade that states a rhythm but carries nothing is refused too',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        facade: openFacade('a stone manor with shuttered windows', { rhythm: 'regular' }),
      },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A manor.',
      beyond: DRESSED,
    },
    expect: { refusal: 'facade_treatment_missing', mentions: ['Absent: cladding or elements.'] },
  },
  {
    name: '"Build a house" with the facade open states its treatment and is recorded with it',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        facade: openFacade('a stone facade dressed with quoins, its windows shuttered', {
          cladding: ['stone'],
          bands: ['base', 'cornice'],
          elements: ['corners', 'shutters'],
          rhythm: 'regular',
        }),
      },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A manor.',
      beyond: DRESSED,
    },
    expect: {
      result: {
        status: 'recorded',
        brief: {
          axes: {
            facade: {
              kind: 'open',
              treatment: { cladding: ['stone'], rhythm: 'regular' },
            },
          },
        },
      },
    },
  },
  {
    name: '"une façade en pierre avec volets" bounds the facade by the person’s words, the treatment they fix stated',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: {
        ...OPEN_AXES,
        facade: {
          ...bounded('une façade en pierre avec volets', 'stone and shutters'),
          treatment: { cladding: ['stone'], elements: ['shutters'] },
        },
      },
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A stone house.',
      beyond: DRESSED,
    },
    context: { requestText: 'Construis-moi une maison avec une façade en pierre avec volets' },
    expect: {
      result: {
        status: 'recorded',
        brief: { axes: { facade: { kind: 'bounded', treatment: { cladding: ['stone'] } } } },
      },
    },
  },
  {
    name: 'rooms of one use announced apart carry no finding',
    tool: 'design_brief',
    scene: storeysScene,
    input: {
      axes: OPEN_AXES,
      rooms: HOUSE_ROOMS,
      source: 'open',
      vision: 'A house.',
      beyond: DRESSED,
    },
    expect: {
      result: { status: 'recorded' },
      check: (result) => ('findings' in result ? ['findings carried'] : []),
    },
  },
]
