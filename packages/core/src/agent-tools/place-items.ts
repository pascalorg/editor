import { z } from 'zod'
import { levelTarget } from './levels'
import { measurement } from './measurement'

export const placeItemsTool = {
  name: 'place_items',
  title: 'Place items',
  description:
    'Place one or more catalog items (furniture, fixtures, plants) on the floor of a level in one call; batch them rather than calling once per item. Each assetId comes from search_assets, never guessed. Positions are level (x, z) metres. Each item is placed or refused on its own (asset_not_found; outside_rooms: an indoor item outside every room of a level that has rooms — garden and outdoor items may stand outside).',
  input: {
    items: z
      .array(
        z.object({
          assetId: z.string().min(1).describe('A catalog id from search_assets.'),
          x: z.number().describe('X in level coordinates (metres).'),
          z: z.number().describe('Z in level coordinates (metres).'),
          rotation: measurement('angle', 'deg', {
            description: 'Turn about the vertical (default 0).',
          }).optional(),
        }),
      )
      .min(1)
      .max(64)
      .describe('The items to place.'),
    ...levelTarget,
  },
}
