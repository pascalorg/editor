import { z } from 'zod'
import { levelTarget } from './levels'
import { NodeId } from './node-id'

export const placeInRoomTool = {
  name: 'place_in_room',
  title: 'Place an item in a room',
  description:
    'Put one floor-standing catalog item in a room where it fits, without working out a position. Wall/ceiling-attached assets need a host: place_items accepts targetNodeId and, for a wall, y for the bottom height. A wall-bound floor piece (fridge, counter, stove, sink, TV stand, dresser, wardrobe, sofa, bed, bedside table, toilet, bath, shower, bookcase, cabinet) stands against a wall, centred in the widest free stretch of that wall (clear of every door and every other item), its front toward the room; it is never put in the middle, and when no wall has room the answer says how wide the widest free stretch is. A free-standing piece (dining table, rug, coffee table, plant, armchair) takes the middle of the room, or goes with what it belongs with: a coffee table and an armchair face the sofa. A chair goes around its table, one call per chair, facing the table, and is refused when the room has no table. Explicit edge, align, offset or inset instead requests a wall free run for any floor piece. Name the room by its zoneId (create_room, get_zones), or by its polygon and level. The item is a catalog id from search_assets. To furnish a whole room by its type in one call, use furnish_room.',
  input: {
    assetId: z.string().min(1).describe('A catalog id from search_assets.'),
    zoneId: NodeId.optional().describe(
      'The room: zoneId from create_room, or an id from get_zones.',
    ),
    ...levelTarget,
    polygon: z
      .array(z.array(z.number()).length(2))
      .min(3)
      .optional()
      .describe("The room's corners as [x, z] in metres, when there is no zoneId."),
    edge: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Stand it against this polygon edge (i → i + 1) instead of the best one.'),
    rotationDeg: z
      .number()
      .finite()
      .optional()
      .describe(
        'World yaw in degrees, overriding the automatic inward, group or table-facing yaw.',
      ),
    facing: z
      .enum(['in', 'out'])
      .optional()
      .describe('In by default. Out adds 180 degrees after any explicit rotationDeg.'),
    align: z
      .enum(['center', 'start', 'end'])
      .optional()
      .describe(
        'Desired wall alignment, clamped into a valid free run. Defaults to the widest run’s center.',
      ),
    offset: z
      .number()
      .finite()
      .optional()
      .describe('Signed metres along the wall from the desired alignment; defaults to zero.'),
    inset: z
      .number()
      .finite()
      .optional()
      .describe(
        'Normal gap in metres between the rotated footprint and the wall centerline; defaults to 0.1 m.',
      ),
    clearanceAreas: z
      .array(
        z
          .object({
            id: z.string().min(1),
            minX: z.number().finite(),
            maxX: z.number().finite(),
            minZ: z.number().finite(),
            maxZ: z.number().finite(),
          })
          .refine((area) => area.minX <= area.maxX && area.minZ <= area.maxZ, {
            message: 'Clearance rectangles must have minX <= maxX and minZ <= maxZ.',
          }),
      )
      .max(128)
      .optional()
      .describe('Existing clearance rectangles, in world metres, to keep free before placing.'),
    allowDuplicate: z
      .boolean()
      .optional()
      .describe(
        'Place it even though the room already has this item. Off by default (a second toilet or stove is a mistake); chairs are always allowed.',
      ),
  },
}
