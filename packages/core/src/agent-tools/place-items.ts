import { z } from 'zod'
import { levelTarget } from './levels'
import { measurement } from './measurement'
import { NodeId } from './node-id'

export const placeItemsTool = {
  name: 'place_items',
  title: 'Place items',
  description:
    'Place one or more catalog items (furniture, fixtures, plants, art, lights) in one call; batch them rather than calling once per item. Each assetId comes from search_assets, never guessed. Positions are level (x, z) metres. An item stands on the floor of the level, or on the host it names (targetNodeId): a wall (art, a sconce: y is the height of its bottom above the floor, required; it goes on the side of the wall the point is on), a ceiling (a pendant, a downlight: it hangs flush under it), or an item standing on the floor (a lamp on a nightstand: it rests on its top; on an object built with add_object it rests on the real surface under the point, such as a porch landing, or a ceiling item hangs from the underside above it, such as a sloped vault, and the result names it in restingOn). A room, a slab or a level as the target means its floor. Each item is placed or refused on its own (asset_not_found; outside_rooms: an indoor item on the floor outside every room of a level that has rooms — garden and outdoor items may stand outside; height_required, item_too_tall, unsupported_host, host_not_found, host_not_on_level).',
  input: {
    items: z
      .array(
        z.object({
          assetId: z.string().min(1).describe('A catalog id from search_assets.'),
          x: z.number().describe('X in level coordinates (metres).'),
          z: z.number().describe('Z in level coordinates (metres).'),
          y: z
            .number()
            .optional()
            .describe(
              "Height above the floor (metres): on a wall, of the item's bottom (required: art centred at eye level is 1.5 − its height / 2, a sconce about 1.5); on an item, a resting height you set rather than its top. Not used on a floor or a ceiling.",
            ),
          targetNodeId: NodeId.optional().describe(
            "The host: a wall, a ceiling or an item standing on the floor; a room, a slab or a level means its floor. Default: the level's floor.",
          ),
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
