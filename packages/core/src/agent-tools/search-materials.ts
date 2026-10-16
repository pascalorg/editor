import { z } from 'zod'
import { MATERIAL_CATEGORIES, MATERIAL_SURFACES } from '../material-kinds'

export const searchMaterialsTool = {
  name: 'search_materials',
  title: 'Search materials',
  description:
    "Search or browse the material library (the finishes paint gives), several queries in one call: find a library material's ref here rather than guessing it. The library is Pascal's materials and, in the editor, the ones it holds besides (the community's, yours, your workspace's). A query's words match the words of a material's id, name and kind, or a piece of its id (plank48, cco), building words as the library writes them (timber is wood, weatherboard is siding, render is stucco), colour words by its shade (dark, light, white, grey) and surface words (roof, wall, floor, ceiling) by what it suits; a word of one or two letters, or one as common as 'the', searches nothing. Without a query, a browse lists by name every material of its kind, or that suits its surface (flat colours suit every one), or the whole library. Returns one group per query: each material's ref (library:<id>), name, kind, the surfaces it suits and its colour, best first (a browse by name), 12 at a time for a search and 150 for a browse; the words no material answers (missing), so a finish the library lacks is said, not guessed; and on a long list how many more there are (more) and the offset that lists them (next).",
  input: {
    queries: z
      .array(
        z.object({
          query: z
            .string()
            .trim()
            .optional()
            .describe(
              'Search words, e.g. "white render", "grey metal roofing", "oak floor"; leave them out to browse.',
            ),
          kind: z.enum(MATERIAL_CATEGORIES).optional().describe('Only materials of this kind.'),
          surface: z
            .enum(MATERIAL_SURFACES)
            .optional()
            .describe('Only materials that suit this surface; flat colours suit every one.'),
          offset: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('The next page of a long search or browse: the next it returned.'),
        }),
      )
      .min(1)
      .max(12)
      .describe('One or more searches or browses to run in one call.'),
  },
}
