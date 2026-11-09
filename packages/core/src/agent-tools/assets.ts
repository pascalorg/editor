import { z } from 'zod'

/** Results per query when a search names no limit, and the most it may ask for. */
export const SEARCH_ASSETS_LIMIT = 24
export const SEARCH_ASSETS_MAX_LIMIT = 60

export const searchAssetsTool = {
  name: 'search_assets',
  title: 'Search assets',
  description: `Search the item library (furniture, fixtures, lights, plants, outdoor) by keyword, with one or several queries in a call. The catalog is a limited set that varies by server: what a search returns is what exists. Results provide valid asset ids and placement facts when these are not already known. A query matches the items whose name, id, category or tags hold every one of its words. Returns one group per query, best matches first (the name exactly, then words of the name, words starting it, the category, a tag), at most limit items (${SEARCH_ASSETS_LIMIT} unless set, up to ${SEARCH_ASSETS_MAX_LIMIT}); total counts every match and truncated says the limit cut some, with a hint on how to narrow. Each item has its id, name, category, dimensions [width, height, depth] in metres and attachTo (null on the floor, else 'wall', 'wall-side' or 'ceiling'). Related lookups (sofa, coffee table, tv stand) can share a call.`,
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
    limit: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_ASSETS_MAX_LIMIT)
      .optional()
      .describe(
        `Most items per query, best first; ${SEARCH_ASSETS_LIMIT} unless set. Narrowing a query beats raising this.`,
      ),
  },
}

export const viewAssetsTool = {
  name: 'view_assets',
  title: 'View catalog items',
  description:
    'Pictures of catalog items by id, each with its size and the names of its paintable surfaces (paint takes one as role).',
  input: {
    ids: z
      .array(z.string().min(1))
      .min(1)
      .max(6)
      .describe('One to six catalog item ids, as search_assets or furnish_room returned them.'),
  },
}
