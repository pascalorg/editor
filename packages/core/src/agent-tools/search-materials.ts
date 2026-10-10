import { z } from 'zod'

export const MATERIAL_SURFACES = [
  'roof',
  'wall',
  'floor',
  'ceiling',
  'furniture',
  'outdoor',
] as const

export const searchMaterialsTool = {
  name: 'search_materials',
  title: 'Search materials',
  description:
    "Search the material library (the finishes paint, a slot or a preset takes) by words, several queries in one call: before giving a library material, find its id here rather than guessing. A query matches a material's id, name, kind and description, building words as the library writes them (timber is wood, weatherboard is lap siding, render is stucco), colour words by its shade (dark, light, grey), and surface words (roof, wall, floor, ceiling) by what it suits. Returns one group per query: each material's ref (library:<id>), name, kind, the surfaces it suits and its colour, best first, and the words no material matches (missing), so a material the library lacks is said, not guessed.",
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
            .enum(MATERIAL_SURFACES)
            .optional()
            .describe('Only materials that suit this surface.'),
        }),
      )
      .min(1)
      .max(12)
      .describe('One or more searches to run in a single call.'),
  },
}
