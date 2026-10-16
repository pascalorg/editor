import { z } from 'zod'

/** Where a brief says the objects come from. */
export const DESIGN_BRIEF_SOURCES = ['open', 'catalog', 'brand', 'existing'] as const

/** The tools that place a catalog piece, and the ones that make a piece: what a brief opens. */
export const CATALOG_PLACEMENT_TOOLS = ['place_items', 'furnish_room', 'place_in_room'] as const
export const FURNISHING_CREATION_TOOLS = ['add_object', 'place_design'] as const

const fact = z.string().min(1).max(200)

export const designBriefTool = {
  name: 'design_brief',
  title: 'Write the design brief',
  description: `The design brief of the request, written once for the whole request (piece by piece when the request invites it): what the request fixes, what it leaves open and where the objects come from. It is recorded as the design record of the turn and answers with what it unlocks. It changes nothing in the scene.
Furnishings are placed or made after a brief: ${CATALOG_PLACEMENT_TOOLS.join(', ')} (the catalog's) and ${FURNISHING_CREATION_TOOLS.join(', ')} (the agent's own), also inside run_batch. Before one, search_assets and view_assets read the catalog and every other tool works as usual; rooms, walls, openings and finishes are not furnishings.
source open: the pieces are made (add_object, place_design), view_assets shows the catalog's pieces for reference, a catalog piece is placed unchanged only when named in asIs with a reason, and furnish_room, which places a whole stock set, stays closed. source catalog, brand or existing: place_items, furnish_room and place_in_room are open, and the creation tools stay open for what the catalog lacks.
Naming a piece (a double bed) states its function; its form, size within reason and finish are open unless the request fixes them.
In the chat a brief lasts for the turn; over MCP it lasts for the session. The next design_brief replaces it. Refused: brand_required (source brand without a brand name).`,
  input: {
    fixed: z
      .array(fact)
      .min(1)
      .max(24)
      .describe(
        'What the request states, one short fact each: the programme, sizes, pieces it names as functions (a double bed, a WC), a source it imposes, a style it names.',
      ),
    open: z
      .array(fact)
      .max(24)
      .describe(
        'What the request leaves to the agent, one short fact each: style and character, the form and finish of each piece, materials and finishes, light, decor.',
      ),
    source: z
      .enum(DESIGN_BRIEF_SOURCES)
      .describe(
        'Where the objects come from. open: the request names no source. catalog: it asks for the catalog. brand: it names a range (give brand). existing: it names pieces that already exist.',
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
        'With source open: the catalog pieces placed unchanged (place_items, place_in_room), each with its reason.',
      ),
  },
}

/** The brief as a session keeps it: the contract's own schema, so a stored record is read as a call is. */
export const DesignBriefRecord = z.object(designBriefTool.input)

export type DesignBrief = z.infer<typeof DesignBriefRecord>
