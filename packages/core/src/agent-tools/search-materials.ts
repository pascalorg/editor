import { z } from 'zod'
import type { MaterialSurface } from '../material-library'

// The library's surfaces, named here so the contract stays free of the catalog it searches.
const SURFACES = [
  'floor',
  'wall',
  'ceiling',
  'roof',
  'furniture',
  'outdoor',
] as const satisfies readonly MaterialSurface[]

export const searchMaterialsTool = {
  name: 'search_materials',
  title: 'Search materials',
  description:
    "Search the material library (the finishes paint gives) by words, several queries in one call: find a library material's id here rather than guessing it. A query's words match the words of a material's id, name and kind, building words as the library writes them (timber is wood, weatherboard is siding, render is stucco), colour words by its shade (dark, light, white, grey) and surface words (roof, wall, floor, ceiling) by what it suits. Returns one group per query: each material's ref (library:<id>), name, kind, the surfaces it suits and its colour, best first, and the words no material answers (missing), so a finish the library lacks is said, not guessed.",
  input: {
    queries: z
      .array(
        z.object({
          query: z
            .string()
            .trim()
            .min(1)
            .describe('Search words, e.g. "white render", "grey metal roofing", "oak floor".'),
          surface: z
            .enum(SURFACES)
            .optional()
            .describe('Only materials that suit this surface; flat colours suit every one.'),
        }),
      )
      .min(1)
      .max(12)
      .describe('One or more searches to run in one call.'),
  },
}
