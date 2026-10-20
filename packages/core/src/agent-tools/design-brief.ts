import { z } from 'zod'

/** Where a brief says the objects come from. */
export const DESIGN_BRIEF_SOURCES = ['open', 'catalog', 'brand', 'existing'] as const

/** The tools that place a catalog piece, and the ones that make a piece: what a brief opens. */
export const CATALOG_PLACEMENT_TOOLS = ['place_items', 'furnish_room', 'place_in_room'] as const
export const FURNISHING_CREATION_TOOLS = ['add_object', 'place_design'] as const

const fact = z.string().min(1).max(200)

/** The layers of the dressing `beyond` states, with how each reads in a fact. */
export const BEYOND_LAYERS = [
  ['textiles', 'textiles'],
  ['light', 'light'],
  ['windows', 'windows'],
  ['walls', 'walls'],
  ['floor', 'floor'],
  ['plants', 'plants'],
  ['objects', 'objects'],
  ['smallFurniture', 'small furniture'],
] as const

/** An open dressing owes at least this many of the layers pieces. */
export const BEYOND_MIN_LAYERS = 6

const layer = (what: string) =>
  z
    .union([
      z.array(z.string().min(1).max(120)).min(1).max(12),
      z.object({ none: z.string().min(1).max(200) }),
    ])
    .describe(
      `${what}: a list of pieces, each a short phrase naming the piece (and, for a whole home, the room or rooms), or { "none": "<why>" }.`,
    )

export const beyondSchema = z
  .object({
    textiles: layer('Bedding, throws, cushions'),
    light: layer('Lamps, pendants, sconces'),
    windows: layer('Curtains, blinds'),
    walls: layer('Art, mirrors, shelves of objects'),
    floor: layer('Rugs'),
    plants: layer('Plants'),
    objects: layer('Books, vases, trays, tableware'),
    smallFurniture: layer('A bench, a chair, a desk, a pouf'),
  })
  .describe(
    'The dressing of the rooms beyond the pieces the request names, layer by layer. An open dressing is a call to dress the rooms fully; beyond is where that design is stated.',
  )

export type Beyond = z.infer<typeof beyondSchema>

/** The pieces a layer names, or none. */
export const layerPieces = (value: Beyond[keyof Beyond]): string[] =>
  Array.isArray(value) ? value : []

/**
 * The axes of a request's creative latitude, besides the source (the `source` fields below).
 * Each is bounded, quoting the person's own words that bound it with the reading in a short
 * line, or open, with a design statement saying how it is designed. An axis the request does
 * not touch at all is open.
 */
export const BRIEF_AXES = [
  'action',
  'size',
  'pieces',
  'openings',
  'style',
  'materials',
  'dressing',
] as const

export type BriefAxis = (typeof BRIEF_AXES)[number]

/** An open axis's design statement carries at least this many words. */
export const AXIS_DESIGN_MIN_WORDS = 3

const axis = (what: string) =>
  z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('bounded'),
        quote: z
          .string()
          .max(300)
          .describe("The person's own words that bound this axis, copied from the request."),
        reading: fact.describe('One short line: how those words bound this axis.'),
        extent: z
          .enum(['minimum', 'exact'])
          .optional()
          .describe(
            'Pieces only: minimum, the named pieces must be there and more may come (the default reading), or exact, the request limits the pieces to those ("only", "nothing else").',
          ),
      }),
      z.object({
        kind: z.literal('open'),
        design: z
          .string()
          .max(600)
          .describe(`How this axis is designed, at least ${AXIS_DESIGN_MIN_WORDS} words.`),
      }),
    ])
    .describe(what)

export const axesSchema = z
  .object({
    action: axis(
      'What the request asks to be done: add a lamp, make a bedroom, build a house.',
    ).optional(),
    size: axis('Dimensions and extents.').optional(),
    pieces: axis(
      'The pieces and counts the request names. Usually bounded as a minimum (extent); words such as "only", "nothing else", "just", "seulement", "rien d\'autre" make it exact.',
    ).optional(),
    openings: axis(
      'Counts of windows and doors, when the request gives them: exact counts of the architecture.',
    ).optional(),
    style: axis('Style and form of what is made.').optional(),
    materials: axis('Materials and finishes.').optional(),
    dressing: axis(
      'What makes the space lived-in. When open, beyond carries it layer by layer; when bounded, the quote is the words that bound it and beyond may say none everywhere. The pieces the request names, read as a minimum, do not bound it.',
    ).optional(),
  })
  .describe(
    "The request read axis by axis: action, size, pieces, openings, style, materials, dressing, each bounded (the person's words as quote, the reading in a short line) or open (a design statement saying how it is designed). The eighth axis, the source, is the source fields: open, or bounded by sourceQuote. Every axis is stated; an axis the request does not touch is open.",
  )

export type BriefAxes = z.infer<typeof axesSchema>
export type AxisReading = NonNullable<BriefAxes[BriefAxis]>

