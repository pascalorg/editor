import { z } from 'zod'
import { levelTarget } from './levels'
import { NodeId } from './node-id'

export const FURNISHED_ROOM_TYPES = [
  'bedroom',
  'kitchen',
  'bathroom',
  'living',
  'dining',
  'hallway',
  'entry',
  'laundry',
  'storage',
] as const

/** The fixed set of each room type, as agent-operations/furnish-room.ts lays it out (a test holds them together). */
export const FURNISH_ROOM_SETS =
  'bedroom: double-bed (a side of 3.2 m or more) or single-bed, two bedside-table, dresser (10 m² or more), closet (13 m² or more); kitchen: kitchen (back wall of 2.6 m or more) or kitchen-counter, stove (back wall of 3.5 m or more), fridge; bathroom: toilet, bathroom-sink, bathtub (6.5 m² or more) or shower-square; living: sofa, coffee-table, livingroom-chair, tv-stand; dining: dining-table, two dining-chair (four when both sides are 3 m or more); laundry: washing-machine, drying-rack; entry and hallway: coat-rack (both sides 1.4 m or more); storage: closet.'

export const furnishRoomTool = {
  name: 'furnish_room',
  title: 'Furnish room',
  description: `Place the catalog's fixed furniture set for a room type: one set per type, not matched to a style. The bed, sofa, counters or toilet go against the wall facing the door, the rest along a side wall, each set off its wall by its own depth. Name the room by zoneId (its level and outline come with it), or give its polygon and level. The door wall is the edge a door of the room stands on, else doorWallIndex, else edge 0. Nothing lands in a door's clear zone or on another item: a piece that does not fit is nudged, else skipped, and skipped says why. Items stand on the room's level. The set per room type: ${FURNISH_ROOM_SETS} The result lists each piece placed with its size and id, and each piece skipped with its reason. view_scene with interior { zoneId } shows the room from inside, at a person's height.`,
  input: {
    zoneId: NodeId.optional().describe(
      'The room: zoneId from create_room, or an id from get_zones.',
    ),
    ...levelTarget,
    polygon: z
      .array(z.array(z.number()).length(2))
      .min(3)
      .optional()
      .describe("The room's corners as [x, z] in metres, when there is no zoneId."),
    roomType: z.enum(FURNISHED_ROOM_TYPES).describe('What the room is for.'),
    doorWallIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'The polygon edge (i → i + 1) to treat as the door wall: for a room with no door yet, or to override the one found.',
      ),
  },
}
