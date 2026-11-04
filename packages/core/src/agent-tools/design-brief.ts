import { z } from 'zod'
import { ROOM_USES } from '../building/room-use'

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

const phrase = (what: string) => z.string().min(1).max(120).describe(what)

/** How a room's walls are dressed beyond a plain finish. */
export const ROOM_DRESSINGS = [
  'wainscot',
  'chairRail',
  'crown',
  'tiles-to-height',
  'tiles-full',
  'splashback',
  'accent',
] as const

export type RoomDressing = (typeof ROOM_DRESSINGS)[number]

export const roomSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .describe('The room as it is named in the scene: the zone name ("Master bedroom").'),
  use: z.enum(ROOM_USES).describe('What the room is for.'),
  // Optional in the schema so an absent line is refused by the operation, with its own code.
  distinct: z
    .string()
    .max(300)
    .optional()
    .describe(
      'One line: what sets this room apart from the other rooms of the same use, who it is for and its character.',
    ),
  finishes: z
    .object({
      floor: phrase('The floor, a short phrase.'),
      walls: phrase('The walls, a short phrase.'),
      tiled: z.boolean().describe('Whether the floor or the walls are tiled.'),
      skirting: z.boolean().describe('Whether the room has skirting.'),
      dressing: z
        .array(z.enum(ROOM_DRESSINGS))
        .max(ROOM_DRESSINGS.length)
        .optional()
        .describe(
          'How the walls are dressed beyond a plain finish; tiles-to-height is tile part way up, tiles-full tile to the ceiling, accent one face finished apart. Absent: plain walls.',
        ),
    })
    .describe("The room's finishes."),
  pieces: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(24)
    .describe('Its main pieces: furniture, fixtures, equipment, each a short phrase.'),
})

export type BriefRoom = z.infer<typeof roomSchema>

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
  'form',
  'facade',
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

/** The footprints a form can name for its plan. */
export const VOLUME_SHAPES = [
  'polygon',
  'rectangle',
  'l',
  'u',
  't',
  'h',
  'courtyard',
  'wing',
  'bay',
] as const

/** The plans a form names: a footprint, or several volumes standing apart. */
export const FORM_PLANS = [...VOLUME_SHAPES, 'detached'] as const

export type FormPlan = (typeof FORM_PLANS)[number]

/** The massing an open form states, field by field. */
export const MASSING_FIELDS = ['plan', 'volumes', 'heights'] as const

export const massingSchema = z.object({
  plan: z
    .enum(FORM_PLANS)
    .optional()
    .describe(
      'The plan shape of the whole building, rectangle; l, u, t, h (letter plans); courtyard (rooms in bars around an open court); wing (a wing at an angle to a block); bay (a rectangle with two corners cut at 45°); polygon (a free outline); detached (volumes standing apart). any plan can be composed of several volumes.',
    ),
  volumes: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('How many volumes the building is made of (blocks and wings): 1 for a single block.'),
  heights: z
    .enum(['one', 'several'])
    .optional()
    .describe(
      'one: the volumes all stand at one height. several: they stand at different heights (a taller block, lower wings).',
    ),
})

export type Massing = z.infer<typeof massingSchema>

const MASSING_TERMS =
  'plan, volumes and heights: the plan shape, how many volumes, one height or several'

/** The material families a facade's cladding is read by: what a facade unit paints on a wall face, its piers and its panels. */
export const FACADE_CLADDINGS = ['brick', 'stone', 'render', 'siding', 'wood', 'metal'] as const
/** The horizontal bands of a facade set. */
export const FACADE_BANDS = ['base', 'course', 'cornice'] as const
/** What a facade can carry besides cladding and bands, in the facade tools' own words. */
export const FACADE_ELEMENTS = [
  'corners',
  'surrounds',
  'shutters',
  'balconies',
  'entrance',
  'curtain-wall',
  'porch',
  'guard',
  'posts',
] as const
/** Whether the openings follow a regular rhythm (stacked storey over storey) or a free one. */
export const FACADE_RHYTHMS = ['regular', 'free'] as const

/** What an open facade states of its treatment, field by field. */
export const TREATMENT_FIELDS = ['cladding', 'rhythm'] as const

export const treatmentSchema = z.object({
  cladding: z
    .array(z.enum(FACADE_CLADDINGS))
    .max(FACADE_CLADDINGS.length)
    .optional()
    .describe(
      'The material families the facade is clad in: brick, stone, render, siding, wood, metal. A facade unit paints its wall face, piers and panels with them (paint.wall, piers, infill, spandrel, surround).',
    ),
  bands: z
    .array(z.enum(FACADE_BANDS))
    .max(FACADE_BANDS.length)
    .optional()
    .describe(
      'The horizontal bands of a facade set: base (the foot of the lowest storey), course (a string course at a storey line), cornice (the top). Absent: none stated.',
    ),
  elements: z
    .array(z.enum(FACADE_ELEMENTS))
    .max(FACADE_ELEMENTS.length)
    .optional()
    .describe(
      'What else the facade carries: corners (a corner chain: harpee, droite, bossage, brick, pilaster), surrounds (opening surrounds), shutters, balconies, entrance (an entrance unit on the front), curtain-wall (curtain-wall glazing). Absent: none stated.',
    ),
  rhythm: z
    .enum(FACADE_RHYTHMS)
    .optional()
    .describe(
      'regular: the openings stand aligned storey over storey, in bays. free: they are placed one by one.',
    ),
})