export const designBriefTool = {
  name: 'design_brief',
  title: 'Write the design brief',
  description: `The design brief of the request, written once for the whole request (piece by piece when the request invites it): the request read axis by axis (action, size, pieces, openings, style, materials, source, dressing), each axis bounded by the person's own words or open with a design statement, a vision, and where the objects come from. It is recorded as the design record of the turn and answers with what it unlocks. It changes nothing in the scene.
Furnishings are placed or made after a brief: ${CATALOG_PLACEMENT_TOOLS.join(', ')} (the catalog's) and ${FURNISHING_CREATION_TOOLS.join(', ')} (the agent's own), also inside run_batch. Before one, search_assets and view_assets read the catalog and every other tool works as usual; rooms, walls, openings and finishes are not furnishings.
Bounded and open, in four readings. "a 4 by 5 m bedroom with a double bed, two nightstands, a wardrobe, one window, one door": action, size, pieces (as a minimum: those pieces must be there, more may come) and openings bounded; style, materials, source and dressing open. "add a lamp next to the sofa": action and dressing bounded by "add a lamp" (one object in a room that exists); style open, its design statement saying how this lamp is designed. "a bedroom with only a bed and a lamp": pieces exact and dressing bounded by "only a bed and a lamp"; style and materials open, the bed and the lamp designed, not defaulted. "Build a house": the action bounded only by "a house"; every other axis open, the dressing included.
source open: the pieces are made (add_object, place_design), view_assets shows the catalog's pieces for reference, and furnish_room, which places a whole stock set, stays closed. asIs keeps technical equipment only (sanitaryware, kitchen and laundry appliances, heating and similar services): each piece is named with a reason and was shown by view_assets earlier in the same turn (chat) or session (MCP); furniture is made, not kept as it is. source catalog, brand or existing: place_items, furnish_room and place_in_room are open, and the creation tools stay open for what the catalog lacks.
Naming a piece (a double bed) states its function; its form, size within reason and finish are open unless the request fixes them. The pieces a request names are what the room must contain, not all it may contain: where the dressing axis is open, beyond states that design layer by layer: textiles, light, windows, walls, floor, plants, objects, small furniture, each a list of pieces or { none: why }, at least ${BEYOND_MIN_LAYERS} of the 8 layers naming pieces; where the dressing is bounded (words that limit the pieces or the action, such as "only", "nothing else", "just"), none in every layer is accepted. The pieces the request names, read as a minimum, do not bound the dressing. The answer hands the pieces back as dressing.
A source other than open is set by the request, not chosen: sourceQuote holds the person's own words that name it, at least two words naming a brand (the brief's brand), the catalog or what is already there ("IKEA furniture only", "que du catalogue", "use my existing furniture"); a request that names no source is open. The chat checks the quote against the person's message of the turn, as it checks every bounded axis's quote; over MCP, where there is no message, a source quote must still name the source and is not compared with a request, and an axis quote is not compared either.
In the chat a brief lasts for the turn; over MCP it lasts for the session. The next design_brief replaces it. Refused: axis_missing (an axis is absent), axis_quote_not_in_request (a bounded axis's quote is not in the person's message), axis_open_without_design (an open axis without a design statement of at least ${AXIS_DESIGN_MIN_WORDS} words), dressing_bounded_by_minimum (the dressing bounded by words inside a pieces quote read as a minimum), brand_required (source brand without a brand name), source_quote_required (a source other than open without sourceQuote), source_not_named (the quote names no brand, catalog or existing source), source_not_in_request (the quote is not in the person's message), beyond_too_thin (dressing open, fewer than ${BEYOND_MIN_LAYERS} layers naming pieces).`,
  input: {
    // Optional in the schema so an absent axis is refused by the operation, with the list,
    // on every surface, rather than by each surface's own validation error.
    axes: axesSchema.optional(),
    source: z
      .enum(DESIGN_BRIEF_SOURCES)
      .describe(
        'The source axis: where the objects come from. open: the request names no source. catalog: it asks for the catalog. brand: it names a range (give brand). existing: it names pieces that already exist.',
      ),
    sourceQuote: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe(
        'Required with source catalog, brand or existing: the person\'s own words that name it (a brand, the catalog, what is already there), copied from the request ("IKEA furniture only").',
      ),
    brand: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe('The range the request names, when source is brand ("IKEA").'),
    vision: z
      .string()
      .min(1)
      .max(1200)
      .describe(
        'A few lines: the design intent for what is open (character, forms, materials, how the room is meant to feel).',
      ),
    beyond: beyondSchema,
    asIs: z
      .array(
        z.object({
          assetId: z.string().min(1).describe('The catalog id of the piece, from search_assets.'),
          reason: fact.describe('One line: why this piece stands as it is.'),
        }),
      )
      .max(24)
      .optional()
      .describe(
        'With source open: technical equipment placed unchanged (place_items, place_in_room), each piece shown by view_assets first, each with its reason. Sanitaryware, kitchen and laundry appliances, heating and similar services; furniture is made.',
      ),
  },
}

/** What the tool's call carries: `beyond` is required there. */
export type DesignBriefInput = z.infer<z.ZodObject<typeof designBriefTool.input>>

/**
 * The brief as a session keeps it. Reading is tolerant, writing is strict: a record stored before
 * `beyond` existed still reads (only the tool's input requires it), and a brief stored as
 * `fixed`/`open` lists, before the axes, still reads with them, so an older brief never costs
 * the session its checkpoints.
 */
export const DesignBriefRecord = z.object({
  ...designBriefTool.input,
  fixed: z.array(fact).min(1).max(24).optional(),
  open: z.array(fact).max(24).optional(),
  // A brief stored before the dressing had layers holds a string: it still reads.
  beyond: z.union([designBriefTool.input.beyond, z.string()]).optional(),
})

export type DesignBrief = z.infer<typeof DesignBriefRecord>
