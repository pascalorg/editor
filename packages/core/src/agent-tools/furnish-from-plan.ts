import { z } from 'zod'
import { levelTarget } from './levels'
import { NodeId } from './node-id'

const pick = z.union([
  z.strictObject({
    n: z.number().int().min(1).describe('The number the marked plan shows on the piece.'),
    assetId: z
      .string()
      .min(1)
      .describe('The catalog item it is: any item of the catalog; its candidates are suggestions.'),
  }),
  z.strictObject({
    n: z.number().int().min(1),
    none: z
      .literal(true)
      .describe('No catalog item is this piece, or it is no furniture: build it with add_object.'),
  }),
])

export const furnishFromPlanTool = {
  name: 'furnish_from_plan',
  title: 'Furnish from the plan',
  description:
    "Place the furniture, fixtures and cars the plan reference draws, as catalog items. First call it without picks: it boxes and numbers each piece the plan draws (markedPlan, the plan as an image) and suggests each number's candidates from the catalog, the items its room is for first (any catalog item may be picked: search_assets finds others). Look at the plan, then call it again with its previewId and picks for the numbers to place (the others stay as they are): {n, assetId} stands that item where the piece is drawn, turned as drawn, at its catalog size; {n, none: true} skips a piece no item is (the result gives its drawn size and place for add_object). An item more than 25% larger than its drawing is refused for that pick alone (item_too_large); a smaller one is placed with a note. Rooms are the level's rooms.",
  input: {
    guideId: NodeId.optional().describe("The plan reference: by default the level's own."),
    ...levelTarget,
    picks: z.array(pick).min(1).optional().describe("Each number's item, after the preview."),
    previewId: z
      .string()
      .optional()
      .describe('From the preview: the picks apply only to the pieces it numbered.'),
  },
}
