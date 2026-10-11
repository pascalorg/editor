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

export const furnishRoomTool = {
  name: 'furnish_room',
  title: 'Furnish room',
  description:
    "Furnish a room for its type from the host's item catalog: the bed, sofa, counters or toilet against the wall facing the door, the rest along a side wall, each set off its wall by its own depth. Name the room by zoneId (its level and outline come with it), or give its polygon and level. The door wall is the edge a door of the room stands on, else doorWallIndex, else edge 0. Nothing lands in a door's clear zone or on another item: a piece that does not fit is nudged, else skipped, and skipped says why. Items stand on the room's level.",
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
