import { z } from 'zod'
import { NodeId } from './node-id'

export const addEntryDoorsTool = {
  name: 'add_entry_doors',
  title: 'Add every apartment its entry door',
  description:
    "Give every apartment on the floors its entry door, in a wall of its outline that opens onto shared circulation (a corridor or open floor): never another apartment, the outside, a lift shaft or a stair well. The largest circulation wins, then the longest wall. Shafts and wells already built are avoided; for cores built later, verify_scene reports a door that opens into one. Apartments are the floors' units (create_reference_elements kind unit, select apartments). One that already has a door on its outline is left alone, so a repeat is safe; one with no such wall is reported. Interior doors between rooms are separate (add_door).",
  input: {
    levelIds: z
      .array(NodeId)
      .min(1)
      .max(64)
      .describe('The floors whose apartments get their door.'),
    width: z.number().min(0.7).max(1.6).optional().describe('Door width in metres. Default 0.9.'),
  },
}