export type Treatment = z.infer<typeof treatmentSchema>

const TREATMENT_TERMS =
  'cladding, bands, elements and rhythm: the material families, the horizontal bands, what else it carries, regular or free openings'

const facadeAxis = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('bounded'),
      quote: z
        .string()
        .max(300)
        .describe("The person's own words that bound the facade, copied from the request."),
      reading: fact.describe('One short line: how those words bound the facade.'),
      treatment: treatmentSchema
        .optional()
        .describe(`What those words fix of the treatment (${TREATMENT_TERMS}), when they fix any.`),
    }),
    z.object({
      kind: z.literal('open'),
      design: z
        .string()
        .max(600)
        .describe(
          `How the facade is designed: the exterior identity of the house, its materials, the rhythm of its openings, its elements, at least ${AXIS_DESIGN_MIN_WORDS} words.`,
        ),
      treatment: treatmentSchema
        .optional()
        .describe(`Required: the treatment the design states (${TREATMENT_TERMS}).`),
    }),
  ])
  .describe(
    'The facade of the building: its exterior identity, as the material families it is clad in, its bands, its elements and the rhythm of its openings. Bounded by the request\'s words when they fix it ("une façade en pierre avec volets", "a black timber-clad house"), or open with a design statement and its treatment. A request that builds or changes no building exterior bounds it by its own words: the exterior stands as it is.',
  )

const formAxis = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('bounded'),
      quote: z
        .string()
        .max(300)
        .describe("The person's own words that bound the form, copied from the request."),
      reading: fact.describe('One short line: how those words bound the form.'),
      massing: massingSchema
        .optional()
        .describe(`What those words fix of the massing (${MASSING_TERMS}), when they fix any.`),
    }),
    z.object({
      kind: z.literal('open'),
      design: z
        .string()
        .max(600)
        .describe(`How the form is designed, at least ${AXIS_DESIGN_MIN_WORDS} words.`),
      massing: massingSchema
        .optional()
        .describe(`Required: the massing the design states (${MASSING_TERMS}).`),
    }),
  ])
  .describe(
    'The form of the building: its massing, as a plan shape, a number of volumes and whether they stand at different heights. Bounded by the request\'s words when they fix it ("an L-shaped house", "a single-storey bungalow"), or open with a design statement and its massing. A request that builds or changes no building (one room, a lamp) bounds it by its own words: the building stands as it is.',
  )

export const axesSchema = z
  .object({
    action: axis(
      'What the request asks to be done: add a lamp, make a bedroom, build a house.',
    ).optional(),
    size: axis('Dimensions and extents.').optional(),
    form: formAxis.optional(),
    facade: facadeAxis.optional(),
    pieces: axis(
      'The pieces and counts the request names. Usually bounded as a minimum (extent); words such as "only", "nothing else", "just", "seulement", "rien d\'autre" make it exact.',
    ).optional(),
    openings: axis(
      'Counts of windows and doors, when the request gives them: exact counts of the architecture.',
    ).optional(),
    style: axis(
      "Style and character of what is made; the building's massing is the form axis.",
    ).optional(),
    materials: axis('Materials and finishes.').optional(),
    dressing: axis(
      'What makes the space lived-in. When open, beyond carries it layer by layer; when bounded, the quote is the words that bound it and beyond may say none everywhere. The pieces the request names, read as a minimum, do not bound it.',
    ).optional(),
  })
  .describe(
    "The request read axis by axis: action, size, form, facade, pieces, openings, style, materials, dressing, each bounded (the person's words as quote, the reading in a short line) or open (a design statement saying how it is designed; the form also states its massing, the facade its treatment). The tenth axis, the source, is the source fields: open, or bounded by sourceQuote. Every axis but form and facade is stated (those two may be left out); an axis the request does not touch is open.",
  )

export type BriefAxes = z.infer<typeof axesSchema>
export type AxisReading = NonNullable<BriefAxes[BriefAxis]>

