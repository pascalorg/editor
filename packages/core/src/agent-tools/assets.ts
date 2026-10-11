import { z } from 'zod'

export const searchAssetsTool = {
  name: 'search_assets',
  title: 'Search assets',
  description:
    "Search the item library (furniture, fixtures, lights, plants, outdoor) by keyword, several queries in one call; call it before placing an item to get a valid asset id. A query matches the items whose name, id, category or tags hold every one of its words. Returns one group per query, each item with its id, name, category, dimensions [width, height, depth] in metres and attachTo (null on the floor, else 'wall', 'wall-side' or 'ceiling'). Batch related lookups (sofa, coffee table, tv stand) instead of separate calls.",
  input: {
    queries: z
      .array(
        z.object({
          query: z.string().min(1).describe('Search words, e.g. "sofa", "dining chair", "lamp".'),
          category: z
            .string()
            .optional()
            .describe('Only items of this category (furniture, kitchen, bathroom, outdoor, …).'),
        }),
      )
      .min(1)
      .describe('One or more searches to run in a single call.'),
  },
}
