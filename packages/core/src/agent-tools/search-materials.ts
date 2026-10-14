import { z } from 'zod'
import type { MaterialCategory, MaterialSurface } from '../material-library'

// The library's surfaces and kinds, named here so the contract stays free of the catalog it searches.
const SURFACES = [
  'floor',
  'wall',
  'ceiling',
  'roof',
  'furniture',
  'outdoor',
] as const satisfies readonly MaterialSurface[]

const KINDS = [
  'colors',
  'wood',
  'stone',
  'brick',
  'tile',
  'wallpaper',
  'concrete',
  'metal',
  'plastic',
  'fabric',
  'carpet',
  'leather',
  'roofing',
  'ground',
  'glass',
  'other',
] as const satisfies readonly MaterialCategory[]

export const searchMaterialsTool = {
  name: 'search_materials',
  title: 'Search materials',
  description:
    "Search or browse the material library (the finishes paint gives), several queries in one call: find a library material's ref here rather than guessing it. The library is Pascal's materials and those this editor holds besides (the community's, yours, your workspace's). A query's words match the words of a material's id, name and kind, building words as the library writes them (timber is wood, weatherboard is siding, render is stucco), colour words by its shade (dark, light, white, grey) and surface words (roof, wall, floor, ceiling) by what it suits. Without words, a query browses: every material of its kind, or that suits its surface (flat colours suit every one), or the whole library. Returns one group per query: each material's ref (library:<id>), name, kind, the surfaces it suits and its colour, best first (a browse by name), the words no material answers (missing), so a finish the library lacks is said, not guessed, and how many more a long browse holds (more).",
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
          kind: z.enum(KINDS).optional().describe('Only materials of this kind.'),
          surface: z
            .enum(SURFACES)
            .optional()
            .describe('Only materials that suit this surface; flat colours suit every one.'),
        }),
      )
      .min(1)
      .max(12)
      .describe('One or more searches or browses to run in one call.'),
  },
}