export const designBriefTool = {
  name: 'design_brief',
  title: 'Write the design brief',
  description: `The record bottom-up building keeps before furnishing: the request's design brief, written once for the whole request (piece by piece when the request invites it), the request read axis by axis (action, size, form, facade, pieces, openings, style, materials, source, dressing), each axis bounded by the person's own words or open with a design statement, a vision, and where the objects come from. It is recorded as the design record of the turn and answers with what it unlocks. It changes nothing in the scene.
Furnishings are placed or made after a brief: ${CATALOG_PLACEMENT_TOOLS.join(', ')} (the catalog's) and ${FURNISHING_CREATION_TOOLS.join(', ')} (the agent's own), also inside run_batch. Before one, search_assets and view_assets read the catalog and every other tool works as usual; rooms, walls, openings and finishes are not furnishings.
Bounded and open, in four readings. "a 4 by 5 m bedroom with a double bed, two nightstands, a wardrobe, one window, one door": action, size, form, facade, pieces (as a minimum: those pieces must be there, more may come) and openings bounded, the form and the facade by "a 4 by 5 m bedroom" (one room, no building designed); style, materials, source and dressing open. "add a lamp next to the sofa": action, form, facade and dressing bounded by "add a lamp" (one object in a room that exists, the building and its exterior stand as they are); style open, its design statement saying how this lamp is designed. "a bedroom with only a bed and a lamp": form and facade bounded by "a bedroom", pieces exact and dressing bounded by "only a bed and a lamp"; style and materials open, the bed and the lamp designed, not defaulted. "Build a house": the action bounded only by "a house"; every other axis open, the form, the facade and the dressing included, and rooms with an entry for each room.
source open: technical equipment (sanitaryware, kitchen, laundry and climate appliances) and plants are placed from the catalog (place_items, place_in_room), every other catalog piece is made (add_object, place_design), and furnish_room, which places a whole stock set, stays closed. source catalog, brand or existing: place_items, furnish_room and place_in_room are open, and the creation tools stay open for what the catalog lacks.
The form is the building's massing: a plan shape, a number of volumes, and whether the volumes stand at different heights. Open, its design statement says how the building is composed and massing states it: plan (${FORM_PLANS.join(', ')}), volumes (a count) and heights (one or several). Bounded, the person's own words fix the form ("an L-shaped house", "a single-storey bungalow") and massing may state what they fix; a request that builds or changes no building bounds it by its own words, the building standing as it is.
The facade is the exterior identity of the building: its materials, the bands and elements it carries, the rhythm of its openings. Open, its design statement says how the exterior is designed and treatment states it: cladding (${FACADE_CLADDINGS.join(', ')}), bands (${FACADE_BANDS.join(', ')}), elements (${FACADE_ELEMENTS.join(', ')}) and rhythm (${FACADE_RHYTHMS.join(' or ')}: openings stacked storey over storey, or placed one by one). Bounded, the person's own words fix the facade ("une façade en pierre avec volets", "a black timber-clad house") and treatment may state what they fix; a request that builds or changes no building exterior bounds it by its own words, the exterior standing as it is.
rooms lists the rooms the request builds or refits, when it builds or refits more than one (a single-room request or a focused edit carries none; an open form owes them): for each, name (as the scene names the room), use (${ROOM_USES.join(', ')}), distinct (one line: what sets the room apart from the other rooms of its use, who it is for and its character), finishes (floor and walls as short phrases, tiled and skirting as true or false, and dressing when its walls are dressed) and pieces (its main pieces: furniture, fixtures, equipment). Rooms of the same use are distinct rooms, each with its own distinct line.
Naming a piece (a double bed) states its function; its form, size within reason and finish are open unless the request fixes them. The pieces a request names are what the room must contain, not all it may contain: where the dressing axis is open, beyond states that design layer by layer: textiles, light, windows, walls, floor, plants, objects, small furniture, each a list of pieces or { none: why }, at least ${BEYOND_MIN_LAYERS} of the 8 layers naming pieces; where the dressing is bounded (words that limit the pieces or the action, such as "only", "nothing else", "just"), none in every layer is accepted. The pieces the request names, read as a minimum, do not bound the dressing. The answer hands the pieces back as dressing.
A source other than open is set by the request, not chosen: sourceQuote holds the person's own words that name it, at least two words naming a brand (the brief's brand), the catalog or what is already there ("IKEA furniture only", "que du catalogue", "use my existing furniture"); a request that names no source is open. The chat checks the quote against the person's message of the turn, as it checks every bounded axis's quote; over MCP, where there is no message, a source quote must still name the source and is not compared with a request, and an axis quote is not compared either.
In the chat a brief lasts for the turn; over MCP it lasts for the session. The next design_brief replaces it. Refused: axis_missing (an axis other than form and facade is absent), axis_quote_not_in_request (a bounded axis's quote is not in the person's message), axis_open_without_design (an open axis without a design statement of at least ${AXIS_DESIGN_MIN_WORDS} words), form_massing_missing (an open form without its massing: plan, volumes, heights), form_massing_inconsistent (one volume stated as detached or at several heights), facade_treatment_missing (an open facade without its treatment: cladding or elements, and rhythm), rooms_missing (an open form with no rooms), room_distinct_missing (a room without its distinct line), rooms_identical (two rooms of one use with the same distinct and the same pieces), dressing_bounded_by_minimum (the dressing bounded by words inside a pieces quote read as a minimum), brand_required (source brand without a brand name), source_quote_required (a source other than open without sourceQuote), source_not_named (the quote names no brand, catalog or existing source), source_not_in_request (the quote is not in the person's message), beyond_too_thin (dressing open, fewer than ${BEYOND_MIN_LAYERS} layers naming pieces).`,
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
    rooms: z
      .array(roomSchema)
      .max(60)
      .optional()
      .describe(
        'One entry per room the request builds or refits, when it builds or refits more than one: a single-room request or a focused edit carries none. Rooms of the same use are distinct rooms: each says what sets it apart.',
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
